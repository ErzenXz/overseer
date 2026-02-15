import { z } from "zod";
const DDG_API_URL = "https://api.duckduckgo.com/";
const DDG_HTML_URL = "https://html.duckduckgo.com/html/";
async function webSearch(params) {
  const { query, max_results = 5 } = params;
  try {
    const searchUrl = new URL(DDG_API_URL);
    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("format", "json");
    searchUrl.searchParams.set("no_html", "1");
    searchUrl.searchParams.set("skip_disambig", "1");
    const response = await fetch(searchUrl.toString(), {
      headers: {
        "User-Agent": "Overseer/1.0 (AI Assistant)"
      }
    });
    if (!response.ok) {
      throw new Error(`Search failed: ${response.statusText}`);
    }
    const data = await response.json();
    const results = [];
    if (data.Abstract && data.AbstractURL) {
      results.push({
        title: data.Heading || query,
        url: data.AbstractURL,
        snippet: data.Abstract,
        source: data.AbstractSource
      });
    }
    if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
      for (const topic of data.RelatedTopics.slice(0, max_results - results.length)) {
        if (topic.FirstURL && topic.Text) {
          results.push({
            title: topic.Text.split(" - ")[0] || topic.Text.substring(0, 100),
            url: topic.FirstURL,
            snippet: topic.Text
          });
        }
        if (topic.Topics && Array.isArray(topic.Topics)) {
          for (const subtopic of topic.Topics.slice(0, 2)) {
            if (subtopic.FirstURL && subtopic.Text && results.length < max_results) {
              results.push({
                title: subtopic.Text.split(" - ")[0] || subtopic.Text.substring(0, 100),
                url: subtopic.FirstURL,
                snippet: subtopic.Text
              });
            }
          }
        }
      }
    }
    if (data.Results && Array.isArray(data.Results)) {
      for (const result of data.Results.slice(0, max_results - results.length)) {
        if (result.FirstURL && result.Text) {
          results.push({
            title: result.Text.split(" - ")[0] || result.Text.substring(0, 100),
            url: result.FirstURL,
            snippet: result.Text
          });
        }
      }
    }
    if (results.length === 0) {
      const htmlResults = await searchHtmlFallback(query, max_results);
      results.push(...htmlResults);
    }
    return {
      success: true,
      results: results.slice(0, max_results),
      query
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      results: [],
      query,
      error: errorMessage
    };
  }
}
async function searchHtmlFallback(query, maxResults) {
  try {
    const formData = new URLSearchParams();
    formData.set("q", query);
    const response = await fetch(DDG_HTML_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Overseer/1.0 (AI Assistant)"
      },
      body: formData.toString()
    });
    if (!response.ok) {
      return [];
    }
    const html = await response.text();
    const results = [];
    const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
    const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([^<]*)<\/a>/gi;
    let match;
    const urls = [];
    const titles = [];
    const snippets = [];
    while ((match = resultRegex.exec(html)) !== null && urls.length < maxResults) {
      urls.push(decodeURIComponent(match[1].replace(/\/\/duckduckgo\.com\/l\/\?uddg=/, "").split("&")[0]));
      titles.push(match[2].trim());
    }
    while ((match = snippetRegex.exec(html)) !== null && snippets.length < maxResults) {
      snippets.push(match[1].trim());
    }
    for (let i = 0; i < Math.min(urls.length, maxResults); i++) {
      results.push({
        title: titles[i] || `Result ${i + 1}`,
        url: urls[i],
        snippet: snippets[i] || ""
      });
    }
    return results;
  } catch {
    return [];
  }
}
async function fetchPage(params) {
  const { url } = params;
  try {
    const parsedUrl = new URL(url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error("Only HTTP and HTTPS URLs are supported");
    }
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Overseer/1.0 (AI Assistant)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      },
      redirect: "follow"
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.statusText}`);
    }
    const html = await response.text();
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : void 0;
    const SCRIPT_RE = new RegExp("<script[^>]*>[\\s\\S]*?<\\/script>", "gi");
    const STYLE_RE = new RegExp("<style[^>]*>[\\s\\S]*?<\\/style>", "gi");
    let content = html.replace(SCRIPT_RE, "").replace(STYLE_RE, "").replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "").replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "").replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (content.length > 1e4) {
      content = content.substring(0, 1e4) + "...";
    }
    return {
      success: true,
      url,
      title,
      content
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      url,
      error: errorMessage
    };
  }
}
const webSearchSchema = z.object({
  query: z.string().describe("The search query"),
  max_results: z.number().int().min(1).max(20).default(5).describe("Maximum results")
});
const fetchPageSchema = z.object({
  url: z.string().url().describe("The URL to fetch")
});
export {
  fetchPage,
  fetchPageSchema,
  webSearch,
  webSearchSchema
};
