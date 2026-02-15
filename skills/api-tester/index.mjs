import { z } from "zod";
async function testEndpoint(params) {
  const { url, method = "GET", headers = {}, body, timeout_ms = 3e4 } = params;
  const issues = [];
  const suggestions = [];
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return {
      success: false,
      url,
      method,
      timing: { total_ms: 0 },
      error: "Invalid URL format",
      analysis: { is_json: false, issues: ["Invalid URL"], suggestions: [] }
    };
  }
  const requestHeaders = {
    "User-Agent": "Overseer-API-Tester/1.0",
    "Accept": "application/json, text/plain, */*",
    ...headers
  };
  if (body && !requestHeaders["Content-Type"]) {
    requestHeaders["Content-Type"] = "application/json";
  }
  const startTime = performance.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout_ms);
    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body || void 0,
      signal: controller.signal,
      redirect: "follow"
    });
    clearTimeout(timeoutId);
    const endTime = performance.now();
    const totalMs = Math.round(endTime - startTime);
    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    const contentType = response.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");
    let responseBody;
    let responseText = "";
    try {
      responseText = await response.text();
      if (isJson) {
        responseBody = JSON.parse(responseText);
      } else {
        responseBody = responseText;
      }
    } catch {
      responseBody = responseText;
    }
    if (!response.ok) {
      issues.push(`HTTP ${response.status}: ${response.statusText}`);
    }
    if (totalMs > 1e3) {
      issues.push(`Slow response: ${totalMs}ms`);
      suggestions.push("Consider caching or optimizing the endpoint");
    }
    if (!responseHeaders["cache-control"]) {
      suggestions.push("Consider adding Cache-Control headers");
    }
    if (!responseHeaders["content-type"]) {
      issues.push("Missing Content-Type header");
    }
    if (response.status === 401) {
      suggestions.push("Check authentication credentials");
    } else if (response.status === 403) {
      suggestions.push("Check authorization/permissions");
    } else if (response.status === 404) {
      suggestions.push("Verify the endpoint URL is correct");
    } else if (response.status === 429) {
      issues.push("Rate limited");
      suggestions.push("Implement rate limiting handling with backoff");
    } else if (response.status >= 500) {
      issues.push("Server error");
      suggestions.push("Check server logs for details");
    }
    if (!responseHeaders["access-control-allow-origin"]) {
      suggestions.push("CORS headers not present - may fail in browser");
    }
    return {
      success: response.ok,
      url,
      method,
      status: response.status,
      statusText: response.statusText,
      timing: {
        total_ms: totalMs
      },
      headers: responseHeaders,
      body: responseBody,
      analysis: {
        is_json: isJson,
        content_type: contentType,
        response_size: responseText.length,
        issues,
        suggestions
      }
    };
  } catch (error) {
    const endTime = performance.now();
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    if (errorMessage.includes("abort")) {
      issues.push("Request timed out");
      suggestions.push(`Increase timeout (current: ${timeout_ms}ms)`);
    }
    return {
      success: false,
      url,
      method,
      timing: { total_ms: Math.round(endTime - startTime) },
      error: errorMessage,
      analysis: {
        is_json: false,
        issues,
        suggestions
      }
    };
  }
}
async function generateCurl(params) {
  const { url, method = "GET", headers = {}, body } = params;
  const parts = ["curl"];
  if (method !== "GET") {
    parts.push(`-X ${method}`);
  }
  for (const [key, value] of Object.entries(headers)) {
    parts.push(`-H '${key}: ${value}'`);
  }
  if (body) {
    const escapedBody = body.replace(/'/g, "'\\''");
    parts.push(`-d '${escapedBody}'`);
  }
  parts.push(`'${url}'`);
  const command = parts.join(" ");
  const readable = parts.join(" \\\n  ");
  return { command, readable };
}
async function parseApiResponse(params) {
  const { response_body, expected_schema } = params;
  const issues = [];
  let parsed;
  let validJson = true;
  try {
    parsed = JSON.parse(response_body);
  } catch {
    validJson = false;
    return {
      valid_json: false,
      data_type: "string",
      nested_depth: 0,
      issues: ["Invalid JSON"]
    };
  }
  const dataType = Array.isArray(parsed) ? "array" : typeof parsed;
  const fields = dataType === "object" ? Object.keys(parsed) : void 0;
  const arrayLength = Array.isArray(parsed) ? parsed.length : void 0;
  function getDepth(obj, depth = 0) {
    if (typeof obj !== "object" || obj === null) return depth;
    const children = Object.values(obj);
    if (children.length === 0) return depth;
    return Math.max(...children.map((child) => getDepth(child, depth + 1)));
  }
  const nestedDepth = getDepth(parsed);
  if (dataType === "array" && arrayLength === 0) {
    issues.push("Empty array response");
  }
  if (dataType === "object" && fields && fields.length === 0) {
    issues.push("Empty object response");
  }
  if (nestedDepth > 5) {
    issues.push("Deeply nested structure (>5 levels)");
  }
  if (fields) {
    if (!fields.some((f) => /^(id|_id|uuid)$/i.test(f))) {
      issues.push("No ID field detected");
    }
  }
  let schemaMatch;
  if (expected_schema && expected_schema.properties) {
    schemaMatch = true;
    const expectedFields = Object.keys(expected_schema.properties);
    const requiredFields = expected_schema.required || [];
    for (const required of requiredFields) {
      if (dataType === "object" && !fields?.includes(required)) {
        schemaMatch = false;
        issues.push(`Missing required field: ${required}`);
      }
    }
  }
  return {
    valid_json: validJson,
    data_type: dataType,
    fields,
    array_length: arrayLength,
    nested_depth: nestedDepth,
    issues,
    schema_match: schemaMatch
  };
}
async function generateApiDocs(params) {
  const { endpoint, method, request_example, response_example, description } = params;
  let requestBody = null;
  let responseBody = null;
  try {
    if (request_example) requestBody = JSON.parse(request_example);
  } catch {
  }
  try {
    if (response_example) responseBody = JSON.parse(response_example);
  } catch {
  }
  let markdown = `## ${method} ${endpoint}

`;
  if (description) {
    markdown += `${description}

`;
  }
  if (requestBody) {
    markdown += `### Request

`;
    markdown += "```json\n" + JSON.stringify(requestBody, null, 2) + "\n```\n\n";
    if (typeof requestBody === "object" && !Array.isArray(requestBody)) {
      markdown += "#### Parameters\n\n";
      markdown += "| Field | Type | Description |\n";
      markdown += "|-------|------|-------------|\n";
      for (const [key, value] of Object.entries(requestBody)) {
        const type = Array.isArray(value) ? "array" : typeof value;
        markdown += `| \`${key}\` | ${type} | |
`;
      }
      markdown += "\n";
    }
  }
  if (responseBody) {
    markdown += `### Response

`;
    markdown += "```json\n" + JSON.stringify(responseBody, null, 2) + "\n```\n\n";
  }
  const openApiSnippet = {
    [endpoint]: {
      [method.toLowerCase()]: {
        summary: description || `${method} ${endpoint}`,
        responses: {
          "200": {
            description: "Successful response"
          }
        }
      }
    }
  };
  if (requestBody && method !== "GET") {
    openApiSnippet[endpoint][method.toLowerCase()].requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: Object.fromEntries(
              Object.entries(requestBody).map(([key, value]) => [
                key,
                { type: Array.isArray(value) ? "array" : typeof value }
              ])
            )
          },
          example: requestBody
        }
      }
    };
  }
  if (responseBody) {
    openApiSnippet[endpoint][method.toLowerCase()].responses["200"].content = {
      "application/json": {
        example: responseBody
      }
    };
  }
  return {
    markdown,
    openapi_snippet: openApiSnippet
  };
}
const testEndpointSchema = z.object({
  url: z.string().url().describe("Endpoint URL"),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]).optional(),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
  timeout_ms: z.number().optional()
});
const generateCurlSchema = z.object({
  url: z.string().describe("Endpoint URL"),
  method: z.string().optional(),
  headers: z.record(z.string()).optional(),
  body: z.string().optional()
});
const parseApiResponseSchema = z.object({
  response_body: z.string().describe("Response body"),
  expected_schema: z.record(z.any()).optional()
});
const generateApiDocsSchema = z.object({
  endpoint: z.string().describe("Endpoint path"),
  method: z.string().describe("HTTP method"),
  request_example: z.string().optional(),
  response_example: z.string().optional(),
  description: z.string().optional()
});
export {
  generateApiDocs,
  generateApiDocsSchema,
  generateCurl,
  generateCurlSchema,
  parseApiResponse,
  parseApiResponseSchema,
  testEndpoint,
  testEndpointSchema
};
