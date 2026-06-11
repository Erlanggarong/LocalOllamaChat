"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import DynamicBackground from "@/components/DynamicBackground";
import { z } from "zod";
import { searchWithContent } from "@/lib/web-search";

interface MessageMetrics {
  evalCount?: number;
  evalDuration?: number; // nanoseconds
  tps?: number;
}

interface Message {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  images?: string[];
  metrics?: MessageMetrics;
  tool_calls?: any[];
}

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  timestamp: number;
}

interface AppConfig {
  model: string;
  botName: string;
  systemPrompt: string;
  temperature: number;
  topP: number;
  numCtx: number;
  numPredict: number;
  apiUrl: string;
  theme: string;
}

const FALLBACK_CONFIG: AppConfig = {
  model: "gemma4:e2b-it-qat",
  botName: "Kizo",
  systemPrompt: "You are a helpful assistant.",
  temperature: 0.7,
  topP: 0.9,
  numCtx: 4096,
  numPredict: 4096,
  apiUrl: "http://localhost:11434/api/chat",
  theme: "pixel-anime",
};

const STORAGE_KEY = "mykizo-chat-sessions";
const STORAGE_ACTIVE_KEY = "mykizo-chat-active-session";
const STORAGE_CONFIG_KEY = "mykizo-preset-config";

function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

function getSessionTitle(messages: Message[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (firstUser) {
    return firstUser.content.slice(0, 30) + (firstUser.content.length > 30 ? "..." : "");
  }
  return "New Chat";
}


// Compress/resize image using canvas before sending
function compressImage(
  file: File,
  maxWidth: number = 1024,
  maxHeight: number = 1024,
  quality: number = 0.85
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.floor(width * ratio);
          height = Math.floor(height * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas context failed"));
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve(dataUrl.split(",")[1]);
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Fetch available models from Ollama
async function fetchModels(apiUrl: string): Promise<string[]> {
  try {
    const baseUrl = apiUrl.replace("/api/chat", "");
    const res = await fetch(`${baseUrl}/api/tags`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error("Failed to fetch models");
    const data = await res.json();
    if (data.models && Array.isArray(data.models)) {
      return data.models.map((m: any) => m.name || m.model).sort();
    }
    return [];
  } catch (err) {
    return [];
  }
}

export default function ChatPage() {
  const [config, setConfig] = useState<AppConfig>(FALLBACK_CONFIG);
  const [configLoaded, setConfigLoaded] = useState(false);

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarHover, setSidebarHover] = useState(false);

  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState(FALLBACK_CONFIG.systemPrompt);
  const [temperature, setTemperature] = useState(FALLBACK_CONFIG.temperature);
  const [topP, setTopP] = useState(FALLBACK_CONFIG.topP);
  const [numCtx, setNumCtx] = useState(FALLBACK_CONFIG.numCtx);
  const [numPredict, setNumPredict] = useState(FALLBACK_CONFIG.numPredict);
  const [showSettings, setShowSettings] = useState(false);
  const [model, setModel] = useState(FALLBACK_CONFIG.model);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [botName, setBotName] = useState(FALLBACK_CONFIG.botName);
  const [theme, setTheme] = useState(FALLBACK_CONFIG.theme);
  const [apiUrl, setApiUrl] = useState(FALLBACK_CONFIG.apiUrl);
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [showTokenMetrics, setShowTokenMetrics] = useState(true);

  // MCP State
  const [mcpClients, setMcpClients] = useState<Record<string, any>>({});
  const [mcpTools, setMcpTools] = useState<any[]>([]);
  const [mcpConfigText, setMcpConfigText] = useState("");
  const [mcpEnabled, setMcpEnabled] = useState(false);

  const hasMcpConfigured = useMemo(() => {
    try {
      const parsed = JSON.parse(mcpConfigText);
      return parsed.mcpServers && Object.keys(parsed.mcpServers).length > 0;
    } catch {
      return false;
    }
  }, [mcpConfigText]);

  // Web Search state
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [isSearchingWeb, setIsSearchingWeb] = useState(false);

  // Voice input state
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const recognitionRef = useRef<any>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Load config
  useEffect(() => {
    fetch("/app-config.json")
      .then((res) => res.json())
      .then((data: AppConfig) => {
        // Load saved preset config from localStorage
        let savedPreset: Partial<AppConfig> = {};
        try {
          const saved = localStorage.getItem(STORAGE_CONFIG_KEY);
          if (saved) savedPreset = JSON.parse(saved);
        } catch {
          // ignore
        }
        const merged = { ...data, ...savedPreset };
        setConfig(merged);
        setModel(merged.model);
        setBotName(merged.botName || "Kizo");
        setSystemPrompt(merged.systemPrompt);
        setTemperature(merged.temperature);
        setTopP(merged.topP);
        setNumCtx(merged.numCtx || 4096);
        setNumPredict(merged.numPredict || 4096);
        setApiUrl(merged.apiUrl);
        setTheme(merged.theme || "pixel-anime");
        if (typeof (merged as any).showTokenMetrics === "boolean") {
          setShowTokenMetrics((merged as any).showTokenMetrics);
        }
        if (typeof (merged as any).mcpEnabled === "boolean") {
          setMcpEnabled((merged as any).mcpEnabled);
        }
        if (typeof (merged as any).webSearchEnabled === "boolean") {
          setWebSearchEnabled((merged as any).webSearchEnabled);
        }
        setConfigLoaded(true);
      })
      .catch((err) => {
        setConfigLoaded(true);
      });

    const savedMcpConfig = localStorage.getItem("mykizo-mcp-config");
    if (savedMcpConfig) {
      setMcpConfigText(savedMcpConfig);
    } else {
      fetch("/mcp-config.json").then(r => r.text()).then(t => setMcpConfigText(t)).catch(() => {});
    }

    import("../lib/mcp").then(({ initializeMcpClients }) => {
      initializeMcpClients().then(async (clients) => {
        setMcpClients(clients);
        const tools: any[] = [];
        for (const [id, client] of Object.entries(clients)) {
          try {
            // Bypass strict zod validation on MCP SDK since some external servers return invalid schemas
            const res = await (client as any).request({ method: "tools/list" }, z.any());
            for (const t of res.tools) {
              tools.push({
                type: "function",
                function: {
                  name: `${id}__${t.name}`,
                  description: t.description,
                  parameters: t.inputSchema
                }
              });
            }
          } catch (err) {
          }
        }
        setMcpTools(tools);
      });
    });
  }, []);

  // Fetch available models from Ollama
  useEffect(() => {
    if (!configLoaded) return;
    const loadModels = async () => {
      setIsFetchingModels(true);
      const models = await fetchModels(apiUrl);
      setAvailableModels(models);
      setIsFetchingModels(false);
    };
    loadModels();
  }, [configLoaded, apiUrl]);

  // Load sessions from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const savedActive = localStorage.getItem(STORAGE_ACTIVE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as ChatSession[];
        setSessions(parsed);
        if (savedActive && parsed.find((s) => s.id === savedActive)) {
          setActiveSessionId(savedActive);
        } else if (parsed.length > 0) {
          setActiveSessionId(parsed[0].id);
        }
      } else {
        createNewSession();
      }
    } catch {
      createNewSession();
    }
  }, []);

  // Save sessions to localStorage
  useEffect(() => {
    if (sessions.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    }
  }, [sessions]);

  useEffect(() => {
    if (activeSessionId) {
      localStorage.setItem(STORAGE_ACTIVE_KEY, activeSessionId);
    }
  }, [activeSessionId]);

  // Auto-hide settings when sidebar closes
  useEffect(() => {
    const isSidebarVisible = sidebarOpen || sidebarHover;
    if (!isSidebarVisible && showSettings) {
      setShowSettings(false);
    }
  }, [sidebarOpen, sidebarHover, showSettings]);

  // Save preset config to localStorage
  useEffect(() => {
    if (!configLoaded) return;
    const preset: Partial<AppConfig> & { showTokenMetrics?: boolean; mcpEnabled?: boolean; webSearchEnabled?: boolean } = {
      model,
      botName,
      systemPrompt,
      temperature,
      topP,
      numCtx,
      numPredict,
      apiUrl,
      theme,
      showTokenMetrics,
      mcpEnabled,
      webSearchEnabled,
    };
    localStorage.setItem(STORAGE_CONFIG_KEY, JSON.stringify(preset));
  }, [configLoaded, model, botName, systemPrompt, temperature, topP, numCtx, numPredict, apiUrl, theme, showTokenMetrics, mcpEnabled, webSearchEnabled]);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const messages = activeSession?.messages || [];

  // Filtered sessions for search
  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const q = searchQuery.toLowerCase();
    return sessions.filter((s) => {
      if (s.title.toLowerCase().includes(q)) return true;
      return s.messages.some((m) => m.content.toLowerCase().includes(q));
    });
  }, [sessions, searchQuery]);

  // Speech recognition setup
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      setSpeechSupported(true);
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "id-ID";

      recognition.onresult = (event: any) => {
        let finalTranscript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          }
        }
        if (finalTranscript) {
          setInput((prev) => prev + (prev ? " " : "") + finalTranscript);
        }
      };

      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);
      recognitionRef.current = recognition;
    }
  }, []);

  const toggleListening = useCallback(() => {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      recognitionRef.current.start();
      setIsListening(true);
    }
  }, [isListening]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + "px";
    }
  }, [input]);

  const createNewSession = useCallback(() => {
    const newSession: ChatSession = {
      id: generateId(),
      title: "New Chat",
      messages: [
        {
          role: "assistant",
          content: `Hello! I'm **${botName}**. How can I help you today?`,
        },
      ],
      timestamp: Date.now(),
    };
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    return newSession.id;
  }, [botName]);

  const updateSessionMessages = useCallback((sessionId: string, newMessages: Message[]) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== sessionId) return s;
        return {
          ...s,
          messages: newMessages,
          title: s.title === "New Chat" ? getSessionTitle(newMessages) : s.title,
          timestamp: Date.now(),
        };
      })
    );
  }, []);

  const deleteSession = useCallback((sessionId: string) => {
    setSessions((prev) => {
      const filtered = prev.filter((s) => s.id !== sessionId);
      if (filtered.length === 0) {
        const newSession: ChatSession = {
          id: generateId(),
          title: "New Chat",
          messages: [
            {
              role: "assistant",
              content: `Hello! I'm **${botName}**. How can I help you today?`,
            },
          ],
          timestamp: Date.now(),
        };
        setActiveSessionId(newSession.id);
        return [newSession];
      }
      if (activeSessionId === sessionId) {
        setActiveSessionId(filtered[0].id);
      }
      return filtered;
    });
  }, [activeSessionId, botName]);

  const clearChat = useCallback(() => {
    if (!activeSessionId) return;
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== activeSessionId) return s;
        return {
          ...s,
          messages: [
            {
              role: "assistant",
              content: `Hello! I'm **${botName}**. How can I help you today?`,
            },
          ],
          title: "New Chat",
          timestamp: Date.now(),
        };
      })
    );
  }, [activeSessionId, botName]);

  // Process image files with compression
  const processImageFiles = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;

    const compressedImages = await Promise.all(
      imageFiles.map(async (file) => {
        try {
          return await compressImage(file, 1024, 1024, 0.85);
        } catch (err) {
          // Fallback: read raw file
          return new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64 = reader.result as string;
              resolve(base64.split(",")[1]);
            };
            reader.readAsDataURL(file);
          });
        }
      })
    );

    setAttachedImages((prev) => [...prev, ...compressedImages]);
  }, []);

  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    processImageFiles(e.target.files);
    e.target.value = "";
  }, [processImageFiles]);

  // Paste image from clipboard (Ctrl+V)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageItems: DataTransferItem[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          imageItems.push(items[i]);
        }
      }
      if (imageItems.length > 0) {
        e.preventDefault();
        const files = imageItems.map((item) => item.getAsFile()).filter(Boolean) as File[];
        const dataTransfer = new DataTransfer();
        files.forEach((f) => dataTransfer.items.add(f));
        processImageFiles(dataTransfer.files);
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [processImageFiles]);

  const removeImage = useCallback((index: number) => {
    setAttachedImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Drag & Drop handlers (simplified and robust)
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const types = Array.from(e.dataTransfer.types).map((t) => t.toLowerCase());
    const hasFiles = types.some((t) => t === "files" || t.startsWith("file"));
    if (hasFiles) {
      e.dataTransfer.dropEffect = "copy";
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only hide if leaving the container entirely (not entering a child)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processImageFiles(e.dataTransfer.files);
    }
  }, [processImageFiles]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && attachedImages.length === 0) || isLoading || !activeSessionId) return;

    const userContent = input.trim();
    setInput("");
    setAttachedImages([]);
    setIsLoading(true);

    // Web Search if enabled
    let webSearchContext = "";
    if (webSearchEnabled) {
      setIsSearchingWeb(true);
      try {
        // searchWithContent handles URL bypass, query rewriting, and engine fallback internally
        const searchResponse = await searchWithContent(userContent, 3, true, {
          apiUrl,
          model,
          messages: messages.slice(-6),
          currentInput: userContent,
        });
        setIsSearchingWeb(false);

        if (searchResponse.status === "NO_SEARCH") {
        } else if (searchResponse.results.length > 0) {
          const formattedResults = searchResponse.results.map((r, idx) => {
            let text = (idx + 1) + ". " + r.title + "\n" + "URL: " + r.url + "\n" + "Description: " + r.description;
            if (r.fullContent && r.fullContent.trim()) {
              text += "\n\nFull Content:\n" + r.fullContent;
            }
            return text;
          });
          let context = "Use the following web search results to help answer the user's query. Cite sources when appropriate. Focus on answering the user's specific question.\n\n" +
            "Status: " + searchResponse.status + "\n\n" +
            formattedResults.join("\n\n---\n\n") + "\n\n";
          // Limit total web search context to avoid overflowing the model's context window
          const MAX_WEB_CONTEXT = 12000;
          if (context.length > MAX_WEB_CONTEXT) {
            context = context.substring(0, MAX_WEB_CONTEXT) + "\n\n[Web search context truncated to avoid exceeding context window]\n\n";
          }
          webSearchContext = context;
        }
      } catch (err) {
        setIsSearchingWeb(false);
      }
    }

    const userMessage: Message = {
      role: "user",
      content: userContent,
      images: attachedImages.length > 0 ? [...attachedImages] : undefined,
    };

    const newMessages = [...messages, userMessage];
    updateSessionMessages(activeSessionId, newMessages);

    const assistantMessage: Message = { role: "assistant", content: "" };
    const messagesWithAssistant = [...newMessages, assistantMessage];
    updateSessionMessages(activeSessionId, messagesWithAssistant);

    // Build messages payload
    // Dynamic time-awareness: inject current date/time so the LLM knows "today"
    const now = new Date();
    const currentDate = now.toLocaleString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
    const timeAwarenessPrompt = `For your context, today's current date and time is: ${currentDate}. Always base your real-time or time-sensitive answers on this date.`;

    const systemMessages: Message[] = [
      { role: "system", content: timeAwarenessPrompt },
      { role: "system", content: systemPrompt },
    ];
    if (webSearchContext) {
      systemMessages.push({ role: "system", content: webSearchContext });
    }

    const initialPayload: any = {
      model,
      messages: [
        ...systemMessages,
        ...messages
          .filter((m) => m.role !== "system")
          .map((m) => ({
            role: m.role,
            content: m.content,
            ...(m.images ? { images: m.images } : {}),
            ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
          })),
        {
          role: userMessage.role,
          content: userMessage.content,
          ...(userMessage.images ? { images: userMessage.images } : {}),
        },
      ],
      stream: true,
      options: {
        temperature,
        top_p: topP,
        num_ctx: numCtx,
        num_predict: numPredict,
      },
    };
    if (mcpEnabled && mcpTools.length > 0) {
      initialPayload.tools = mcpTools;
    }

    abortRef.current = new AbortController();
    let currentPayload = initialPayload;
    let continueChat = true;

    while (continueChat) {
      continueChat = false;
      let res: Response | null = null;
      let lastErr: Error | null = null;

      // Retry connection up to 3 times
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          res = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(currentPayload),
            signal: abortRef.current?.signal,
          });
          if (res.ok) break;
        } catch (err) {
          lastErr = err as Error;
          if ((err as Error).name === "AbortError") break;
          if (attempt < 2) await new Promise((r) => setTimeout(r, 1500));
        }
      }

      try {
        if (!res || !res.ok) throw lastErr || new Error("No response");
        if (!res.body) throw new Error("No response body");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let done = false;
        let assistantContent = "";
        let toolCalls: any[] = [];

        while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;
          if (value) {
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n").filter((line) => line.trim());
            for (const line of lines) {
              try {
                const parsed = JSON.parse(line);
                if (parsed.message?.content) {
                  assistantContent += parsed.message.content;
                  setSessions((prev) =>
                    prev.map((s) => {
                      if (s.id !== activeSessionId) return s;
                      const updatedMessages = [...s.messages];
                      updatedMessages[updatedMessages.length - 1] = {
                        ...updatedMessages[updatedMessages.length - 1],
                        content: assistantContent,
                      };
                      return { ...s, messages: updatedMessages };
                    })
                  );
                }
                
                if (parsed.message?.tool_calls) {
                  toolCalls = parsed.message.tool_calls;
                }

                if (parsed.done) {
                  done = true;
                  
                  if (toolCalls.length > 0) {
                    // Execute tools
                    const newToolResults: Message[] = [];
                    for (const tc of toolCalls) {
                      const [serverId, toolName] = tc.function.name.split("__");
                      const client = mcpClients[serverId];
                      if (client) {
                        try {
                          const result = await client.callTool({ name: toolName, arguments: tc.function.arguments });
                          // Pass the entire result object directly to future-proof against any unexpected or new data formats.
                          newToolResults.push({
                            role: "tool",
                            content: JSON.stringify(result),
                          });
                        } catch (e) {
                          newToolResults.push({
                            role: "tool",
                            content: JSON.stringify({ error: String(e) }),
                          });
                        }
                      }
                    }

                    if (newToolResults.length > 0) {
                      // Add tool calls and results to payload for next turn
                      currentPayload.messages.push({
                        role: "assistant",
                        content: assistantContent,
                        tool_calls: toolCalls,
                      });
                      currentPayload.messages.push(...newToolResults.map((m) => ({
                        role: m.role,
                        content: m.content
                      })));
                      
                      // Update UI state
                      setSessions((prev) =>
                        prev.map((s) => {
                          if (s.id !== activeSessionId) return s;
                          const updatedMessages = [...s.messages];
                          updatedMessages[updatedMessages.length - 1] = {
                            ...updatedMessages[updatedMessages.length - 1],
                            content: assistantContent,
                            tool_calls: toolCalls,
                          };
                          updatedMessages.push(...newToolResults);
                          updatedMessages.push({ role: "assistant", content: "" });
                          return { ...s, messages: updatedMessages };
                        })
                      );
                      
                      continueChat = true;
                    }
                  } else {
                    // Capture token metrics from Ollama's final chunk
                    if (parsed.eval_count && parsed.eval_duration) {
                      const tps = parsed.eval_count / (parsed.eval_duration / 1e9);
                      setSessions((prev) =>
                        prev.map((s) => {
                          if (s.id !== activeSessionId) return s;
                          const updatedMessages = [...s.messages];
                          updatedMessages[updatedMessages.length - 1] = {
                            ...updatedMessages[updatedMessages.length - 1],
                            metrics: {
                              evalCount: parsed.eval_count,
                              evalDuration: parsed.eval_duration,
                              tps: Math.round(tps * 10) / 10,
                            },
                          };
                          return { ...s, messages: updatedMessages };
                        })
                      );
                    }
                  }
                }
              } catch {
                // ignore malformed JSON lines
              }
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setSessions((prev) =>
            prev.map((s) => {
              if (s.id !== activeSessionId) return s;
              const updatedMessages = [...s.messages];
              updatedMessages[updatedMessages.length - 1] = {
                role: "assistant",
                content: `Error: Failed to connect to Ollama at ${apiUrl}. Make sure Ollama is running.`,
              };
              return { ...s, messages: updatedMessages };
            })
          );
        }
      }
    } // end while

    setIsLoading(false);
    setIsSearchingWeb(false);
    abortRef.current = null;
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setIsLoading(false);
    setIsSearchingWeb(false);
  };

  // Export chat to file
  const exportChat = useCallback((format: "md" | "txt") => {
    if (!activeSession || messages.length === 0) return;

    const dateStr = new Date().toISOString().split("T")[0];
    const filename = `${activeSession.title.replace(/[^a-z0-9]/gi, "_").slice(0, 30)}_${dateStr}.${format}`;

    let content = "";
    if (format === "md") {
      content = `# ${activeSession.title}\n\n`;
      content += `**Model:** ${model}  \n`;
      content += `**Bot:** ${botName}  \n`;
      content += `**Date:** ${new Date().toLocaleString()}  \n\n`;
      content += `---\n\n`;
      messages.forEach((msg) => {
        if (msg.role === "system") return;
        const role = msg.role === "user" ? "**User**" : `**${botName}**`;
        content += `### ${role}\n\n${msg.content}\n\n`;
        if (msg.images && msg.images.length > 0) {
          content += `*[${msg.images.length} image(s) attached]*\n\n`;
        }
      });
    } else {
      content = `${activeSession.title}\n`;
      content += `Model: ${model}\n`;
      content += `Bot: ${botName}\n`;
      content += `Date: ${new Date().toLocaleString()}\n`;
      content += `${"=".repeat(50)}\n\n`;
      messages.forEach((msg) => {
        if (msg.role === "system") return;
        const role = msg.role === "user" ? "USER" : botName.toUpperCase();
        content += `[${role}]\n${msg.content}\n\n`;
      });
    }

    const blob = new Blob([content], { type: format === "md" ? "text/markdown" : "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [activeSession, messages, model, botName]);

  // Close zoom on ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && zoomImage) {
        setZoomImage(null);
        return;
      }
      if (e.ctrlKey && e.key === "k") {
        e.preventDefault();
        createNewSession();
      }
      if (e.ctrlKey && e.key === "/") {
        e.preventDefault();
        textareaRef.current?.focus();
      }
      if (e.ctrlKey && e.key === "e") {
        e.preventDefault();
        exportChat("md");
      }
      if (e.key === "Escape" && isLoading) {
        e.preventDefault();
        handleStop();
      }
      if (e.ctrlKey && e.shiftKey && e.key === "S") {
        e.preventDefault();
        setSidebarOpen((o) => !o);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [createNewSession, exportChat, isLoading, zoomImage]);

  const isSidebarVisible = sidebarOpen || sidebarHover;

  const themeOptions = [
    { value: "pixel-anime", label: "Pixel Anime" },
    { value: "cyberpunk", label: "Cyberpunk" },
    { value: "minimal", label: "Minimal" },
    { value: "ocean", label: "Ocean" },
    { value: "sunset", label: "Sunset" },
    { value: "forest", label: "Forest" },
    { value: "midnight", label: "Midnight" },
  ];

  return (
    <div
      ref={dropZoneRef}
      className="relative flex h-screen text-slate-200 antialiased overflow-hidden"
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Animated Dynamic Background */}
      <DynamicBackground theme={theme} />

      {/* Drag overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center border-4 border-dashed border-blue-400/50 m-4 rounded-3xl">
          <div className="text-center">
            <svg className="w-16 h-16 text-blue-400 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-lg font-medium text-white">Drop images here</p>
            <p className="text-sm text-slate-400 mt-1">Release to attach to chat</p>
          </div>
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={() => setSidebarOpen((o) => !o)}
        className="fixed top-3 left-3 z-50 p-1.5 rounded-lg bg-black/40 border border-white/[0.08] hover:bg-black/60 hover:border-white/[0.15] transition-all backdrop-blur-sm"
        title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
      >
        <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          {sidebarOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {/* Sidebar - auto-hide */}
      <aside
        ref={sidebarRef}
        onMouseEnter={() => setSidebarHover(true)}
        onMouseLeave={() => setSidebarHover(false)}
        className={`flex-shrink-0 flex flex-col glass glass-border border-r border-white/[0.04] transition-all duration-300 ease-out z-20 ${
          isSidebarVisible ? "w-64 translate-x-0 opacity-100" : "w-0 -translate-x-full opacity-0 overflow-hidden"
        }`}
      >
        <div className="px-4 py-4 border-b border-white/[0.04] mt-8">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <div>
              <h1 className="text-sm font-semibold text-white tracking-tight">My-Kizo</h1>
              <p className="text-[10px] text-slate-500 font-medium">AI Companion</p>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="px-3 pt-3 pb-1">
          <div className={`relative flex items-center bg-white/[0.03] border rounded-lg transition-all ${
            searchFocused ? "border-blue-500/30 bg-white/[0.05]" : "border-white/[0.06]"
          }`}>
            <svg className="absolute left-2.5 w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder="Search chats..."
              className="w-full pl-8 pr-3 py-1.5 text-[11px] bg-transparent text-slate-300 placeholder-slate-600 focus:outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 text-slate-500 hover:text-slate-300"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className="px-3 py-2">
          <button
            onClick={() => createNewSession()}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-400 hover:text-white hover:bg-white/[0.04] rounded-lg transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-1 space-y-0.5">
          {filteredSessions.map((session) => (
            <div key={session.id} className="group relative">
              <button
                onClick={() => setActiveSessionId(session.id)}
                className={`w-full text-left px-3 py-2 text-xs rounded-lg transition-colors truncate pr-7 ${
                  session.id === activeSessionId
                    ? "bg-white/[0.06] text-white"
                    : "text-slate-500 hover:text-slate-300 hover:bg-white/[0.03]"
                }`}
                title={session.title}
              >
                {session.title}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteSession(session.id);
                }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-white/[0.06] text-slate-500 hover:text-red-400 transition-all"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
          {filteredSessions.length === 0 && searchQuery && (
            <div className="px-3 py-4 text-[11px] text-slate-600 text-center">
              No chats found
            </div>
          )}
        </div>

        <div className="px-3 py-2 border-t border-white/[0.04] space-y-1">
          <button
            onClick={() => exportChat("md")}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-400 hover:text-white hover:bg-white/[0.04] rounded-lg transition-colors"
            title="Ctrl+E"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export Chat
          </button>
          <button
            onClick={() => exportChat("txt")}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-400 hover:text-white hover:bg-white/[0.04] rounded-lg transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export as Text
          </button>
          <button
            onClick={() => setShowSettings((s) => !s)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
              showSettings ? "bg-white/[0.06] text-white" : "text-slate-400 hover:text-white hover:bg-white/[0.04]"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </button>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col min-w-0 relative z-10">
        {/* Top bar */}
        <div className="glass glass-border border-b border-white/[0.04] px-5 py-3 flex items-center justify-between pl-14">
          <div className="flex items-center gap-2">
            {/* Quick Model Switcher */}
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 focus:outline-none focus:border-blue-400 cursor-pointer hover:bg-blue-500/20 transition-colors appearance-none pr-6"
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2360a5fa' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center', backgroundSize: '10px' }}
              title="Switch model"
            >
              {availableModels.length === 0 ? (
                <option value={model}>{model}</option>
              ) : (
                availableModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))
              )}
            </select>
            <span className="text-[11px] text-slate-500">
              {temperature.toFixed(1)} temp · {topP.toFixed(2)} top_p · ctx:{numCtx} · gen:{numPredict}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Clear Chat */}
            <button
              onClick={clearChat}
              className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
              title="Clear chat"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
            {/* Stop Generation */}
            {isLoading && (
              <button
                onClick={handleStop}
                className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 rounded-lg transition-colors animate-pulse"
                title="Stop generation (ESC)"
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
                Stop
              </button>
            )}
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${isLoading ? "bg-amber-400 animate-pulse" : "bg-emerald-400"}`} />
              <span className="text-[11px] text-slate-500">
                {isSearchingWeb ? "Searching web..." : isLoading ? "Generating..." : "Ready"}
              </span>
            </div>
          </div>
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <div className="glass glass-border border-b border-white/[0.04] px-5 py-4 space-y-4">
            {/* Model — full width to avoid button overlap */}
            <div>
              <label className="block text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1.5">
                Model {isFetchingModels && <span className="text-blue-400 animate-pulse">●</span>}
              </label>
              <div className="flex gap-2">
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="flex-1 px-3 py-1.5 text-xs bg-white/[0.03] border border-white/[0.06] rounded-md focus:outline-none focus:border-blue-500/50 text-slate-200"
                >
                  {availableModels.length === 0 ? (
                    <option value={model} className="bg-[#0b0f19]">{model}</option>
                  ) : (
                    availableModels.map((m) => (
                      <option key={m} value={m} className="bg-[#0b0f19]">
                        {m}
                      </option>
                    ))
                  )}
                </select>
                <button
                  type="button"
                  onClick={async () => {
                    setIsFetchingModels(true);
                    const models = await fetchModels(apiUrl);
                    setAvailableModels(models);
                    setIsFetchingModels(false);
                  }}
                  className="flex-shrink-0 p-1.5 text-slate-500 hover:text-blue-400 hover:bg-blue-500/10 rounded-md transition-colors"
                  title="Refresh models"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
              {availableModels.length === 0 && !isFetchingModels && (
                <p className="text-[10px] text-slate-600 mt-1">No models found. Make sure Ollama is running.</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1.5">Bot Name</label>
                <input
                  type="text"
                  value={botName}
                  onChange={(e) => setBotName(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-white/[0.03] border border-white/[0.06] rounded-md focus:outline-none focus:border-blue-500/50 text-slate-200 placeholder-slate-600"
                  placeholder="Kizo"
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1.5">API URL</label>
                <input
                  type="text"
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-white/[0.03] border border-white/[0.06] rounded-md focus:outline-none focus:border-blue-500/50 text-slate-200 placeholder-slate-600"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1.5">Theme</label>
                <select
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-white/[0.03] border border-white/[0.06] rounded-md focus:outline-none focus:border-blue-500/50 text-slate-200"
                >
                  {themeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value} className="bg-[#0b0f19]">
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1.5">System Prompt</label>
                <input
                  type="text"
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-white/[0.03] border border-white/[0.06] rounded-md focus:outline-none focus:border-blue-500/50 text-slate-200 placeholder-slate-600"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowTokenMetrics((v) => !v)}
                className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${showTokenMetrics ? "bg-blue-500" : "bg-white/[0.08]"}`}
              >
                <span
                  className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform ${showTokenMetrics ? "translate-x-3.5" : "translate-x-0.5"}`}
                />
              </button>
              <span className="text-[11px] text-slate-400">Show token metrics (tokens · tok/s)</span>
            </div>
            <div className="flex gap-6 flex-wrap">
              <div className="flex-1 min-w-[140px] max-w-[200px]">
                <div className="flex justify-between mb-1">
                  <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Temperature</label>
                  <span className="text-[10px] text-slate-400 font-mono">{temperature.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  className="w-full h-1 bg-white/[0.06] rounded-full appearance-none cursor-pointer accent-blue-500"
                />
                <div className="flex justify-between mt-0.5">
                  <span className="text-[9px] text-slate-600">0</span>
                  <span className="text-[9px] text-slate-600">2</span>
                </div>
              </div>
              <div className="flex-1 min-w-[140px] max-w-[200px]">
                <div className="flex justify-between mb-1">
                  <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Top P</label>
                  <span className="text-[10px] text-slate-400 font-mono">{topP.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={topP}
                  onChange={(e) => setTopP(parseFloat(e.target.value))}
                  className="w-full h-1 bg-white/[0.06] rounded-full appearance-none cursor-pointer accent-blue-500"
                />
                <div className="flex justify-between mt-0.5">
                  <span className="text-[9px] text-slate-600">0</span>
                  <span className="text-[9px] text-slate-600">1</span>
                </div>
              </div>
              <div className="flex-1 min-w-[140px] max-w-[200px]">
                <div className="flex justify-between mb-1">
                  <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Context Window</label>
                  <span className="text-[10px] text-slate-400 font-mono">{numCtx}</span>
                </div>
                <input
                  type="range"
                  min={4096}
                  max={32768}
                  step={1024}
                  value={numCtx}
                  onChange={(e) => setNumCtx(parseInt(e.target.value))}
                  className="w-full h-1 bg-white/[0.06] rounded-full appearance-none cursor-pointer accent-blue-500"
                />
                <div className="flex justify-between mt-0.5">
                  {[4096, 8192, 16384, 24576, 32768].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setNumCtx(v)}
                      className={`text-[9px] transition-colors hover:text-blue-400 ${numCtx === v ? "text-blue-400 font-semibold" : "text-slate-600"}`}
                    >
                      {v >= 1024 ? `${v / 1024}k` : v}
                    </button>
                  ))}
                </div>
                <p className="text-[9px] text-slate-600 mt-1 leading-tight">Total tokens the model can process (input + output combined).</p>
              </div>
              <div className="flex-1 min-w-[140px] max-w-[200px]">
                <div className="flex justify-between mb-1">
                  <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Max Tokens</label>
                  <span className="text-[10px] text-slate-400 font-mono">{numPredict}</span>
                </div>
                <input
                  type="range"
                  min={4096}
                  max={32768}
                  step={1024}
                  value={numPredict}
                  onChange={(e) => setNumPredict(parseInt(e.target.value))}
                  className="w-full h-1 bg-white/[0.06] rounded-full appearance-none cursor-pointer accent-blue-500"
                />
                <div className="flex justify-between mt-0.5">
                  {[4096, 8192, 16384, 24576, 32768].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setNumPredict(v)}
                      className={`text-[9px] transition-colors hover:text-blue-400 ${numPredict === v ? "text-blue-400 font-semibold" : "text-slate-600"}`}
                    >
                      {v >= 1024 ? `${v / 1024}k` : v}
                    </button>
                  ))}
                </div>
                <p className="text-[9px] text-slate-600 mt-1 leading-tight">Maximum tokens the model can generate in a single response.</p>
              </div>
            </div>
            <div className="pt-2 border-t border-white/[0.06]">
              <label className="block text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1.5">MCP Configuration (JSON)</label>
              <textarea
                value={mcpConfigText}
                onChange={(e) => setMcpConfigText(e.target.value)}
                className="w-full h-32 px-3 py-2 text-xs bg-black/40 border border-white/[0.06] rounded-md focus:outline-none focus:border-blue-500/50 text-slate-300 font-mono resize-y"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => {
                  try {
                    JSON.parse(mcpConfigText);
                    localStorage.setItem("mykizo-mcp-config", mcpConfigText);
                    alert("MCP Configuration saved! Please restart the app to apply changes.");
                  } catch (e) {
                    alert("Invalid JSON format. Please fix the errors before saving.");
                  }
                }}
                className="mt-2 px-3 py-1.5 text-xs font-medium bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded-md transition-colors"
              >
                Save MCP Config
              </button>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          {messages.filter(m => m.role !== "tool").map((msg, idx, arr) => {
            const isWelcome = idx === 0 && msg.role === "assistant";
            const isLast = idx === arr.length - 1;
            
            // Hide empty assistant messages unless it's the active loading bubble
            if (msg.role === "assistant" && !msg.content && !(isLoading && isLast)) {
              // Optionally we could render a "Used tool..." badge here if msg.tool_calls exists
              return null;
            }

            return (
              <div
                key={idx}
                className={`flex ${isWelcome ? "justify-end" : msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div className={`max-w-[85%] ${msg.role === "user" || isWelcome ? "items-end" : "items-start"} flex flex-col gap-2`}>
                  {msg.images && msg.images.length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                      {msg.images.map((img, i) => (
                        <button
                          key={i}
                          onClick={() => setZoomImage(`data:image/jpeg;base64,${img}`)}
                          className="relative group overflow-hidden rounded-lg border border-white/[0.06]"
                        >
                          <img
                            src={`data:image/jpeg;base64,${img}`}
                            alt="attached"
                            className="w-32 h-32 object-cover transition-transform group-hover:scale-105"
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                            <svg className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                            </svg>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  <div
                    className={`px-4 py-3 text-[13px] leading-relaxed ${
                      isWelcome
                        ? "bg-gradient-to-br from-indigo-600/90 to-blue-600/90 text-white rounded-2xl rounded-tr-sm shadow-lg shadow-blue-900/20"
                        : msg.role === "user"
                        ? "bg-blue-600/90 text-white rounded-2xl rounded-tr-sm shadow-lg shadow-blue-900/20"
                        : "bg-black/40 backdrop-blur-sm text-slate-300 rounded-2xl rounded-tl-sm border border-white/[0.06]"
                    }`}
                  >
                    {msg.role === "assistant" ? (
                      <MarkdownRenderer content={msg.content} />
                    ) : (
                      msg.content
                    )}
                    {msg.role === "assistant" && isLoading && !msg.content && isLast && (
                      <span className="inline-flex gap-1 items-center h-5">
                        <span className="w-1 h-1 bg-slate-400 rounded-full animate-bounce" />
                        <span className="w-1 h-1 bg-slate-400 rounded-full animate-bounce [animation-delay:0.12s]" />
                        <span className="w-1 h-1 bg-slate-400 rounded-full animate-bounce [animation-delay:0.24s]" />
                      </span>
                    )}
                    {msg.role === "assistant" && showTokenMetrics && msg.metrics && (
                      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-white/[0.06]">
                        <span className="text-[10px] text-slate-500 font-mono">
                          {msg.metrics.evalCount} tokens
                        </span>
                        <span className="text-[10px] text-slate-600">·</span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {msg.metrics.tps} tok/s
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="px-6 pb-5 pt-2">
          {attachedImages.length > 0 && (
            <div className="flex gap-2 mb-2 flex-wrap">
              {attachedImages.map((img, i) => (
                <div key={i} className="relative group">
                  <img
                    src={`data:image/jpeg;base64,${img}`}
                    alt="preview"
                    className="w-14 h-14 object-cover rounded-lg border border-white/[0.06]"
                  />
                  <button
                    onClick={() => removeImage(i)}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleSubmit} className="relative">
            <div className="flex items-end gap-2 bg-black/40 backdrop-blur-sm border border-white/[0.08] rounded-2xl px-4 py-3 focus-within:border-blue-500/30 focus-within:bg-black/50 transition-all">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex-shrink-0 p-1.5 text-slate-500 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                title="Attach image"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleImageUpload}
                className="hidden"
              />

              {/* Web Search Toggle */}
              <button
                type="button"
                onClick={() => setWebSearchEnabled((v) => !v)}
                className={`flex-shrink-0 p-1.5 rounded-lg transition-colors ${
                  webSearchEnabled
                    ? "text-emerald-400 bg-emerald-500/10"
                    : "text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]"
                }`}
                title={webSearchEnabled ? "Web search ON" : "Web search OFF"}
              >
                {webSearchEnabled ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              </button>

              {/* MCP Tools Toggle */}
              {hasMcpConfigured && (
                <button
                  type="button"
                  onClick={() => setMcpEnabled((v) => !v)}
                  className={`flex-shrink-0 p-1.5 rounded-lg transition-colors ${
                    mcpEnabled
                      ? "text-emerald-400 bg-emerald-500/10"
                      : "text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]"
                  }`}
                  title={mcpEnabled ? "MCP Tools ON" : "MCP Tools OFF"}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </button>
              )}

              {/* Voice input button */}
              {speechSupported && (
                <button
                  type="button"
                  onClick={toggleListening}
                  className={`flex-shrink-0 p-1.5 rounded-lg transition-colors ${
                    isListening
                      ? "text-red-400 bg-red-500/10 animate-pulse"
                      : "text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10"
                  }`}
                  title={isListening ? "Stop listening" : "Voice input"}
                >
                  {isListening ? (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                      <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                  )}
                </button>
              )}

              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
                rows={1}
                placeholder={isListening ? "Listening..." : webSearchEnabled ? "Ask anything (web search ON)..." : "Message..."}
                className="flex-1 bg-transparent text-[13px] text-slate-200 placeholder-slate-500 focus:outline-none resize-none min-h-[20px] max-h-[160px] py-0.5"
              />
              {isLoading ? (
                <button
                  type="button"
                  onClick={handleStop}
                  className="flex-shrink-0 p-1.5 text-amber-400 hover:bg-amber-500/10 rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim() && attachedImages.length === 0}
                  className="flex-shrink-0 p-1.5 text-blue-400 hover:bg-blue-500/10 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              )}
            </div>
          </form>
        </div>
      </main>

      {/* Image Zoom Modal */}
      {zoomImage && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-8"
          onClick={() => setZoomImage(null)}
        >
          <button
            onClick={() => setZoomImage(null)}
            className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white bg-white/[0.05] hover:bg-white/[0.1] rounded-full transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <img
            src={zoomImage}
            alt="zoomed"
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
