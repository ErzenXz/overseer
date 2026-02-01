# Database Helper Skill

Help with database queries, schema management, migrations, and optimization.

## Features

- **Query Analysis**: Analyze SQL queries for performance and security issues
- **Migration Generation**: Generate up/down migrations for schema changes
- **Index Suggestions**: Get index recommendations based on query patterns
- **Schema Validation**: Validate schemas against best practices

## Tools

### `analyze_query`

Analyze a SQL query for issues and optimizations.

**Parameters:**
- `query` (required): The SQL query to analyze
- `dialect` (optional): SQL dialect (postgresql, mysql, sqlite)

**Example:**
```json
{
  "query": "SELECT * FROM users WHERE email = 'test@example.com'",
  "dialect": "postgresql"
}
```

### `generate_migration`

Generate a database migration.

**Parameters:**
- `operation` (required): create_table, add_column, drop_column, create_index, add_foreign_key
- `table_name` (required): Target table name
- `columns` (optional): Column definitions
- `dialect` (optional): SQL dialect

**Example:**
```json
{
  "operation": "create_table",
  "table_name": "posts",
  "columns": [
    { "name": "title", "type": "string", "nullable": false },
    { "name": "content", "type": "text" },
    { "name": "user_id", "type": "integer", "nullable": false }
  ]
}
```

### `suggest_indexes`

Suggest indexes based on query patterns.

**Parameters:**
- `table_schema` (required): Table CREATE statement
- `query_patterns` (optional): Common queries against this table

### `validate_schema`

Validate a database schema.

**Parameters:**
- `schema` (required): SQL schema to validate

## Issue Categories

| Category | Description |
|----------|-------------|
| `security` | SQL injection risks |
| `performance` | Query optimization issues |
| `schema` | Schema design problems |
| `safety` | Dangerous operations |
| `syntax` | SQL syntax issues |

## Triggers

- "database"
- "sql"
- "query"
- "migrate"
- "schema"
- "table"
- "migration"
- "db"

## Usage Examples

1. "Analyze this SQL query for performance"
2. "Generate a migration to add a new table"
3. "What indexes should I add to my users table?"
4. "Validate my database schema"
