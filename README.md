# My Kizo

A sleek, modern desktop chat interface for local LLMs (Ollama) built with **Tauri (Rust)** + **Next.js 14** + **TailwindCSS**.

Named **My Kizo** — your personal AI companion that runs entirely locally.

## Features

- **Real-time streaming chat** with markdown rendering and syntax highlighting
- **Multi-session chat history** — persisted to `localStorage`, survives app restarts
- **Image support** — upload, drag & drop, paste from clipboard (`Ctrl+V`), click-to-zoom
- **Auto image compression** — resizes large images via canvas before sending (max 1024×1024, JPEG 0.85)
- **Web Search / RAG** — DuckDuckGo search results injected as context (toggleable)
- **Voice input** — Web Speech API with Indonesian (`id-ID`) support
- **Model switcher** — auto-detects available Ollama models, quick-switch dropdown
- **7 animated themes** — Pixel Anime, Cyberpunk, Minimal, Ocean, Sunset, Forest, Midnight
- **Advanced LLM parameters** — Temperature, Top P, Context Window (4096–32768), Max Tokens (4096–32768)
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

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/)
- [Ollama](https://ollama.com/) installed and in your system `PATH`
- A local model pulled, e.g.:
  ```bash
  ollama pull gemma4:e2b-it-qat
  ```

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Install Tauri CLI (if not already installed)

```bash
cargo install tauri-cli
```

### 3. Run in development mode

```bash
npm run tauri dev
```

This will:
- Start the Next.js dev server on `http://localhost:3000`
- Build and launch the Tauri desktop window (600×1250, positioned top-right)
- Automatically spawn `ollama serve` in the background

### 4. Build for production

```bash
npm run tauri build
```

The installer will be in `src-tauri/target/release/bundle/`.

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
│   └── components/
│       ├── DynamicBackground.tsx # Animated canvas themes
│       └── MarkdownRenderer.tsx  # Markdown + syntax highlighting
├── src-tauri/                    # Tauri (Rust) backend
│   ├── src/
│   │   └── main.rs               # Tray, window position, global hotkey, Ollama spawn
│   ├── icons/                    # App icons
│   ├── tauri.conf.json           # Tauri configuration
│   └── Cargo.toml                # Rust dependencies
├── next.config.js                # Next.js static export config
├── tailwind.config.ts            # TailwindCSS config
└── package.json
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

## Architecture Notes

### System Tray & Close-to-Tray

The Rust backend (`src-tauri/src/main.rs`) intercepts `WindowEvent::CloseRequested` and calls `api.prevent_close()` + `window.hide()` instead of allowing the app to quit. Left-clicking the tray icon toggles visibility.

### Global Hotkey

`Ctrl+Alt+Space` is registered via Tauri's `GlobalShortcutManager` to show/hide the window from anywhere.

### Auto-Start Ollama

On app startup (`setup` hook), `ollama serve` is spawned with `stdout` and `stderr` redirected to `null`, running silently in the background. The process handle is stored in Tauri's managed state and killed cleanly when the user quits via the tray menu.

### Streaming API

The frontend streams directly from the local Ollama API using the native `fetch` API with `ReadableStream` and `AbortController` for cancellation.

### LLM Parameters

The payload sent to Ollama includes:
- `system` role messages for the system prompt and web search context
- `options.temperature` for sampling temperature
- `options.top_p` for nucleus sampling
- `options.num_ctx` for context window size
- `options.num_predict` for max output tokens

### Web Search

When enabled, the app scrapes DuckDuckGo HTML results via `DOMParser` (no API key needed) and injects the top 5 results as a system message before sending the user query to Ollama.

### Image Handling

Images are compressed client-side using an HTML5 Canvas before being base64-encoded and sent to Ollama's multimodal API. Supported input methods: file picker, drag & drop, and clipboard paste.

## License

MIT
