/**
 * Multi-engine web search with content extraction.
 *
 * Primary approach: API-based search (DuckDuckGo Instant Answer + Wikipedia).
 * These are official/free APIs with no bot detection and JSON responses.
 *
 * Fallback: HTML scraping via custom Rust reqwest command.
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

// ========== API-BASED SEARCH ENGINES (Primary) ==========

/**
 * DuckDuckGo Instant Answer API — official, free, JSON.
 * https://duckduckgo.com/api
 */
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

  // Main abstract
  if (data.AbstractText && data.AbstractURL) {
    results.push({
      title: data.Heading || query,
      url: data.AbstractURL,
      description: data.AbstractText,
    });
  }

  // Related topics
  const related = data.RelatedTopics || [];
  for (const topic of related) {
    if (results.length >= limit) break;
    if (topic.Text && topic.FirstURL) {
      results.push({
        title: topic.Text.split(" - ")[0] || topic.Text.substring(0, 60),
        url: topic.FirstURL,
        description: topic.Text,
      });
    }
    // Nested topics (sometimes DDG groups them)
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

  // Results array (if present)
  const resultList = data.Results || [];
  for (const r of resultList) {
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

/**
 * Wikipedia Search API — very reliable, no bot detection.
 */
async function searchWikipedia(query: string, limit: number): Promise<SearchResult[]> {
  console.log("[Web Search] Trying Wikipedia API...");
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${limit}&format=json&origin=*`;

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

  const searchResults = data?.query?.search || [];
  const results: SearchResult[] = [];

  for (const item of searchResults.slice(0, limit)) {
    const title = item.title;
    const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
    const snippet = (item.snippet || "")
      .replace(/<[^>]+>/g, "")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&amp;/g, "&");

    results.push({ title, url, description: snippet });
  }

  console.log("[Web Search] Wikipedia parsed:", results.length);
  return results;
}

/**
 * Fetch Wikipedia lead section (before first heading) for a given title.
 */
async function fetchWikipediaExtract(title: string, maxLength: number): Promise<string> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=true&explaintext=true&titles=${encodeURIComponent(title)}&format=json&origin=*`;
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

// ========== FALLBACK: HTML SCRAPING ==========

async function searchDuckDuckGoLite(query: string, numResults: number): Promise<SearchResult[]> {
  console.log("[Web Search] Trying DuckDuckGo Lite (fallback)...");
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}&kl=us-en`;

  const { status, body: html } = await rustFetch(url);
  console.log("[Web Search] DDG Lite status:", status, "length:", html?.length || 0);

  if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
  if (!html || html.length < 200) throw new Error("Empty/blocked response");

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const results: SearchResult[] = [];

  const rows = doc.querySelectorAll("table tbody tr");
  rows.forEach((row) => {
    if (results.length >= numResults) return;
    const linkEl = row.querySelector("a.result-link") as HTMLAnchorElement | null;
    const snippetEl = row.querySelector(".result-snippet");
    if (!linkEl) return;
    const title = linkEl.textContent?.trim() || "";
    const href = linkEl.getAttribute("href") || "";
    const snippet = snippetEl?.textContent?.trim() || "";
    let url = href;
    if (href.startsWith("/")) url = `https://lite.duckduckgo.com${href}`;
    if (title && url && snippet && url.startsWith("http") && !url.includes("duckduckgo")) {
      results.push({ title, url, description: snippet });
    }
  });

  console.log("[Web Search] DDG Lite parsed:", results.length);
  return results;
}

async function searchBing(query: string, numResults: number): Promise<SearchResult[]> {
  console.log("[Web Search] Trying Bing (fallback)...");
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${numResults}&setmkt=en-US&setlang=en`;

  const { status, body: html } = await rustFetch(url);
  console.log("[Web Search] Bing status:", status, "length:", html?.length || 0);

  if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
  if (!html || html.length < 200) throw new Error("Empty/blocked response");

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const results: SearchResult[] = [];

  const resultElements = doc.querySelectorAll(".b_algo");
  resultElements.forEach((el, idx) => {
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

  // Special case: Wikipedia — use API instead of scraping
  if (url.includes("wikipedia.org") || url.includes("wikimedia.org")) {
    const titleMatch = url.match(/wiki\/(.+)$/);
    if (titleMatch) {
      const title = decodeURIComponent(titleMatch[1]).replace(/_/g, " ");
      const extract = await fetchWikipediaExtract(title, maxLength);
      if (extract) {
        return { content: extract, status: "success" };
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

  // Priority: API-based first (reliable), then HTML scraping (fallback)
  const engines = [
    { name: "DuckDuckGo API", fn: () => searchDuckDuckGoAPI(query, Math.min(limit * 2 + 2, 10)) },
    { name: "Wikipedia", fn: () => searchWikipedia(query, Math.min(limit * 2 + 2, 10)) },
    { name: "DuckDuckGo Lite", fn: () => searchDuckDuckGoLite(query, Math.min(limit * 2 + 2, 10)) },
    { name: "Bing", fn: () => searchBing(query, Math.min(limit * 2 + 2, 10)) },
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
