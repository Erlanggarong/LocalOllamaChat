/**
 * Multi-engine web search with full page content extraction.
 * Inspired by web-search-mcp (https://github.com/mrkrsl/web-search-mcp)
 * Ported for browser use without Playwright.
 */

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

// ========== SEARCH ENGINES ==========

async function searchDuckDuckGo(query: string, numResults: number): Promise<SearchResult[]> {
  const res = await fetch(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    }
  );
  if (!res.ok) throw new Error("DuckDuckGo search failed");
  const html = await res.text();

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const results: SearchResult[] = [];
  const resultElements = doc.querySelectorAll(".result");

  resultElements.forEach((el, idx) => {
    if (idx >= numResults) return;
    const titleEl = el.querySelector(".result__a") as HTMLAnchorElement | null;
    const snippetEl = el.querySelector(".result__snippet");
    const title = titleEl?.textContent?.trim();
    const url = titleEl?.href;
    const snippet = snippetEl?.textContent?.trim();
    if (title && url && snippet) {
      results.push({ title, url, description: snippet });
    }
  });

  return results;
}

async function searchBing(query: string, numResults: number): Promise<SearchResult[]> {
  const res = await fetch(
    `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${numResults}`,
    {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html",
        "Accept-Language": "en-US,en;q=0.9",
      },
    }
  );
  if (!res.ok) throw new Error("Bing search failed");
  const html = await res.text();

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const results: SearchResult[] = [];
  const selectors = ["[data-bing-meta] li.b_algo", ".b_algo", "#b_content .b_algo", ".results li"];

  let resultElements: NodeListOf<Element> | null = null;
  for (const selector of selectors) {
    const els = doc.querySelectorAll(selector);
    if (els.length > 0) {
      resultElements = els;
      break;
    }
  }

  if (!resultElements || resultElements.length === 0) {
    resultElements = doc.querySelectorAll('li:has(h2 a), .result, [class*="result"]');
  }

  resultElements.forEach((el, idx) => {
    if (idx >= numResults) return;
    const linkEl = el.querySelector("h2 a, .b_attribution a, a[href]") as HTMLAnchorElement | null;
    const snippetEl = el.querySelector("p, .b_caption p, [class*='snippet'], [class*='content']");
    const title = linkEl?.textContent?.trim();
    let url = linkEl?.href;
    const snippet = snippetEl?.textContent?.trim();

    if (url && url.startsWith("/")) {
      url = `https://www.bing.com${url}`;
    }

    if (title && url && snippet && url.startsWith("http")) {
      results.push({ title, url, description: snippet });
    }
  });

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
  maxLength: number = 8000
): Promise<{ content: string; status: "success" | "error"; error?: string }> {
  if (isPdfUrl(url)) {
    return { content: "", status: "error", error: "PDF files not supported" };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "text/html",
      },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { content: "", status: "error", error: `HTTP ${res.status}` };
    }

    const html = await res.text();
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
      doc.querySelectorAll(sel).forEach((el) => el.remove());
    });

    let contentEl: Element | null =
      doc.querySelector("article") ||
      doc.querySelector("main") ||
      doc.querySelector('[role="main"]') ||
      doc.querySelector(".content") ||
      doc.querySelector("#content") ||
      doc.querySelector(".post") ||
      doc.querySelector(".entry") ||
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

    return { content: text, status: "success" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
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

  let results: SearchResult[] = [];
  let engine = "";
  const errors: string[] = [];

  try {
    const searchLimit = includeContent ? Math.min(limit * 2 + 2, 10) : limit;
    results = await searchDuckDuckGo(query, searchLimit);
    engine = "DuckDuckGo";
  } catch (err) {
    errors.push(`DuckDuckGo: ${err instanceof Error ? err.message : "failed"}`);
    try {
      const searchLimit = includeContent ? Math.min(limit * 2 + 2, 10) : limit;
      results = await searchBing(query, searchLimit);
      engine = "Bing";
    } catch (err2) {
      errors.push(`Bing: ${err2 instanceof Error ? err2.message : "failed"}`);
    }
  }

  if (results.length === 0) {
    return {
      results: [],
      totalResults: 0,
      engine: "none",
      status: `All search engines failed: ${errors.join("; ")}`,
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
