# Performance Optimizer Skill

Analyze and optimize application performance, identify bottlenecks, and suggest improvements.

## Features

- **Bundle Analysis**: Identify large dependencies and optimization opportunities
- **Code Performance**: Detect performance anti-patterns in code
- **Query Analysis**: Analyze database queries for performance issues
- **Caching Strategies**: Get caching recommendations

## Tools

### `analyze_bundle`

Analyze JavaScript bundle for optimization.

**Parameters:**
- `project_path` (required): Path to the project root

**Returns:**
- Large/heavy dependencies
- Duplicate packages
- Bundle optimization recommendations

### `check_code_performance`

Check code for performance anti-patterns.

**Parameters:**
- `file_path` (required): Path to the file to analyze

**Detects:**
- Inefficient array operations
- DOM performance issues
- Async anti-patterns
- Memory leaks
- React performance issues

### `analyze_database_queries`

Analyze database queries for performance.

**Parameters:**
- `queries` (required): Array of SQL queries to analyze

**Checks:**
- SELECT * usage
- Missing WHERE/LIMIT
- Index usage problems
- N+1 query patterns
- Expensive operations

### `suggest_caching`

Get caching recommendations.

**Parameters:**
- `description` (required): Description of what to cache
- `current_latency_ms` (optional): Current response time
- `requests_per_minute` (optional): Request rate

**Returns:**
- Appropriate caching strategies
- TTL recommendations
- Implementation guidance

## Performance Categories

| Category | Description |
|----------|-------------|
| `array` | Array operation inefficiencies |
| `async` | Async/await anti-patterns |
| `dom` | DOM performance issues |
| `react` | React-specific issues |
| `memory` | Memory usage concerns |
| `query` | Database query issues |
| `bundle-size` | Bundle size problems |

## Heavy Dependencies Flagged

- moment (use date-fns/dayjs)
- lodash (use lodash-es)
- jquery (use native APIs)
- request (use fetch/axios)

## Triggers

- "performance"
- "optimize"
- "slow"
- "speed"
- "latency"
- "bottleneck"
- "memory"
- "cpu"

## Usage Examples

1. "Analyze my bundle for optimization opportunities"
2. "Check this file for performance issues"
3. "Optimize my database queries"
4. "What caching strategy should I use for my API?"
