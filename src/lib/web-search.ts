/**
 * Multi-engine web search with content extraction.
 *
 * All HTTP requests go through a custom Rust backend command (reqwest)
 * to bypass CORS/bot-detection entirely. Parsing uses resilient,
 * generic selectors instead of brittle class names.
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

// ========== 1. WIKIPEDIA API (JSON) ==========

async function searchWikipedia(query: string, limit: number): Promise<SearchResult[]> {
  console.log("[Web Search] Trying Wikipedia API...");
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${limit}&format=json&utf8=1&redirects=1`;

  const { status, body } = await rustFetch(url);
  console.log("[Web Search] Wikipedia status:", status);
  logRaw("Wikipedia", body, 1500);

  if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
  if (!body || body.length < 50) throw new Error("Empty response");

  let data: any;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("Invalid JSON");
  }

  // Check for API-level errors
  if (data.error) {
    throw new Error(`Wikipedia API error: ${data.error.info || JSON.stringify(data.error)}`);
  }

  const searchResults = data?.query?.search;
  if (!Array.isArray(searchResults)) {
    console.log("[Web Search] Wikipedia unexpected structure keys:", Object.keys(data));
    throw new Error("Unexpected JSON structure: query.search missing");
  }

  console.log("[Web Search] Wikipedia raw results count:", searchResults.length);

  const results: SearchResult[] = [];
  for (const item of searchResults.slice(0, limit)) {
    const title = item.title;
    if (!title) continue;
    const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
    const snippet = (item.snippet || "")
      .replace(/<[^>]+>/g, "") // strip HTML tags
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

// ========== 2. DUCKDUCKGO INSTANT ANSWER API (JSON) ==========

async function searchDuckDuckGoAPI(query: string, limit: number): Promise<SearchResult[]> {
  console.log("[Web Search] Trying DuckDuckGo Instant Answer API...");
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&t=mykizo`;

  const { status, body } = await rustFetch(url);
  console.log("[Web Search] DDG API status:", status);
  logRaw("DDG API", body, 1500);

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
    console.log("[Web Search] DDG API abstract:", data.Heading, "|", data.AbstractText.substring(0, 80));
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

  // Results array
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

// ========== 3. GENERIC HTML SCRAPING (resilient, no brittle classes) ==========

/**
 * Generic search-result extractor from HTML.
 * Instead of relying on obfuscated class names, we look for structural patterns:
 *  - <li> elements containing an <a> with an external URL
 *  - Nearby <p> or <div> with substantial text for the description
 */
function extractResultsFromHtml(
  html: string,
  numResults: number,
  engineName: string
): SearchResult[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const results: SearchResult[] = [];
  const seenUrls = new Set<string>();

  // Strategy 1: Look for <li> or <div> containers that have both a link and text
  const containers = doc.querySelectorAll("li, div, article");
  console.log(`[Web Search] ${engineName} scanning ${containers.length} containers...`);

  for (const container of Array.from(containers)) {
    if (results.length >= numResults) break;

    // Find the primary link in this container
    const links = container.querySelectorAll("a[href]");
    let bestLink: HTMLAnchorElement | null = null;

    for (const link of Array.from(links)) {
      const a = link as HTMLAnchorElement;
      const href = a.getAttribute("href") || "";
      const text = (a.textContent || "").trim();

      // Skip internal/navigation links
      if (!href.startsWith("http")) continue;
      if (href.includes("bing.com") || href.includes("duckduckgo.com") || href.includes("microsoft.com")) continue;
      if (text.length < 3) continue;

      // Prefer links inside headings (h2, h3)
      const parentTag = a.parentElement?.tagName.toLowerCase() || "";
      const grandparentTag = a.parentElement?.parentElement?.tagName.toLowerCase() || "";
      if (parentTag === "h2" || parentTag === "h3" || grandparentTag === "h2" || grandparentTag === "h3") {
        bestLink = a;
        break;
      }
      // Otherwise pick the first valid one
      if (!bestLink) bestLink = a;
    }

    if (!bestLink) continue;

    const url = bestLink.getAttribute("href") || "";
    const title = (bestLink.textContent || "").trim();

    if (!url || !title || seenUrls.has(url)) continue;

    // Find description: look for <p> or text-rich <div> inside same container
    let description = "";
    const textEls = container.querySelectorAll("p, span, div");
    for (const el of Array.from(textEls)) {
      const txt = (el.textContent || "").trim();
      // Must be substantial, and NOT just the title repeated
      if (txt.length > 20 && txt !== title && !txt.includes(title)) {
        description = txt;
        break;
      }
    }

    // Fallback: if no <p> found, try the container's own text minus the link text
    if (!description) {
      const containerText = (container.textContent || "").replace(title, "").trim();
      if (containerText.length > 20) {
        description = containerText.substring(0, 300);
      }
    }

    if (description) {
      console.log(`[Web Search] ${engineName} candidate: "${title.substring(0, 60)}..." | ${url.substring(0, 60)}... | desc:${description.substring(0, 80)}...`);
      seenUrls.add(url);
      results.push({ title, url, description: description.substring(0, 500) });
    }
  }

  // Strategy 2: If still nothing, scan ALL <a> tags with external URLs
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

      // Look for a nearby sibling/parent text node as description
      let description = "";
      let sibling = a.parentElement?.nextElementSibling;
      if (sibling) {
        description = (sibling.textContent || "").trim();
      }
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

  // Wikipedia: use API instead of scraping
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

    let contentEl: Element | null =
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

    let text = contentEl.textContent || "";
    text = cleanExtractedText(text);

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
    { name: "Bing", fn: () => searchBing(query, Math.min(limit * 2 + 2, 10)) },
    { name: "DuckDuckGo Lite", fn: () => searchDuckDuckGoLite(query, Math.min(limit * 2 + 2, 10)) },
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
