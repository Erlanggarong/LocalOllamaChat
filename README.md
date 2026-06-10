# My-Kizo

A sleek, modern desktop chat interface for local LLMs (Ollama) built with **Tauri (Rust)** + **Next.js 14** + **TailwindCSS**.

Named **My-Kizo** — your personal AI companion that runs entirely locally.

## Features

- **Real-time streaming chat** with markdown rendering and syntax highlighting
- **Multi-session chat history** — persisted to `localStorage`, survives app restarts
- **Image support** — upload, drag & drop, paste from clipboard (`Ctrl+V`), click-to-zoom
- **Auto image compression** — resizes large images via canvas before sending (max 1024×1024, JPEG 0.85)
- **Web Search / RAG** — DuckDuckGo + Bing multi-engine search with **full page content extraction** (toggleable)
- **Voice input** — Web Speech API with Indonesian (`id-ID`) support
- **Model switcher** — auto-detects available Ollama models, quick-switch dropdown
- **7 animated themes** — Pixel Anime, Cyberpunk, Minimal, Ocean, Sunset, Forest, Midnight
- **Advanced LLM parameters** — Temperature, Top P, Context Window (4096–32768), Max Tokens (4096–32768)
- **Token metrics** — tokens/sec display on each AI response (toggleable)
- **Export chats** — save as `.md` or `.txt`
- **Preset config persistence** — user settings saved to `localStorage` and restored on startup
- **External config file** — `public/app-config.json` for defaults (no rebuild needed)
- **System tray** — close button hides to tray instead of quitting
- **Global hotkey** — `Ctrl+Alt+Space` toggles window visibility
- **Keyboard shortcuts**:
  - `Ctrl+K` — New chat
  - `Ctrl+/` — Focus input
  - `Ctrl+E` — Export chat as Markdown
  - `Ctrl+Shift+S` — Toggle sidebar
  - `Esc` — Stop generation / close image zoom
- **Auto-starts Ollama** engine on app launch

## Prerequisites

| Tool | Version | Download |
|---|---|---|
| Node.js | 18+ | https://nodejs.org/ |
| Rust | latest | https://rustup.rs/ |
| Ollama | latest | https://ollama.com/ |
| Tauri CLI | **v1.x** | See setup below |

> ⚠️ **Important:** This project uses **Tauri v1**. If you have Tauri CLI v2 installed, you must downgrade it first or the build will fail.

### Install Ollama

1. Download and install Ollama from https://ollama.com/
2. Pull a model (example):
   ```bash
   ollama pull gemma4:e2b-it-qat
   ```

### Install Tauri CLI v1

```bash
# Check current version
cargo tauri --version

# If it shows v2.x, downgrade to v1:
cargo install tauri-cli --version "^1.0.0" --force
```

## Step-by-Step Setup

### 1. Clone the repo

```bash
git clone https://github.com/Erlanggarong/LocalOllamaChat.git
cd LocalOllamaChat
```

### 2. Install Node.js dependencies

```bash
npm install
```

### 3. Run in development mode

```bash
npm run tauri dev
```

This will:
- Start the Next.js dev server on `http://localhost:3000`
- Build and launch the Tauri desktop window (840×1350, positioned top-right)
- Automatically spawn `ollama serve` in the background

### 4. Build the production installer

```batch
rebuild.bat
```

Or manually:

```bash
# Windows
rmdir /s /q dist .next src-tauri\target 2>nul
npm run build
cd src-tauri
cargo tauri build
```

The installer will be in `src-tauri/target/release/bundle/`.

---

## Troubleshooting

### App opens but shows "Failed to connect to Ollama"

**Cause 1: Ollama not running**
- The app tries to auto-start Ollama, but if it's not in your system PATH, it fails.
- **Fix:** Start Ollama manually before opening the app:
  ```bash
  ollama serve
  ```

**Cause 2: CORS blocking**
- Ollama's default CORS policy may block requests from the Tauri WebView.
- **Fix:** Set the `OLLAMA_ORIGINS` environment variable before starting Ollama:

  **Windows (Command Prompt):**
  ```batch
  set OLLAMA_ORIGINS=*
  ollama serve
  ```

  **Windows (PowerShell):**
  ```powershell
  $env:OLLAMA_ORIGINS="*"
  ollama serve
  ```

  **Permanent fix (Windows):**
  Add `OLLAMA_ORIGINS=*` to your System Environment Variables and restart.

### Web Search not returning results

**Cause 1: Network blocked**
- DuckDuckGo or Bing may block requests from certain networks.
- **Fix:** Try a different network or VPN.

**Cause 2: CORS in production build**
- The Tauri WebView may have stricter network policies in production.
- **Fix:** Web search relies on `fetch()` to external sites. Make sure your firewall/antivirus is not blocking the app.

**Cause 3: Search engine changed HTML**
- DuckDuckGo or Bing may update their HTML structure.
- **Fix:** Check browser console for errors and report the issue.

### `cargo tauri build` fails with config errors

**Error:** `"identifier" is a required property` or `Additional properties are not allowed ('devPath', 'distDir', 'withGlobalTauri' were unexpected)`

- **Cause:** You have Tauri CLI v2 installed, but this project uses Tauri v1.
- **Fix:**
  ```bash
  cargo install tauri-cli --version "^1.0.0" --force
  ```

### `rebuild.bat` fails

- Make sure `npm` and `cargo` are available in your terminal PATH.
- Do not double-click `rebuild.bat` from File Explorer if Node.js/Rust were installed for current-user only.
- Instead, open **Git Bash** or **Command Prompt** and run:
  ```batch
  cd LocalOllamaChat
  rebuild.bat
  ```

---

## Project Structure

```
.
├── public/
│   └── app-config.json           # External defaults (model, theme, params, etc.)
├── src/                          # Next.js frontend
│   ├── app/
│   │   ├── page.tsx              # Main chat UI component
│   │   ├── layout.tsx            # Root layout
│   │   └── globals.css           # Tailwind + custom styles
│   ├── components/
│   │   ├── DynamicBackground.tsx # Animated canvas themes
│   │   └── MarkdownRenderer.tsx  # Markdown + syntax highlighting
│   └── lib/
│       └── web-search.ts         # Multi-engine web search + content extraction
├── src-tauri/                    # Tauri (Rust) backend
│   ├── src/
│   │   └── main.rs               # Tray, window position, global hotkey, Ollama spawn
│   ├── icons/                    # App icons
│   ├── tauri.conf.json           # Tauri configuration
│   └── Cargo.toml                # Rust dependencies
├── next.config.js                # Next.js static export config
├── tailwind.config.ts            # TailwindCSS config
├── tsconfig.json
└── rebuild.bat                   # One-click rebuild script (Windows)
```

## Configuration

### External Config (`public/app-config.json`)

Edit this file to change defaults without rebuilding:

```json
{
  "model": "gemma4:e2b-it-qat",
  "botName": "Kizo",
  "systemPrompt": "You are a helpful assistant.",
  "temperature": 0.7,
  "topP": 0.9,
  "numCtx": 4096,
  "numPredict": 4096,
  "apiUrl": "http://localhost:11434/api/chat",
  "theme": "pixel-anime"
}
```

### Preset Persistence

Any changes you make in the Settings panel (model, temperature, theme, etc.) are automatically saved to `localStorage` under the key `mykizo-preset-config` and will override `app-config.json` on the next launch.

---

## Architecture Notes

### Web Search

When enabled via the globe icon 🌐 in the input area, the app performs:

1. **Search**: Tries DuckDuckGo HTML first, falls back to Bing if blocked
2. **Content Extraction**: Fetches each result URL, parses DOM, strips ads/nav/sidebars, extracts main content
3. **Context Injection**: Formats results with title, URL, description, and full page content into a system message sent to Ollama

The extraction uses browser-native `fetch()` + `DOMParser`, targeting semantic HTML elements (`<article>`, `<main>`, `<body>`) with aggressive cleanup of non-content elements.

### Auto-Start Ollama

On app startup, the Rust backend (`src-tauri/src/main.rs`) attempts to spawn `ollama serve` using multiple common installation paths:
- `ollama` (from PATH)
- `%LOCALAPPDATA%\Programs\Ollama\ollama.exe`
- `%PROGRAMFILES%\Ollama\ollama.exe`
- `C:\Program Files\Ollama\ollama.exe`

It also sets `OLLAMA_ORIGINS=*` automatically to avoid CORS issues.

### Streaming API

The frontend streams directly from the local Ollama API using the native `fetch` API with `ReadableStream` and `AbortController` for cancellation.

## License

MIT
