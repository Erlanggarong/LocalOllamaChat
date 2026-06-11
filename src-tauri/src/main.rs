#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use tauri::{AppHandle, GlobalWindowEvent, Manager, SystemTray, SystemTrayEvent, WindowEvent, LogicalPosition, GlobalShortcutManager};

struct OllamaProcess(Mutex<Option<Child>>);

struct McpServer {
    child: std::process::Child,
    stdin: Option<std::process::ChildStdin>,
}
struct McpState(Mutex<HashMap<String, McpServer>>);

#[derive(serde::Serialize)]
struct FetchResponse {
    status: u16,
    body: String,
}

#[tauri::command]
async fn fetch_url(url: String) -> Result<FetchResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .connect_timeout(std::time::Duration::from_secs(10))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let resp = client
        .get(&url)
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = resp.status().as_u16();
    let body = resp.text().await.map_err(|e| format!("Failed to read body: {}", e))?;

    Ok(FetchResponse { status, body })
}

#[tauri::command]
fn spawn_mcp_server(
    window: tauri::Window,
    state: tauri::State<'_, McpState>,
    id: String,
    command_name: String,
    args: Vec<String>,
    env: HashMap<String, String>,
    session_id: String,
) -> Result<(), String> {
    let mut map = state.0.lock().unwrap();
    if let Some(mut existing) = map.remove(&id) {
        let _ = existing.child.kill();
    }

    let mut command = if cfg!(target_os = "windows") && (command_name == "npm" || command_name == "npx" || command_name == "uvx" || command_name == "uv" || command_name == "npx.cmd") {
        let mut c = std::process::Command::new("cmd");
        c.arg("/c").arg(&command_name);
        c
    } else {
        std::process::Command::new(&command_name)
    };

    command.args(args);
    command.envs(env);
    command.stdin(std::process::Stdio::piped());
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = command.spawn().map_err(|e| format!("Failed to spawn {}: {}", command_name, e))?;

    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to get stderr")?;
    let stdin = child.stdin.take();

    let id_clone = id.clone();
    let session_id_clone = session_id.clone();
    let window_clone = window.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(l) = line {
                let _ = window_clone.emit(&format!("mcp_stdout_{}_{}", id_clone, session_id_clone), l);
            } else if let Err(_) = line {
            }
        }
        let _ = window_clone.emit(&format!("mcp_exit_{}_{}", id_clone, session_id_clone), "stdout closed");
    });

    let id_clone2 = id.clone();
    let session_id_clone2 = session_id.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(l) = line {
                let _ = window.emit(&format!("mcp_stderr_{}_{}", id_clone2, session_id_clone2), l);
            }
        }
    });

    map.insert(id, McpServer { child, stdin });
    Ok(())
}

#[tauri::command]
fn write_mcp_stdin(
    state: tauri::State<'_, McpState>,
    id: String,
    message: String,
) -> Result<(), String> {
    let mut map = state.0.lock().unwrap();
    if let Some(server) = map.get_mut(&id) {
        if let Some(stdin) = &mut server.stdin {
            let msg = format!("{}\n", message);
            stdin.write_all(msg.as_bytes()).map_err(|e| e.to_string())?;
            stdin.flush().map_err(|e| e.to_string())?;
            Ok(())
        } else {
            Err("Stdin not available".into())
        }
    } else {
        Err(format!("Server {} not running", id))
    }
}

#[tauri::command]
fn kill_mcp_server(
    state: tauri::State<'_, McpState>,
    id: String,
) -> Result<(), String> {
    let mut map = state.0.lock().unwrap();
    if let Some(mut server) = map.remove(&id) {
        let _ = server.child.kill();
        Ok(())
    } else {
        Err(format!("Server {} not running", id))
    }
}

fn main() {
    let tray_menu = tauri::SystemTrayMenu::new()
        .add_item(tauri::CustomMenuItem::new("show", "Show"))
        .add_item(tauri::CustomMenuItem::new("hide", "Hide"))
        .add_native_item(tauri::SystemTrayMenuItem::Separator)
        .add_item(tauri::CustomMenuItem::new("quit", "Quit"));

    let tray = SystemTray::new().with_menu(tray_menu);

    tauri::Builder::default()
        .setup(|app| {
            // Spawn Ollama in the background (if not already running)
            let ollama_child = spawn_ollama();
            app.manage(OllamaProcess(Mutex::new(ollama_child)));
            app.manage(McpState(Mutex::new(HashMap::new())));

            // Position window at top-right of screen (0px from top)
            if let Some(window) = app.get_window("main") {
                let window_width = 840.0;
                let _window_height = 1350.0;
                let margin_right = 20.0;
                let mut pos_x = 1300.0;
                let pos_y = 0.0;

                if let Ok(Some(monitor)) = window.current_monitor() {
                    let m_size = monitor.size();
                    pos_x = (m_size.width as f64) - window_width - margin_right;
                }

                let _ = window.set_position(LogicalPosition::new(pos_x, pos_y));
            }

            // Register global shortcut: Ctrl+Alt+Space
            let app_handle = app.handle();
            if let Err(e) = app.global_shortcut_manager()
                .register("CommandOrControl+Alt+Space", move || {
                    toggle_window(&app_handle);
                }) {
                eprintln!("Warning: Failed to register global shortcut: {}", e);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fetch_url,
            spawn_mcp_server,
            write_mcp_stdin,
            kill_mcp_server
        ])
        .system_tray(tray)
        .on_system_tray_event(on_tray_event)
        .on_window_event(on_window_event)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn is_ollama_running() -> bool {
    std::net::TcpStream::connect("127.0.0.1:11434").is_ok()
}

fn wait_for_ollama(timeout_secs: u64) -> bool {
    let start = Instant::now();
    while start.elapsed().as_secs() < timeout_secs {
        if is_ollama_running() {
            return true;
        }
        thread::sleep(Duration::from_millis(500));
    }
    false
}

fn spawn_ollama() -> Option<Child> {
    // If Ollama is already running (e.g. as a Windows service), don't spawn another
    if is_ollama_running() {
        println!("Ollama is already running on localhost:11434");
        return None;
    }

    // Try "ollama" from PATH first, then common Windows install paths
    let candidates = if cfg!(target_os = "windows") {
        let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let program_files = std::env::var("PROGRAMFILES").unwrap_or_default();
        let program_files_x86 = std::env::var("PROGRAMFILES(X86)").unwrap_or_default();
        vec![
            "ollama".to_string(),
            format!("{}\\Programs\\Ollama\\ollama.exe", local_app_data),
            format!("{}\\Ollama\\ollama.exe", local_app_data),
            format!("{}\\Ollama\\ollama.exe", program_files),
            format!("{}\\Ollama\\ollama.exe", program_files_x86),
            "C:\\Program Files\\Ollama\\ollama.exe".to_string(),
            "C:\\Program Files (x86)\\Ollama\\ollama.exe".to_string(),
        ]
    } else {
        vec!["ollama".to_string()]
    };

    for cmd in &candidates {
        let child = Command::new(cmd)
            .arg("serve")
            .env("OLLAMA_ORIGINS", "*")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();

        match child {
            Ok(c) => {
                println!("Ollama server started from '{}' (PID: {})", cmd, c.id());
                // Wait up to 10 seconds for Ollama to be ready
                if wait_for_ollama(10) {
                    println!("Ollama is ready!");
                } else {
                    eprintln!("Ollama started but did not become ready within 10s");
                }
                return Some(c);
            }
            Err(_) => continue,
        }
    }

    eprintln!("Failed to start Ollama. Tried paths: {:?}", candidates);
    eprintln!("Please make sure Ollama is installed and running.");
    None
}

fn on_tray_event(app: &AppHandle, event: SystemTrayEvent) {
    match event {
        SystemTrayEvent::LeftClick { .. } => toggle_window(app),
        SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
            "show" => show_window(app),
            "hide" => hide_window(app),
            "quit" => {
                if let Some(state) = app.try_state::<OllamaProcess>() {
                    if let Ok(mut child) = state.0.lock() {
                        if let Some(ref mut c) = *child { let _ = c.kill(); }
                    }
                }
                if let Some(mcp_state) = app.try_state::<McpState>() {
                    if let Ok(mut map) = mcp_state.0.lock() {
                        for (_, server) in map.iter_mut() {
                            let _ = server.child.kill();
                        }
                    }
                }
                app.exit(0);
            }
            _ => {}
        },
        _ => {}
    }
}

fn on_window_event(event: GlobalWindowEvent) {
    match event.event() {
        WindowEvent::CloseRequested { api, .. } => {
            event.window().hide().unwrap();
            api.prevent_close();
        }
        _ => {}
    }
}

fn toggle_window(app: &AppHandle) {
    if let Some(window) = app.get_window("main") {
        if window.is_visible().unwrap_or(true) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn hide_window(app: &AppHandle) {
    if let Some(window) = app.get_window("main") {
        let _ = window.hide();
    }
}
