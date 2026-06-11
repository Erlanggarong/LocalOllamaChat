import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { invoke } from "@tauri-apps/api/tauri";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

export class TauriStdioTransport implements Transport {
  private _onmessage?: (message: JSONRPCMessage) => void;
  private _onclose?: () => void;
  private _onerror?: (error: Error) => void;
  private unlistenStdout?: UnlistenFn;
  private unlistenStderr?: UnlistenFn;
  private unlistenExit: UnlistenFn | null = null;
  public sessionId: string;

  constructor(
    private serverId: string,
    private command: string,
    private args: string[],
    private env: Record<string, string>
  ) {
    this.sessionId = Math.random().toString(36).substring(7);
  }

  async start(): Promise<void> {
    try {
      // Setup event listeners
      this.unlistenStdout = await listen<string>(`mcp_stdout_${this.serverId}_${this.sessionId}`, (event) => {
        try {
          const message = JSON.parse(event.payload) as JSONRPCMessage;
          this._onmessage?.(message);
        } catch (e) {
          // MCP Servers might output non-JSON lines (e.g. logs). Ignore parsing errors.
        }
      });

      this.unlistenStderr = await listen<string>(`mcp_stderr_${this.serverId}_${this.sessionId}`, (event) => {
      });

      this.unlistenExit = await listen<string>(`mcp_exit_${this.serverId}_${this.sessionId}`, () => {
        this._onclose?.();
      });

      // Spawn process
      await invoke("spawn_mcp_server", {
        id: this.serverId,
        commandName: this.command,
        args: this.args,
        env: this.env,
        sessionId: this.sessionId,
      });
    } catch (e) {
      let errMsg = typeof e === "string" ? e : (e as any)?.message || JSON.stringify(e);
      const err = new Error(`Failed to start MCP server (command: ${this.command}). Backend said: ${errMsg}`);
      this._onerror?.(err);
      throw err;
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    try {
      const msgStr = JSON.stringify(message);
      await invoke("write_mcp_stdin", {
        id: this.serverId,
        message: msgStr,
      });
    } catch (e) {
      const err = new Error(typeof e === "string" ? e : "Failed to send message to MCP server");
      this._onerror?.(err);
      throw err;
    }
  }

  async close(): Promise<void> {
    try {
      if (this.unlistenStdout) this.unlistenStdout();
      if (this.unlistenStderr) this.unlistenStderr();
      if (this.unlistenExit) this.unlistenExit();
      await invoke("kill_mcp_server", { id: this.serverId });
    } catch (e) {
    }
    this._onclose?.();
  }

  set onclose(callback: () => void) {
    this._onclose = callback;
  }
  set onerror(callback: (error: Error) => void) {
    this._onerror = callback;
  }
  set onmessage(callback: (message: JSONRPCMessage) => void) {
    this._onmessage = callback;
  }
}

import { Client } from "@modelcontextprotocol/sdk/client/index.js";

let globalClientsPromise: Promise<Record<string, Client>> | null = null;

export async function initializeMcpClients(): Promise<Record<string, Client>> {
  if (globalClientsPromise) {
    return globalClientsPromise;
  }

  globalClientsPromise = (async () => {
    const clients: Record<string, Client> = {};
  try {
    let configStr = localStorage.getItem("mykizo-mcp-config");
    let config: any = null;

    if (configStr) {
      try {
        config = JSON.parse(configStr);
      } catch (e) {
      }
    }

    if (!config) {
      const res = await fetch("/mcp-config.json");
      if (res.ok) {
        config = await res.json();
      }
    }

    const servers = config?.mcpServers || {};

    for (const [id, serverConfig] of Object.entries(servers)) {
      const cfg = serverConfig as { command: string; args: string[]; env: Record<string, string> };
      const transport = new TauriStdioTransport(id, cfg.command, cfg.args || [], cfg.env || {});
      const client = new Client({
        name: "my-kizo",
        version: "0.1.0",
      }, {
        capabilities: {}
      });
      
      await client.connect(transport);
      clients[id] = client;
    }
    } catch (err) {
    }
    return clients;
  })();

  return globalClientsPromise;
}
