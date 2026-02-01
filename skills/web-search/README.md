# Web Search Skill

Search the web using DuckDuckGo's free API to find information, articles, and resources online.

## Features

- **Web Search**: Search the internet using DuckDuckGo
- **Page Fetching**: Extract content from specific URLs
- **No API Key Required**: Uses DuckDuckGo's free public API

## Tools

### `web_search`

Search the web for information.

**Parameters:**
- `query` (required): The search query
- `max_results` (optional): Maximum number of results (default: 5)

**Example:**
```json
{
  "query": "TypeScript best practices 2024",
  "max_results": 10
}
```

### `fetch_page`

Fetch and extract content from a URL.

**Parameters:**
- `url` (required): The URL to fetch

**Example:**
```json
{
  "url": "https://example.com/article"
}
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `safe_search` | boolean | true | Enable safe search filtering |
| `region` | string | "us-en" | Search region |

## Triggers

This skill activates when you mention:
- "search"
- "look up"
- "find online"
- "google"
- "search the web"
- "web search"

## Usage Examples

1. "Search for the latest news about AI"
2. "Look up how to use React hooks"
3. "Find online resources for learning TypeScript"
4. "Google the population of Tokyo"
