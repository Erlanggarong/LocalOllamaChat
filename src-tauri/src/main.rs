#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, GlobalWindowEvent, Manager, SystemTray, SystemTrayEvent, WindowEvent, LogicalPosition, GlobalShortcutManager};

struct OllamaProcess(Mutex<Option<Child>>);

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
        .invoke_handler(tauri::generate_handler![fetch_url])
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
