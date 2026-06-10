/**
 * Multi-engine web search with full page content extraction.
 * Inspired by web-search-mcp (https://github.com/mrkrsl/web-search-mcp)
 *
 * Uses a custom Rust backend command (reqwest) instead of the browser fetch
 * or Tauri's built-in HTTP API. This bypasses all CORS, SSL, and bot-detection
 * issues because requests originate from the native Rust layer.
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

async function tauriGet(url: string, _referer?: string): Promise<{ status: number; data: string }> {
  // Use custom Rust command instead of Tauri's built-in HTTP API.
  // The Rust backend uses reqwest which is much more reliable for web scraping.
  const res = await invoke<FetchResponse>("fetch_url", { url });
  return { status: res.status, data: res.body };
}

// ========== SEARCH ENGINES ==========

async function searchDuckDuckGoLite(query: string, numResults: number): Promise<SearchResult[]> {
  console.log("[Web Search] Trying DuckDuckGo Lite...");
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}&kl=us-en`;

  const { status, data: html } = await tauriGet(url, "https://lite.duckduckgo.com/");
  console.log("[Web Search] DDG Lite status:", status, "length:", html?.length || 0);

  if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
  if (!html || html.length < 200) throw new Error("Empty/blocked response");

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const results: SearchResult[] = [];

  // DuckDuckGo Lite structure: results in table rows
  const rows = doc.querySelectorAll("table tbody tr");
  rows.forEach((row) => {
    if (results.length >= numResults) return;
    const linkEl = row.querySelector("a.result-link") as HTMLAnchorElement | null;
    const snippetEl = row.querySelector(".result-snippet");
    if (!linkEl) return;

    const title = linkEl.textContent?.trim() || "";
    const href = linkEl.getAttribute("href") || "";
    const snippet = snippetEl?.textContent?.trim() || "";

    // Resolve relative redirects
    let url = href;
    if (href.startsWith("/")) {
      url = `https://lite.duckduckgo.com${href}`;
    } else if (href.startsWith("javascript:")) {
      return; // skip JS links
    }

    if (title && url && snippet && url.startsWith("http")) {
      results.push({ title, url, description: snippet });
    }
  });

  console.log("[Web Search] DDG Lite parsed:", results.length);
  return results;
}

async function searchDuckDuckGoHtml(query: string, numResults: number): Promise<SearchResult[]> {
  console.log("[Web Search] Trying DuckDuckGo HTML...");
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=us-en`;

  const { status, data: html } = await tauriGet(url, "https://html.duckduckgo.com/");
  console.log("[Web Search] DDG HTML status:", status, "length:", html?.length || 0);

  if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
  if (!html || html.length < 200) throw new Error("Empty/blocked response");

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const results: SearchResult[] = [];
  const resultElements = doc.querySelectorAll(".result");

  resultElements.forEach((el, idx) => {
    if (idx >= numResults) return;
    const titleEl = el.querySelector(".result__a") as HTMLAnchorElement | null;
    const snippetEl = el.querySelector(".result__snippet");
    const title = titleEl?.textContent?.trim();
    const url = titleEl?.getAttribute("href") || "";
    const snippet = snippetEl?.textContent?.trim();
    if (title && url && snippet) {
      results.push({ title, url, description: snippet });
    }
  });

  console.log("[Web Search] DDG HTML parsed:", results.length);
  return results;
}

async function searchBing(query: string, numResults: number): Promise<SearchResult[]> {
  console.log("[Web Search] Trying Bing...");
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${numResults}&setmkt=en-US&setlang=en`;

  const { status, data: html } = await tauriGet(url, "https://www.bing.com/");
  console.log("[Web Search] Bing status:", status, "length:", html?.length || 0);

  if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
  if (!html || html.length < 200) throw new Error("Empty/blocked response");

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const results: SearchResult[] = [];

  // Bing result selectors
  const selectors = [".b_algo", "[data-bing-meta] li.b_algo", "#b_content .b_algo"];
  let resultElements: NodeListOf<Element> | null = null;
  for (const selector of selectors) {
    const els = doc.querySelectorAll(selector);
    if (els.length > 0) {
      resultElements = els;
      break;
    }
  }

  resultElements?.forEach((el, idx) => {
    if (idx >= numResults) return;
    const linkEl = el.querySelector("h2 a") as HTMLAnchorElement | null;
    const snippetEl = el.querySelector("p, .b_caption p");
    const title = linkEl?.textContent?.trim();
    let url = linkEl?.getAttribute("href") || "";
    const snippet = snippetEl?.textContent?.trim();

    if (url && url.startsWith("/")) url = `https://www.bing.com${url}`;

    if (title && url && snippet && url.startsWith("http")) {
      results.push({ title, url, description: snippet });
    }
  });

  console.log("[Web Search] Bing parsed:", results.length);
  return results;
}

async function searchSearXNG(query: string, numResults: number): Promise<SearchResult[]> {
  // Try multiple public SearXNG instances
  const instances = [
    "https://search.sapti.me",
    "https://search.bus-hit.me",
    "https://searx.be",
  ];

  for (const instance of instances) {
    try {
      console.log("[Web Search] Trying SearXNG:", instance);
      const url = `${instance}/search?q=${encodeURIComponent(query)}&format=json&language=en`;

      const { status, data: text } = await tauriGet(url, instance);
      console.log("[Web Search] SearXNG status:", status, "length:", text?.length || 0);

      if (status < 200 || status >= 300) continue;
      if (!text || text.length < 50) continue;

      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        continue;
      }

      const rawResults = json.results || [];
      const results: SearchResult[] = [];
      rawResults.slice(0, numResults).forEach((r: any) => {
        if (r.title && r.url) {
          results.push({
            title: r.title,
            url: r.url,
            description: r.content || r.abstract || "",
          });
        }
      });

      if (results.length > 0) {
        console.log("[Web Search] SearXNG success:", results.length);
        return results;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "failed";
      console.log("[Web Search] SearXNG failed:", msg);
    }
  }

  throw new Error("All SearXNG instances failed");
}

async function searchWikipedia(query: string, numResults: number): Promise<SearchResult[]> {
  console.log("[Web Search] Trying Wikipedia API...");
  // Wikipedia search API (very reliable, no bot detection)
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${numResults}&format=json&origin=*`;

  const { status, data: text } = await tauriGet(searchUrl, "https://en.wikipedia.org/");
  console.log("[Web Search] Wikipedia search status:", status);

  if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
  if (!text) throw new Error("Empty response");

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON");
  }

  const searchResults = json?.query?.search || [];
  const results: SearchResult[] = [];

  for (const item of searchResults.slice(0, numResults)) {
    const title = item.title;
    const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
    // Strip wiki markup from snippet
    const snippet = (item.snippet || "")
      .replace(/<span[^>]*>/g, "")
      .replace(/<\/span>/g, "")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/<[^>]+>/g, "");

    results.push({ title, url, description: snippet });
  }

  console.log("[Web Search] Wikipedia parsed:", results.length);
  return results;
}

// ========== CONTENT EXTRACTION ==========

function isPdfUrl(url: string): boolean {
  return url.toLowerCase().endsWith(".pdf");
}

function cleanExtractedText(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\n\s*\n/g, "\n").trim();
}

export async function extractPageContent(
  url: string,
  maxLength: number = 3000
): Promise<{ content: string; status: "success" | "error"; error?: string }> {
  if (isPdfUrl(url)) {
    return { content: "", status: "error", error: "PDF files not supported" };
  }

  try {
    console.log("[Web Search] Fetching content:", url);
    const { status, data: html } = await tauriGet(url, "https://www.google.com/");

    console.log("[Web Search] Content status:", status, "length:", html?.length || 0);

    if (status < 200 || status >= 300) {
      return { content: "", status: "error", error: `HTTP ${status}` };
    }
    if (!html) {
      return { content: "", status: "error", error: "Empty response" };
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const isWikipedia = url.includes("wikipedia.org") || url.includes("wikimedia.org");

    const removeSelectors = [
      "script", "style", "nav", "header", "footer", "aside",
      "[class*='ad']", "[class*='advertisement']",
      "[class*='sidebar']", "[class*='widget']",
      "[class*='cookie']", "[class*='popup']",
      "[id*='ad']", "[id*='sidebar']", "[id*='cookie']",
      "iframe", "noscript", "svg", "canvas",
      isWikipedia ? ".infobox" : "",
      isWikipedia ? ".toc" : "",
      isWikipedia ? ".navbox" : "",
      isWikipedia ? ".catlinks" : "",
      isWikipedia ? ".mw-editsection" : "",
      isWikipedia ? ".mw-jump-link" : "",
      isWikipedia ? ".reflist" : "",
      isWikipedia ? ".reference" : "",
      isWikipedia ? ".thumbinner" : "",
      isWikipedia ? ".image" : "",
    ].filter(Boolean);

    removeSelectors.forEach((sel) => {
      if (sel) doc.querySelectorAll(sel).forEach((el) => el.remove());
    });

    let contentEl: Element | null =
      (isWikipedia ? doc.querySelector("#mw-content-text") : null) ||
      (isWikipedia ? doc.querySelector(".mw-parser-output") : null) ||
      doc.querySelector("article") ||
      doc.querySelector("main") ||
      doc.querySelector('[role="main"]') ||
      doc.querySelector(".content") ||
      doc.querySelector("#content") ||
      doc.querySelector("#main-content") ||
      doc.querySelector(".main-content") ||
      doc.querySelector(".post") ||
      doc.querySelector(".entry") ||
      doc.querySelector(".post-content") ||
      doc.querySelector(".entry-content") ||
      doc.querySelector("[class*='article']") ||
      doc.querySelector("[class*='post-body']") ||
      doc.querySelector("body");

    if (!contentEl) {
      return { content: "", status: "error", error: "No content found" };
    }

    let text = "";
    if (isWikipedia) {
      const children = Array.from(contentEl.children);
      const leadParts: string[] = [];
      for (const child of children) {
        const tag = child.tagName.toLowerCase();
        if (tag === "h2" || tag === "h3" || tag === "section") break;
        if (["div", "table", "ul", "ol"].includes(tag)) {
          if (child.querySelector("p")) {
            leadParts.push(child.textContent || "");
          }
          continue;
        }
        leadParts.push(child.textContent || "");
      }
      text = leadParts.join("\n\n");
    }

    if (!text.trim()) {
      text = contentEl.textContent || "";
    }

    text = cleanExtractedText(text);

    if (isWikipedia) {
      text = text.replace(/Categories?:\s*.*/gi, "").trim();
    }

    if (maxLength > 0 && text.length > maxLength) {
      text = text.substring(0, maxLength) + `\n\n[Content truncated at ${maxLength} characters]`;
    }

    console.log("[Web Search] Extracted:", text.length, "chars from", url);
    return { content: text, status: "success" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Web Search] Content extraction failed:", url, message);
    return { content: "", status: "error", error: message };
  }
}

// ========== MAIN SEARCH FUNCTION ==========

export async function searchWithContent(
  query: string,
  limit: number = 5,
  includeContent: boolean = true
): Promise<SearchResponse> {
  const startTime = Date.now();
  console.log("[Web Search] ========== Starting search for:", query);

  let results: SearchResult[] = [];
  let engine = "";
  const errors: string[] = [];

  // Try engines in order
  const engines = [
    { name: "DuckDuckGo Lite", fn: () => searchDuckDuckGoLite(query, Math.min(limit * 2 + 2, 10)) },
    { name: "DuckDuckGo HTML", fn: () => searchDuckDuckGoHtml(query, Math.min(limit * 2 + 2, 10)) },
    { name: "Bing", fn: () => searchBing(query, Math.min(limit * 2 + 2, 10)) },
    { name: "SearXNG", fn: () => searchSearXNG(query, Math.min(limit * 2 + 2, 10)) },
    { name: "Wikipedia", fn: () => searchWikipedia(query, Math.min(limit * 2 + 2, 10)) },
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
        fetchStatus: extracted.status as "success" | "error",
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
