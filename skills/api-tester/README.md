# API Tester Skill

Test, debug, and document API endpoints with request building and response analysis.

## Features

- **Endpoint Testing**: Test APIs and analyze responses
- **cURL Generation**: Generate cURL commands for requests
- **Response Analysis**: Parse and validate API responses
- **Documentation Generation**: Create API docs from examples

## Tools

### `test_endpoint`

Test an API endpoint and analyze the response.

**Parameters:**
- `url` (required): The endpoint URL
- `method` (optional): HTTP method (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS)
- `headers` (optional): Request headers object
- `body` (optional): Request body (JSON string)
- `timeout_ms` (optional): Request timeout in milliseconds

**Example:**
```json
{
  "url": "https://api.example.com/users",
  "method": "POST",
  "headers": {
    "Authorization": "Bearer token123"
  },
  "body": "{\"name\": \"John\"}"
}
```

**Returns:**
- Status code and text
- Response headers and body
- Timing information
- Analysis with issues and suggestions

### `generate_curl`

Generate a cURL command for an API request.

**Parameters:**
- `url` (required): The endpoint URL
- `method` (optional): HTTP method
- `headers` (optional): Request headers
- `body` (optional): Request body

**Returns:**
- Single-line cURL command
- Readable multi-line format

### `parse_api_response`

Parse and analyze an API response.

**Parameters:**
- `response_body` (required): The response body to analyze
- `expected_schema` (optional): Expected JSON schema for validation

**Returns:**
- JSON validity
- Data type (object, array, etc.)
- Field list
- Nesting depth
- Schema match status

### `generate_api_docs`

Generate API documentation from examples.

**Parameters:**
- `endpoint` (required): Endpoint path
- `method` (required): HTTP method
- `request_example` (optional): Example request body
- `response_example` (optional): Example response body
- `description` (optional): Endpoint description

**Returns:**
- Markdown documentation
- OpenAPI snippet

## Response Analysis

The tool automatically checks for:
- Slow responses (>1s)
- Missing headers (Content-Type, Cache-Control)
- CORS issues
- HTTP error codes
- Authentication problems
- Rate limiting

## Triggers

- "api"
- "endpoint"
- "request"
- "curl"
- "http"
- "rest"
- "graphql"
- "postman"

## Usage Examples

1. "Test this API endpoint: https://api.example.com/users"
2. "Generate a cURL command for posting to the API"
3. "Analyze this API response for issues"
4. "Create documentation for my endpoint"
