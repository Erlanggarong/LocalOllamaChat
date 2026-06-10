/**
 * Multi-engine web search with content extraction.
 *
 * All HTTP requests go through a custom Rust backend command (reqwest)
 * to bypass CORS/bot-detection entirely.
 *
 * Features:
 *  - URL bypass: if user prompt contains a URL, fetch it directly
 *  - Structured HTML parsing: extracts tables, lists, headings, paragraphs
 *  - Query rewriting: conversational queries rewritten via local LLM
 *  - Fallback chain: DDG API → Wikipedia → Bing → DDG Lite
 */

import { invoke } from "@tauri-apps/api/tauri";

interface FetchResponse {
  status: number;
  body: string;
}

export interface SearchResult {
  title: string;
  url: string;
  description: string;
  fullContent?: string;
  fetchStatus?: "success" | "error" | "skipped";
  error?: string;
}

export interface SearchResponse {
  results: SearchResult[];
  totalResults: number;
  engine: string;
  status: string;
}

// ========== LOW-LEVEL FETCH (via Rust backend) ==========

async function rustFetch(url: string): Promise<{ status: number; body: string }> {
  const res = await invoke<FetchResponse>("fetch_url", { url });
  return { status: res.status, body: res.body };
}

function logRaw(label: string, body: string, maxLen = 2000) {
  const preview = body.substring(0, maxLen).replace(/\s+/g, " ").trim();
  console.log(`[Web Search] Raw ${label} (${body.length} chars):`, preview);
}

// ========== URL DETECTION ==========

const URL_REGEX = /https?:\/\/[^\s<>"'{}|\^`\[\]]+/i;

function extractUrlFromQuery(query: string): string | null {
  const match = query.match(URL_REGEX);
  return match ? match[0] : null;
}

// ========== STRUCTURED HTML PARSER (tables, lists, headings, paragraphs) ==========

function formatTable(tableEl: Element): string {
  const caption = tableEl.querySelector("caption")?.textContent?.trim();
  const rows: string[] = [];

  tableEl.querySelectorAll("tr").forEach((tr) => {
    const cells: string[] = [];
    tr.querySelectorAll("th, td").forEach((cell) => {
      const text = cell.textContent?.trim().replace(/\s+/g, " ");
      if (text !== undefined) cells.push(text);
    });
    if (cells.length > 0) rows.push(cells.join(" | "));
  });

  if (rows.length === 0) return "";

  let result = caption ? `Table: ${caption}\n` : "Table:\n";
  result += rows.join("\n");
  return result;
}

function formatList(listEl: Element, numbered: boolean): string {
  const items: string[] = [];
  Array.from(listEl.children).forEach((child, idx) => {
    if (child.tagName.toLowerCase() !== "li") return;
    const text = child.textContent?.trim().replace(/\s+/g, " ");
    if (text) {
      items.push(numbered ? `${idx + 1}. ${text}` : `- ${text}`);
    }
  });
  return items.join("\n");
}

function extractStructuredText(root: Element, maxLength: number): string {
  const parts: string[] = [];

  function walk(el: Element) {
    if (parts.join("\n").length > maxLength) return;

    const tag = el.tagName.toLowerCase();

    // Skip noise elements entirely
    const skipTags = [
      "script", "style", "nav", "header", "footer", "aside",
      "noscript", "svg", "canvas", "iframe", "form", "button",
    ];
    if (skipTags.includes(tag)) return;

    // Handle tables — format and do NOT recurse into children
    if (tag === "table") {
      const t = formatTable(el);
      if (t) parts.push(t);
      return;
    }

    // Handle lists — format and do NOT recurse into children
    if (tag === "ul" || tag === "ol") {
      const l = formatList(el, tag === "ol");
      if (l) parts.push(l);
      return;
    }

    // Handle headings
    if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(tag)) {
      const text = el.textContent?.trim();
      if (text) parts.push(`\n${text}\n`);
      return;
    }

    // Handle paragraphs
    if (tag === "p") {
      const text = el.textContent?.trim();
      if (text && text.length > 5) parts.push(text);
      return;
    }

    // For other elements with no element children, capture leaf text
    if (el.children.length === 0) {
      const text = el.textContent?.trim();
      if (text && text.length > 10) parts.push(text);
      return;
    }

    // Recurse into container elements (div, section, span, etc.)
    for (const child of Array.from(el.children)) {
      walk(child);
    }
  }

  for (const child of Array.from(root.children)) {
    walk(child);
  }

  // Clean up excessive newlines
  return parts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ========== API-BASED SEARCH ENGINES ==========

async function searchDuckDuckGoAPI(query: string, limit: number): Promise<SearchResult[]> {
  console.log("[Web Search] Trying DuckDuckGo Instant Answer API...");
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&t=mykizo`;

  const { status, body } = await rustFetch(url);
  console.log("[Web Search] DDG API status:", status);

  if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
  if (!body || body.length < 50) throw new Error("Empty response");

  let data: any;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("Invalid JSON");
  }

  const results: SearchResult[] = [];

  if (data.AbstractText && data.AbstractURL) {
    results.push({
      title: data.Heading || query,
      url: data.AbstractURL,
      description: data.AbstractText,
    });
  }

  for (const topic of data.RelatedTopics || []) {
    if (results.length >= limit) break;
    if (topic.Text && topic.FirstURL) {
      results.push({
        title: topic.Text.split(" - ")[0] || topic.Text.substring(0, 60),
        url: topic.FirstURL,
        description: topic.Text,
      });
    }
    if (topic.Topics) {
      for (const sub of topic.Topics) {
        if (results.length >= limit) break;
        if (sub.Text && sub.FirstURL) {
          results.push({
            title: sub.Text.split(" - ")[0] || sub.Text.substring(0, 60),
            url: sub.FirstURL,
            description: sub.Text,
          });
        }
      }
    }
  }

  for (const r of data.Results || []) {
    if (results.length >= limit) break;
    if (r.Text && r.FirstURL) {
      results.push({
        title: r.Text.split(" - ")[0] || r.Text.substring(0, 60),
        url: r.FirstURL,
        description: r.Text,
      });
    }
  }

  console.log("[Web Search] DDG API parsed:", results.length);
  return results;
}

async function searchWikipedia(query: string, limit: number): Promise<SearchResult[]> {
  console.log("[Web Search] Trying Wikipedia API...");
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${limit}&format=json&utf8=1&redirects=1`;

  const { status, body } = await rustFetch(searchUrl);
  console.log("[Web Search] Wikipedia search status:", status);

  if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
  if (!body) throw new Error("Empty response");

  let data: any;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("Invalid JSON");
  }

  if (data.error) {
    throw new Error(`Wikipedia API error: ${data.error.info || JSON.stringify(data.error)}`);
  }

  const searchResults = data?.query?.search;
  if (!Array.isArray(searchResults)) {
    console.log("[Web Search] Wikipedia unexpected keys:", Object.keys(data));
    throw new Error("Unexpected JSON structure");
  }

  console.log("[Web Search] Wikipedia raw results:", searchResults.length);

  const results: SearchResult[] = [];
  for (const item of searchResults.slice(0, limit)) {
    const title = item.title;
    if (!title) continue;
    const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
    const snippet = (item.snippet || "")
      .replace(/<[^>]+>/g, "")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");

    console.log("[Web Search] Wikipedia candidate:", title, "|", snippet.substring(0, 80));
    results.push({ title, url, description: snippet });
  }

  console.log("[Web Search] Wikipedia parsed:", results.length);
  return results;
}

async function fetchWikipediaExtract(title: string, maxLength: number): Promise<string> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=true&explaintext=true&titles=${encodeURIComponent(title)}&format=json&utf8=1`;
  const { status, body } = await rustFetch(url);
  if (status < 200 || status >= 300 || !body) return "";

  try {
    const data = JSON.parse(body);
    const pages = data?.query?.pages || {};
    for (const pageId in pages) {
      const extract = pages[pageId]?.extract || "";
      if (maxLength > 0 && extract.length > maxLength) {
        return extract.substring(0, maxLength) + "\n\n[Content truncated]";
      }
      return extract;
    }
  } catch {
    // ignore
  }
  return "";
}

// ========== HTML SCRAPING FALLBACKS ==========

function extractResultsFromHtml(html: string, numResults: number, engineName: string): SearchResult[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const results: SearchResult[] = [];
  const seenUrls = new Set<string>();

  const containers = doc.querySelectorAll("li, div, article");
  console.log(`[Web Search] ${engineName} scanning ${containers.length} containers...`);

  for (const container of Array.from(containers)) {
    if (results.length >= numResults) break;

    const links = container.querySelectorAll("a[href]");
    let bestLink: HTMLAnchorElement | null = null;

    for (const link of Array.from(links)) {
      const a = link as HTMLAnchorElement;
      const href = a.getAttribute("href") || "";
      const text = (a.textContent || "").trim();

      if (!href.startsWith("http")) continue;
      if (href.includes("bing.com") || href.includes("duckduckgo.com") || href.includes("microsoft.com")) continue;
      if (text.length < 3) continue;

      const parentTag = a.parentElement?.tagName.toLowerCase() || "";
      const grandparentTag = a.parentElement?.parentElement?.tagName.toLowerCase() || "";
      if (parentTag === "h2" || parentTag === "h3" || grandparentTag === "h2" || grandparentTag === "h3") {
        bestLink = a;
        break;
      }
      if (!bestLink) bestLink = a;
    }

    if (!bestLink) continue;

    const url = bestLink.getAttribute("href") || "";
    const title = (bestLink.textContent || "").trim();
    if (!url || !title || seenUrls.has(url)) continue;

    let description = "";
    const textEls = container.querySelectorAll("p, span, div");
    for (const el of Array.from(textEls)) {
      const txt = (el.textContent || "").trim();
      if (txt.length > 20 && txt !== title && !txt.includes(title)) {
        description = txt;
        break;
      }
    }

    if (!description) {
      const containerText = (container.textContent || "").replace(title, "").trim();
      if (containerText.length > 20) description = containerText.substring(0, 300);
    }

    if (description) {
      console.log(`[Web Search] ${engineName} candidate: "${title.substring(0, 60)}..." | desc:${description.substring(0, 80)}...`);
      seenUrls.add(url);
      results.push({ title, url, description: description.substring(0, 500) });
    }
  }

  if (results.length === 0) {
    console.log(`[Web Search] ${engineName} fallback: scanning all <a> tags...`);
    const allLinks = doc.querySelectorAll("a[href^='http']");
    for (const link of Array.from(allLinks)) {
      if (results.length >= numResults) break;
      const a = link as HTMLAnchorElement;
      const href = a.getAttribute("href") || "";
      const text = (a.textContent || "").trim();

      if (href.includes("bing.com") || href.includes("duckduckgo.com")) continue;
      if (text.length < 5 || text.length > 200) continue;
      if (seenUrls.has(href)) continue;

      let description = "";
      const sibling = a.parentElement?.nextElementSibling;
      if (sibling) description = (sibling.textContent || "").trim();
      if (!description && a.parentElement) {
        description = (a.parentElement.textContent || "").replace(text, "").trim();
      }

      seenUrls.add(href);
      results.push({ title: text, url: href, description: description.substring(0, 500) || text });
    }
  }

  console.log(`[Web Search] ${engineName} total extracted:`, results.length);
  return results;
}

async function searchBing(query: string, numResults: number): Promise<SearchResult[]> {
  console.log("[Web Search] Trying Bing (generic parser)...");
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${numResults}&setmkt=en-US&setlang=en`;

  const { status, body: html } = await rustFetch(url);
  console.log("[Web Search] Bing status:", status, "length:", html?.length || 0);

  if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
  if (!html || html.length < 200) throw new Error("Empty/blocked response");

  logRaw("Bing HTML", html, 2000);
  return extractResultsFromHtml(html, numResults, "Bing");
}

async function searchDuckDuckGoLite(query: string, numResults: number): Promise<SearchResult[]> {
  console.log("[Web Search] Trying DuckDuckGo Lite (generic parser)...");
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}&kl=us-en`;

  const { status, body: html } = await rustFetch(url);
  console.log("[Web Search] DDG Lite status:", status, "length:", html?.length || 0);

  if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
  if (!html || html.length < 200) throw new Error("Empty/blocked response");

  logRaw("DDG Lite HTML", html, 2000);
  return extractResultsFromHtml(html, numResults, "DDG Lite");
}

// ========== CONTENT EXTRACTION (tables, lists, headings, paragraphs) ==========

function isPdfUrl(url: string): boolean {
  return url.toLowerCase().endsWith(".pdf");
}

export async function extractPageContent(
  url: string,
  maxLength: number = 3000
): Promise<{ content: string; status: "success" | "error"; error?: string }> {
  if (isPdfUrl(url)) {
    return { content: "", status: "error", error: "PDF files not supported" };
  }

  // Wikipedia: prefer API extract for the lead section, then supplement with structured HTML
  if (url.includes("wikipedia.org") || url.includes("wikimedia.org")) {
    const titleMatch = url.match(/wiki\/(.+)$/);
    if (titleMatch) {
      const title = decodeURIComponent(titleMatch[1]).replace(/_/g, " ");
      const apiExtract = await fetchWikipediaExtract(title, maxLength);
      if (apiExtract) {
        return { content: apiExtract, status: "success" };
      }
    }
  }

  try {
    console.log("[Web Search] Fetching content:", url);
    const { status, body: html } = await rustFetch(url);
    console.log("[Web Search] Content status:", status, "length:", html?.length || 0);

    if (status < 200 || status >= 300) {
      return { content: "", status: "error", error: `HTTP ${status}` };
    }
    if (!html) {
      return { content: "", status: "error", error: "Empty response" };
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // Remove noise before parsing
    const removeSelectors = [
      "script", "style", "nav", "header", "footer", "aside",
      "[class*='ad']", "[class*='advertisement']",
      "[class*='sidebar']", "[class*='widget']",
      "[class*='cookie']", "[class*='popup']",
      "[id*='ad']", "[id*='sidebar']", "[id*='cookie']",
      "iframe", "noscript", "svg", "canvas",
    ];
    removeSelectors.forEach((sel) => {
      if (sel) doc.querySelectorAll(sel).forEach((el) => el.remove());
    });

    // Find the best content container
    let contentEl: Element | null =
      doc.querySelector("#mw-content-text .mw-parser-output") ||
      doc.querySelector("#mw-content-text") ||
      doc.querySelector(".mw-parser-output") ||
      doc.querySelector("article") ||
      doc.querySelector("main") ||
      doc.querySelector('[role="main"]') ||
      doc.querySelector(".content") ||
      doc.querySelector("#content") ||
      doc.querySelector("#main-content") ||
      doc.querySelector(".main-content") ||
      doc.querySelector(".post-content") ||
      doc.querySelector(".entry-content") ||
      doc.querySelector("[class*='article']") ||
      doc.querySelector("[class*='post-body']") ||
      doc.querySelector("body");

    if (!contentEl) {
      return { content: "", status: "error", error: "No content found" };
    }

    const text = extractStructuredText(contentEl, maxLength);

    if (maxLength > 0 && text.length > maxLength) {
      return { content: text.substring(0, maxLength) + `\n\n[Content truncated at ${maxLength} characters]`, status: "success" };
    }

    console.log("[Web Search] Extracted:", text.length, "chars from", url);
    return { content: text, status: "success" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Web Search] Content extraction failed:", url, message);
    return { content: "", status: "error", error: message };
  }
}

// ========== QUERY REWRITING ==========

export interface RewriteQueryOptions {
  apiUrl: string;
  model: string;
  messages: { role: string; content: string }[];
  currentInput: string;
}

function lastWordsFallback(input: string): string {
  const words = input.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length <= 4) return input.trim();
  return words.slice(-4).join(" ");
}

export async function rewriteSearchQuery(options: RewriteQueryOptions): Promise<string | null> {
  const { apiUrl, model, messages, currentInput } = options;

  const historyMessages = messages.slice(-4).map((m) => ({
    role: m.role as "user" | "assistant" | "system",
    content: m.content,
  }));

  const payload = {
    model,
    messages: [
      {
        role: "system" as const,
        content:
          "You are a search query generator. Output ONLY the search keywords based on the user prompt. Max 4 words. No quotes, no explanation. If it is a greeting or does not need a search, output exactly: NO_SEARCH",
      },
      ...historyMessages,
      { role: "user" as const, content: currentInput },
    ],
    stream: false,
  };

  console.log("[Web Search] Rewriting query via Ollama /api/chat...");
  const start = performance.now();

  let raw = "";
  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(`Ollama rewriter HTTP ${res.status}`);
    }

    const data = await res.json();
    raw = String(data.message?.content ?? "").trim();

    const elapsed = Math.round(performance.now() - start);
    console.log("[Web Search] Rewriter raw output (" + elapsed + "ms): '" + raw + "'");
  } catch (err) {
    const elapsed = Math.round(performance.now() - start);
    console.error("[Web Search] Rewriter call failed after " + elapsed + "ms:", err);
    return lastWordsFallback(currentInput);
  }

  if (!raw || raw.toUpperCase() === "NO_SEARCH") {
    console.log("[Web Search] Rewriter returned NO_SEARCH");
    return null;
  }

  let cleaned = raw
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || cleaned.length < 2) {
    console.log("[Web Search] Rewriter returned empty after cleanup, using word fallback");
    return lastWordsFallback(currentInput);
  }

  return cleaned;
}

// ========== MAIN SEARCH FUNCTION ==========

export async function searchWithContent(
  query: string,
  limit: number = 5,
  includeContent: boolean = true,
  rewriterOptions?: RewriteQueryOptions
): Promise<SearchResponse> {
  const startTime = Date.now();
  console.log("[Web Search] ========== Starting search for:", query);

  // ------------------------------------------------------------------
  // 1. URL BYPASS: if the query contains a direct URL, fetch it directly
  // ------------------------------------------------------------------
  const directUrl = extractUrlFromQuery(query);
  if (directUrl) {
    console.log("[Web Search] Direct URL detected:", directUrl);
    const extracted = await extractPageContent(directUrl, 12000);

    return {
      results: [
        {
          title: "Direct Source",
          url: directUrl,
          description: extracted.content.substring(0, 300),
          fullContent: extracted.content,
          fetchStatus: extracted.status,
          error: extracted.error,
        },
      ],
      totalResults: 1,
      engine: "direct-url",
      status: `Direct URL fetch; ${extracted.content.length} chars; ${extracted.status}`,
    };
  }

  // ------------------------------------------------------------------
  // 2. QUERY REWRITING: conversational → standalone search keywords
  // ------------------------------------------------------------------
  let searchQuery = query;
  if (rewriterOptions) {
    const rewritten = await rewriteSearchQuery(rewriterOptions);
    if (rewritten === null) {
      console.log("[Web Search] Rewriter says NO_SEARCH, skipping web search");
      return {
        results: [],
        totalResults: 0,
        engine: "none",
        status: "NO_SEARCH",
      };
    }
    searchQuery = rewritten;
    console.log("[Web Search] Original:", query, "→ Rewritten:", searchQuery);
  }

  // ------------------------------------------------------------------
  // 3. SEARCH ENGINES: API-based first, then HTML scraping fallback
  // ------------------------------------------------------------------
  let results: SearchResult[] = [];
  let engine = "";
  const errors: string[] = [];

  const engines = [
    { name: "DuckDuckGo API", fn: () => searchDuckDuckGoAPI(searchQuery, Math.min(limit * 2 + 2, 10)) },
    { name: "Wikipedia", fn: () => searchWikipedia(searchQuery, Math.min(limit * 2 + 2, 10)) },
    { name: "Bing", fn: () => searchBing(searchQuery, Math.min(limit * 2 + 2, 10)) },
    { name: "DuckDuckGo Lite", fn: () => searchDuckDuckGoLite(searchQuery, Math.min(limit * 2 + 2, 10)) },
  ];

  for (const eng of engines) {
    try {
      results = await eng.fn();
      if (results.length > 0) {
        engine = eng.name;
        console.log("[Web Search] Success with", eng.name, "-", results.length, "results");
        break;
      }
      console.log("[Web Search]", eng.name, "returned 0 results, trying next...");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "failed";
      console.error("[Web Search]", eng.name, "failed:", msg);
      errors.push(`${eng.name}: ${msg}`);
    }
  }

  if (results.length === 0) {
    const status = `All search engines failed: ${errors.join("; ")}`;
    console.error("[Web Search]", status);
    return {
      results: [],
      totalResults: 0,
      engine: "none",
      status,
    };
  }

  const nonPdfResults = results.filter((r) => !isPdfUrl(r.url));
  const pdfCount = results.length - nonPdfResults.length;

  let enhancedResults = nonPdfResults;

  if (includeContent) {
    const targetCount = Math.min(limit, nonPdfResults.length);
    const resultsToExtract = nonPdfResults.slice(0, targetCount);

    const extractionPromises = resultsToExtract.map(async (result) => {
      const extracted = await extractPageContent(result.url);
      return {
        ...result,
        fullContent: extracted.content,
        fetchStatus: extracted.status,
        error: extracted.error,
      };
    });

    const extractedResults = await Promise.all(extractionPromises);
    enhancedResults = [...extractedResults, ...nonPdfResults.slice(targetCount)];
  }

  const finalResults = enhancedResults.slice(0, limit);

  const successCount = finalResults.filter((r) => r.fetchStatus === "success").length;
  const failedCount = finalResults.filter((r) => r.fetchStatus === "error").length;
  const searchTime = Date.now() - startTime;

  let status = `Engine: ${engine}; ${limit} requested/${results.length} obtained`;
  if (pdfCount > 0) status += `; PDF skipped: ${pdfCount}`;
  if (includeContent) {
    status += `; Extracted: ${successCount}; Failed: ${failedCount}`;
  }
  status += `; ${searchTime}ms`;

  console.log("[Web Search] Final:", status);

  return {
    results: finalResults,
    totalResults: finalResults.length,
    engine,
    status,
  };
}

export async function searchSummaries(query: string, limit: number = 5): Promise<SearchResponse> {
  return searchWithContent(query, limit, false);
}
