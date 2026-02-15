import { z } from "zod";
const DANGEROUS_PATTERNS = [
  { pattern: /SELECT\s+\*/i, message: "SELECT * can be inefficient - specify needed columns", category: "performance" },
  { pattern: /WHERE\s+1\s*=\s*1/i, message: "WHERE 1=1 pattern detected - ensure this is intentional", category: "query" },
  { pattern: /OR\s+1\s*=\s*1/i, message: "Potential SQL injection pattern detected", category: "security" },
  { pattern: /--/g, message: "SQL comment detected - may hide injection", category: "security" },
  { pattern: /;\s*DROP/i, message: "Potential SQL injection - DROP after semicolon", category: "security" },
  { pattern: /LIKE\s+['"]%/i, message: "Leading wildcard in LIKE prevents index usage", category: "performance" },
  { pattern: /NOT\s+IN\s*\(/i, message: "NOT IN can be slow - consider NOT EXISTS or LEFT JOIN", category: "performance" },
  { pattern: /ORDER\s+BY\s+RAND\(\)/i, message: "ORDER BY RAND() is very slow on large tables", category: "performance" },
  { pattern: /\bNOW\(\)/i, message: "NOW() in WHERE clause prevents query caching", category: "performance" },
  { pattern: /\bCURDATE\(\)/i, message: "CURDATE() in WHERE clause prevents query caching", category: "performance" }
];
const BEST_PRACTICES = [
  { pattern: /CREATE\s+TABLE(?!.*PRIMARY\s+KEY)/is, message: "Table should have a PRIMARY KEY", category: "schema" },
  { pattern: /VARCHAR\s*\(\s*\d{4,}\s*\)/i, message: "Very long VARCHAR - consider TEXT type", category: "schema" },
  { pattern: /FLOAT|DOUBLE/i, message: "Use DECIMAL for money/precise values", category: "schema" },
  { pattern: /DELETE\s+FROM(?!\s+WHERE)/i, message: "DELETE without WHERE - will delete all rows", category: "safety" },
  { pattern: /UPDATE(?!\s+.*WHERE)/is, message: "UPDATE without WHERE - will update all rows", category: "safety" },
  { pattern: /TRUNCATE/i, message: "TRUNCATE is not transactional - use DELETE for safety", category: "safety" }
];
async function analyzeQuery(params) {
  const { query, dialect = "postgresql" } = params;
  const issues = [];
  const suggestions = [];
  for (const { pattern, message, category } of DANGEROUS_PATTERNS) {
    if (pattern.test(query)) {
      issues.push({
        severity: category === "security" ? "error" : "warning",
        category,
        message
      });
    }
  }
  for (const { pattern, message, category } of BEST_PRACTICES) {
    if (pattern.test(query)) {
      issues.push({
        severity: "warning",
        category,
        message
      });
    }
  }
  const whereColumns = query.match(/WHERE\s+(\w+)\s*[=<>]/gi);
  if (whereColumns && whereColumns.length > 0) {
    suggestions.push("Ensure columns in WHERE clause are indexed");
  }
  if (/JOIN\s+\w+(?!\s+ON)/i.test(query) && !/CROSS\s+JOIN/i.test(query)) {
    issues.push({
      severity: "error",
      category: "syntax",
      message: "JOIN without ON clause detected"
    });
  }
  const hasGroupBy = /GROUP\s+BY/i.test(query);
  const hasAggregate = /\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(query);
  if (hasGroupBy && !hasAggregate) {
    issues.push({
      severity: "info",
      category: "query",
      message: "GROUP BY without aggregate function - verify this is intentional"
    });
  }
  let complexity = "low";
  const joinCount = (query.match(/\bJOIN\b/gi) || []).length;
  const subqueryCount = (query.match(/\(\s*SELECT/gi) || []).length;
  if (joinCount > 3 || subqueryCount > 2) {
    complexity = "high";
  } else if (joinCount > 1 || subqueryCount > 0) {
    complexity = "medium";
  }
  if (complexity === "high") {
    suggestions.push("Consider breaking complex query into smaller parts or using CTEs");
  }
  if (/SELECT.*DISTINCT/i.test(query) && !hasGroupBy) {
    suggestions.push("DISTINCT can be slow - consider if GROUP BY or better filtering helps");
  }
  if (/OFFSET\s+\d{4,}/i.test(query)) {
    suggestions.push("Large OFFSET is inefficient - consider keyset pagination");
  }
  return {
    query,
    dialect,
    issues,
    suggestions,
    estimated_complexity: complexity
  };
}
async function generateMigration(params) {
  const { operation, table_name, columns = [], dialect = "postgresql" } = params;
  const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").split(".")[0];
  const name = `${timestamp}_${operation}_${table_name}`;
  let up = "";
  let down = "";
  switch (operation.toLowerCase()) {
    case "create_table":
      up = generateCreateTable(table_name, columns, dialect);
      down = `DROP TABLE IF EXISTS ${quoteIdentifier(table_name, dialect)};`;
      break;
    case "add_column":
      if (columns.length > 0) {
        const col = columns[0];
        up = `ALTER TABLE ${quoteIdentifier(table_name, dialect)} ADD COLUMN ${generateColumn(col, dialect)};`;
        down = `ALTER TABLE ${quoteIdentifier(table_name, dialect)} DROP COLUMN ${quoteIdentifier(col.name, dialect)};`;
      }
      break;
    case "drop_column":
      if (columns.length > 0) {
        const col = columns[0];
        up = `ALTER TABLE ${quoteIdentifier(table_name, dialect)} DROP COLUMN ${quoteIdentifier(col.name, dialect)};`;
        down = `ALTER TABLE ${quoteIdentifier(table_name, dialect)} ADD COLUMN ${generateColumn(col, dialect)};`;
      }
      break;
    case "create_index":
      if (columns.length > 0) {
        const indexName = `idx_${table_name}_${columns.map((c) => c.name).join("_")}`;
        const colNames = columns.map((c) => quoteIdentifier(c.name, dialect)).join(", ");
        up = `CREATE INDEX ${quoteIdentifier(indexName, dialect)} ON ${quoteIdentifier(table_name, dialect)} (${colNames});`;
        down = `DROP INDEX IF EXISTS ${quoteIdentifier(indexName, dialect)};`;
      }
      break;
    case "add_foreign_key":
      if (columns.length > 0) {
        const col = columns[0];
        const fkName = `fk_${table_name}_${col.name}`;
        const refTable = col.default?.split(".")[0] || "referenced_table";
        const refCol = col.default?.split(".")[1] || "id";
        up = `ALTER TABLE ${quoteIdentifier(table_name, dialect)} ADD CONSTRAINT ${fkName} FOREIGN KEY (${quoteIdentifier(col.name, dialect)}) REFERENCES ${quoteIdentifier(refTable, dialect)}(${quoteIdentifier(refCol, dialect)});`;
        down = `ALTER TABLE ${quoteIdentifier(table_name, dialect)} DROP CONSTRAINT ${fkName};`;
      }
      break;
    default:
      up = `-- TODO: Implement ${operation} for ${table_name}`;
      down = `-- TODO: Implement rollback for ${operation}`;
  }
  return {
    up,
    down,
    name,
    timestamp
  };
}
function quoteIdentifier(name, dialect) {
  if (dialect === "mysql") return `\`${name}\``;
  return `"${name}"`;
}
function generateColumn(col, dialect) {
  let sql = `${quoteIdentifier(col.name, dialect)} ${mapType(col.type, dialect)}`;
  if (col.nullable === false) sql += " NOT NULL";
  if (col.default) sql += ` DEFAULT ${col.default}`;
  return sql;
}
function mapType(type, dialect) {
  const typeMap = {
    postgresql: {
      string: "VARCHAR(255)",
      text: "TEXT",
      integer: "INTEGER",
      bigint: "BIGINT",
      float: "REAL",
      decimal: "DECIMAL(10,2)",
      boolean: "BOOLEAN",
      datetime: "TIMESTAMP",
      date: "DATE",
      json: "JSONB",
      uuid: "UUID"
    },
    mysql: {
      string: "VARCHAR(255)",
      text: "TEXT",
      integer: "INT",
      bigint: "BIGINT",
      float: "FLOAT",
      decimal: "DECIMAL(10,2)",
      boolean: "TINYINT(1)",
      datetime: "DATETIME",
      date: "DATE",
      json: "JSON",
      uuid: "CHAR(36)"
    },
    sqlite: {
      string: "TEXT",
      text: "TEXT",
      integer: "INTEGER",
      bigint: "INTEGER",
      float: "REAL",
      decimal: "REAL",
      boolean: "INTEGER",
      datetime: "TEXT",
      date: "TEXT",
      json: "TEXT",
      uuid: "TEXT"
    }
  };
  return typeMap[dialect]?.[type.toLowerCase()] || type.toUpperCase();
}
function generateCreateTable(tableName, columns, dialect) {
  const defaultColumns = [
    { name: "id", type: dialect === "postgresql" ? "SERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT" },
    { name: "created_at", type: "TIMESTAMP", default: "CURRENT_TIMESTAMP" },
    { name: "updated_at", type: "TIMESTAMP", default: "CURRENT_TIMESTAMP" }
  ];
  const allColumns = [...defaultColumns, ...columns];
  const colDefs = allColumns.map((col) => {
    if (col.type.includes("PRIMARY KEY")) {
      return `${quoteIdentifier(col.name, dialect)} ${col.type}`;
    }
    return generateColumn(col, dialect);
  });
  return `CREATE TABLE ${quoteIdentifier(tableName, dialect)} (
  ${colDefs.join(",\n  ")}
);`;
}
async function suggestIndexes(params) {
  const { table_schema, query_patterns = [] } = params;
  const suggestions = [];
  const tableMatch = table_schema.match(/CREATE\s+TABLE\s+["'`]?(\w+)["'`]?/i);
  const tableName = tableMatch?.[1] || "table";
  const whereColumns = /* @__PURE__ */ new Set();
  for (const query of query_patterns) {
    const matches = query.matchAll(/WHERE\s+(?:.*?)?["'`]?(\w+)["'`]?\s*[=<>]/gi);
    for (const match of matches) {
      whereColumns.add(match[1]);
    }
    const joinMatches = query.matchAll(/JOIN\s+.*?ON\s+.*?["'`]?(\w+)["'`]?\s*=/gi);
    for (const match of joinMatches) {
      whereColumns.add(match[1]);
    }
  }
  for (const col of whereColumns) {
    suggestions.push({
      table: tableName,
      columns: [col],
      type: "btree",
      reason: `Column "${col}" is used in WHERE clause`,
      create_statement: `CREATE INDEX idx_${tableName}_${col} ON "${tableName}" ("${col}");`
    });
  }
  const fkMatches = table_schema.matchAll(/(\w+)\s+.*?REFERENCES/gi);
  for (const match of fkMatches) {
    const col = match[1];
    if (!whereColumns.has(col)) {
      suggestions.push({
        table: tableName,
        columns: [col],
        type: "btree",
        reason: `Foreign key column "${col}" should be indexed`,
        create_statement: `CREATE INDEX idx_${tableName}_${col} ON "${tableName}" ("${col}");`
      });
    }
  }
  const orderByMatch = query_patterns.map((q) => q.match(/ORDER\s+BY\s+["'`]?(\w+)["'`]?/i)).filter(Boolean);
  for (const match of orderByMatch) {
    if (match?.[1]) {
      suggestions.push({
        table: tableName,
        columns: [match[1]],
        type: "btree",
        reason: `Column "${match[1]}" is used in ORDER BY`,
        create_statement: `CREATE INDEX idx_${tableName}_${match[1]} ON "${tableName}" ("${match[1]}");`
      });
    }
  }
  return { suggestions };
}
async function validateSchema(params) {
  const { schema } = params;
  const issues = [];
  const tables = [];
  const tableMatches = schema.matchAll(/CREATE\s+TABLE\s+["'`]?(\w+)["'`]?/gi);
  for (const match of tableMatches) {
    tables.push(match[1]);
  }
  for (const { pattern, message, category } of BEST_PRACTICES) {
    if (pattern.test(schema)) {
      issues.push({
        severity: "warning",
        category,
        message
      });
    }
  }
  if (!/(created_at|createdat|created)/i.test(schema)) {
    issues.push({
      severity: "info",
      category: "best-practice",
      message: "Consider adding created_at timestamp column"
    });
  }
  if (!/(updated_at|updatedat|modified)/i.test(schema)) {
    issues.push({
      severity: "info",
      category: "best-practice",
      message: "Consider adding updated_at timestamp column"
    });
  }
  if (/[A-Z]/.test(schema.match(/CREATE\s+TABLE\s+["'`]?(\w+)/i)?.[1] || "")) {
    issues.push({
      severity: "info",
      category: "convention",
      message: "Consider using snake_case for table names"
    });
  }
  const columnDefs = schema.matchAll(/^\s*["'`]?(\w+)["'`]?\s+\w+(?!\s+NOT\s+NULL)/gmi);
  let implicitNullable = 0;
  for (const _ of columnDefs) {
    implicitNullable++;
  }
  if (implicitNullable > 5) {
    issues.push({
      severity: "info",
      category: "best-practice",
      message: "Many columns without explicit NULL/NOT NULL - consider being explicit"
    });
  }
  return {
    valid: issues.filter((i) => i.severity === "error").length === 0,
    issues,
    tables
  };
}
const analyzeQuerySchema = z.object({
  query: z.string().describe("SQL query to analyze"),
  dialect: z.string().optional().describe("SQL dialect")
});
const generateMigrationSchema = z.object({
  operation: z.string().describe("Migration operation"),
  table_name: z.string().describe("Target table"),
  columns: z.array(z.object({
    name: z.string(),
    type: z.string(),
    nullable: z.boolean().optional(),
    default: z.string().optional()
  })).optional(),
  dialect: z.string().optional()
});
const suggestIndexesSchema = z.object({
  table_schema: z.string().describe("Table schema"),
  query_patterns: z.array(z.string()).optional()
});
const validateSchemaSchema = z.object({
  schema: z.string().describe("Schema to validate")
});
export {
  analyzeQuery,
  analyzeQuerySchema,
  generateMigration,
  generateMigrationSchema,
  suggestIndexes,
  suggestIndexesSchema,
  validateSchema,
  validateSchemaSchema
};
