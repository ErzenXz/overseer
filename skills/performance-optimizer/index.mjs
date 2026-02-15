import { existsSync, readFileSync, readdirSync } from "fs";
import { join, extname } from "path";
import { z } from "zod";
const PERFORMANCE_PATTERNS = [
  // JavaScript/TypeScript patterns
  {
    pattern: /\.forEach\s*\([^)]*\)\s*{[\s\S]*?\.push\s*\(/g,
    title: "forEach with push",
    description: "Using forEach with push is slower than map",
    impact: "Minor performance impact on large arrays",
    severity: "low",
    category: "array",
    suggestion: "Use map() instead of forEach() with push()"
  },
  {
    pattern: /for\s*\([^;]*;\s*\w+\s*<\s*\w+\.length\s*;/g,
    title: "Array length in loop condition",
    description: "Accessing .length on each iteration",
    impact: "Minor overhead on each iteration",
    severity: "low",
    category: "loop",
    suggestion: "Cache array length in a variable before the loop"
  },
  {
    pattern: /JSON\.parse\s*\(\s*JSON\.stringify\s*\(/g,
    title: "JSON deep clone",
    description: "JSON.parse(JSON.stringify()) is slow for deep cloning",
    impact: "Significant overhead for large objects",
    severity: "medium",
    category: "cloning",
    suggestion: "Use structuredClone() or a dedicated deep clone library"
  },
  {
    pattern: /new\s+RegExp\s*\(/g,
    title: "Dynamic RegExp in hot path",
    description: "Creating RegExp objects is expensive",
    impact: "May cause performance issues if called frequently",
    severity: "medium",
    category: "regex",
    suggestion: "Move RegExp creation outside of loops/hot paths"
  },
  {
    pattern: /document\.querySelector\s*\([^)]+\)/g,
    title: "Repeated DOM queries",
    description: "DOM queries are expensive operations",
    impact: "Causes layout thrashing if called in loops",
    severity: "medium",
    category: "dom",
    suggestion: "Cache DOM references outside loops"
  },
  {
    pattern: /style\.\w+\s*=.*\n.*style\.\w+\s*=/g,
    title: "Multiple style assignments",
    description: "Individual style assignments trigger reflows",
    impact: "Multiple layout recalculations",
    severity: "medium",
    category: "dom",
    suggestion: "Use cssText or classList.add() with CSS classes"
  },
  {
    pattern: /\bawait\s+\w+\s*;[\s\n]*await\s+\w+\s*;/g,
    title: "Sequential awaits",
    description: "Awaiting sequentially when parallel is possible",
    impact: "Unnecessary waiting time",
    severity: "high",
    category: "async",
    suggestion: "Use Promise.all() for independent async operations"
  },
  {
    pattern: /useEffect\s*\(\s*\(\s*\)\s*=>\s*{[^}]*fetch/g,
    title: "Fetch in useEffect",
    description: "Data fetching in useEffect may cause waterfalls",
    impact: "Delayed data loading",
    severity: "medium",
    category: "react",
    suggestion: "Consider React Query, SWR, or server-side data fetching"
  },
  {
    pattern: /useState\s*\([^)]*\)[\s\S]{0,100}useState\s*\([^)]*\)[\s\S]{0,100}useState\s*\([^)]*\)/g,
    title: "Multiple useState calls",
    description: "Multiple related state variables",
    impact: "Multiple re-renders on related updates",
    severity: "low",
    category: "react",
    suggestion: "Consider useReducer for related state"
  },
  {
    pattern: /console\.(log|debug|trace|table)\s*\(/g,
    title: "Console statements",
    description: "Console operations have performance cost",
    impact: "Slows down execution, especially in loops",
    severity: "low",
    category: "debugging",
    suggestion: "Remove in production or use conditional logging"
  },
  {
    pattern: /\+\s*['"`][^'"`]*['"`]|\+\s*\w+\s*\+\s*['"`]/g,
    title: "String concatenation",
    description: "String concatenation creates intermediate strings",
    impact: "Memory allocation overhead",
    severity: "low",
    category: "string",
    suggestion: "Use template literals or array.join()"
  },
  {
    pattern: /Array\((\d{4,})\)\.fill/g,
    title: "Large array allocation",
    description: "Pre-allocating very large arrays",
    impact: "Large memory allocation upfront",
    severity: "medium",
    category: "memory",
    suggestion: "Consider lazy initialization or streaming"
  },
  {
    pattern: /setInterval\s*\(/g,
    title: "setInterval usage",
    description: "setInterval can cause memory leaks if not cleared",
    impact: "Potential memory leaks",
    severity: "medium",
    category: "timer",
    suggestion: "Ensure cleanup on component unmount or use setTimeout recursively"
  },
  {
    pattern: /\.map\s*\([^)]*\)\s*\.filter\s*\(/g,
    title: "map followed by filter",
    description: "Chaining map and filter iterates twice",
    impact: "Double iteration over array",
    severity: "low",
    category: "array",
    suggestion: "Use reduce() for single-pass transformation"
  }
];
const HEAVY_DEPENDENCIES = [
  { name: "moment", reason: "Large bundle size (66KB+)", alternative: "date-fns or dayjs" },
  { name: "lodash", reason: "Full bundle is large (72KB)", alternative: "lodash-es with tree-shaking or individual imports" },
  { name: "jquery", reason: "Usually unnecessary with modern frameworks", alternative: "Native DOM APIs" },
  { name: "underscore", reason: "Largely replaced by ES6+ features", alternative: "Native JavaScript methods" },
  { name: "bluebird", reason: "Native Promises are now sufficient", alternative: "Native Promise" },
  { name: "request", reason: "Deprecated and large", alternative: "node-fetch or axios" },
  { name: "core-js", reason: "Very large polyfill bundle", alternative: "Target modern browsers or use Babel smartly" }
];
async function analyzeBundle(params) {
  const { project_path } = params;
  const issues = [];
  const recommendations = [];
  const largeDeps = [];
  const duplicates = [];
  const packageJsonPath = join(project_path, "package.json");
  if (!existsSync(packageJsonPath)) {
    return {
      analyzed: false,
      project_path,
      dependencies: { total: 0, large: [], duplicates: [] },
      issues: [],
      recommendations: ["No package.json found"]
    };
  }
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    const deps = Object.keys(packageJson.dependencies || {});
    const devDeps = Object.keys(packageJson.devDependencies || {});
    for (const heavy of HEAVY_DEPENDENCIES) {
      if (deps.includes(heavy.name)) {
        largeDeps.push({ name: heavy.name, reason: heavy.reason });
        issues.push({
          severity: "medium",
          category: "bundle-size",
          title: `Heavy dependency: ${heavy.name}`,
          description: heavy.reason,
          impact: "Increases initial bundle size",
          suggestion: `Consider using ${heavy.alternative}`
        });
      }
    }
    if (deps.includes("lodash") && deps.includes("lodash-es")) {
      duplicates.push("lodash/lodash-es");
      issues.push({
        severity: "medium",
        category: "duplication",
        title: "Duplicate lodash packages",
        description: "Both lodash and lodash-es are installed",
        impact: "Duplicate code in bundle",
        suggestion: "Use only lodash-es for tree-shaking"
      });
    }
    const hasNextConfig = existsSync(join(project_path, "next.config.js")) || existsSync(join(project_path, "next.config.mjs"));
    const hasViteConfig = existsSync(join(project_path, "vite.config.js")) || existsSync(join(project_path, "vite.config.ts"));
    const hasWebpackConfig = existsSync(join(project_path, "webpack.config.js"));
    if (!hasNextConfig && !hasViteConfig && !hasWebpackConfig) {
      recommendations.push("Consider adding bundle analyzer for visibility");
    }
    const srcDir = join(project_path, "src");
    let hasDynamicImports = false;
    let hasLazyLoading = false;
    if (existsSync(srcDir)) {
      const files = findFiles(srcDir, [".ts", ".tsx", ".js", ".jsx"]);
      for (const file of files.slice(0, 50)) {
        try {
          const content = readFileSync(file, "utf-8");
          if (/import\s*\(/g.test(content)) hasDynamicImports = true;
          if (/React\.lazy\s*\(/g.test(content) || /lazy\s*\(/g.test(content)) hasLazyLoading = true;
        } catch {
        }
      }
    }
    if (!hasDynamicImports) {
      recommendations.push("Use dynamic imports for code splitting");
    }
    if (!hasLazyLoading && deps.includes("react")) {
      recommendations.push("Use React.lazy() for route-based code splitting");
    }
    if (deps.includes("next")) {
      const pagesDir = join(project_path, "pages");
      const appDir = join(project_path, "app");
      let usesNextImage = false;
      for (const dir of [pagesDir, appDir, srcDir]) {
        if (existsSync(dir)) {
          const files = findFiles(dir, [".tsx", ".jsx"]);
          for (const file of files.slice(0, 30)) {
            try {
              const content = readFileSync(file, "utf-8");
              if (/next\/image/.test(content)) {
                usesNextImage = true;
                break;
              }
            } catch {
            }
          }
        }
      }
      if (!usesNextImage) {
        recommendations.push("Use next/image for automatic image optimization");
      }
    }
    return {
      analyzed: true,
      project_path,
      dependencies: {
        total: deps.length,
        large: largeDeps,
        duplicates
      },
      issues,
      recommendations
    };
  } catch (error) {
    return {
      analyzed: false,
      project_path,
      dependencies: { total: 0, large: [], duplicates: [] },
      issues: [],
      recommendations: ["Failed to analyze bundle"]
    };
  }
}
function findFiles(dir, extensions, maxDepth = 5) {
  const files = [];
  function scan(currentDir, depth) {
    if (depth > maxDepth) return;
    try {
      const entries = readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const fullPath = join(currentDir, entry.name);
        if (entry.isDirectory()) {
          scan(fullPath, depth + 1);
        } else if (extensions.includes(extname(entry.name))) {
          files.push(fullPath);
        }
      }
    } catch {
    }
  }
  scan(dir, 0);
  return files;
}
async function checkCodePerformance(params) {
  const { file_path } = params;
  const issues = [];
  if (!existsSync(file_path)) {
    return {
      analyzed: false,
      file: file_path,
      issues: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0 },
      optimization_potential: "low"
    };
  }
  try {
    const content = readFileSync(file_path, "utf-8");
    const lines = content.split("\n");
    for (const pattern of PERFORMANCE_PATTERNS) {
      let match;
      const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);
      while ((match = regex.exec(content)) !== null) {
        const lineNumber = content.substring(0, match.index).split("\n").length;
        issues.push({
          severity: pattern.severity,
          category: pattern.category,
          title: pattern.title,
          description: pattern.description,
          impact: pattern.impact,
          file: file_path,
          line: lineNumber,
          suggestion: pattern.suggestion
        });
      }
    }
    const functionMatches = content.match(/function\s+\w+[^{]*{|=>\s*{/g);
    const avgLinesPerFunction = functionMatches ? lines.length / functionMatches.length : lines.length;
    if (avgLinesPerFunction > 100) {
      issues.push({
        severity: "medium",
        category: "complexity",
        title: "Long functions detected",
        description: `Average function length is ~${Math.round(avgLinesPerFunction)} lines`,
        impact: "Harder to optimize and may indicate too much work per function",
        suggestion: "Break into smaller, focused functions"
      });
    }
    const summary = {
      critical: issues.filter((i) => i.severity === "critical").length,
      high: issues.filter((i) => i.severity === "high").length,
      medium: issues.filter((i) => i.severity === "medium").length,
      low: issues.filter((i) => i.severity === "low").length
    };
    const optimization_potential = summary.critical > 0 || summary.high > 2 ? "high" : summary.high > 0 || summary.medium > 3 ? "medium" : "low";
    return {
      analyzed: true,
      file: file_path,
      issues,
      summary,
      optimization_potential
    };
  } catch {
    return {
      analyzed: false,
      file: file_path,
      issues: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0 },
      optimization_potential: "low"
    };
  }
}
async function analyzeDatabaseQueries(params) {
  const { queries } = params;
  const issues = [];
  const recommendations = [];
  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    const queryNum = i + 1;
    if (/SELECT\s+\*/i.test(query)) {
      issues.push({
        severity: "medium",
        category: "query",
        title: `Query ${queryNum}: SELECT * usage`,
        description: "Selecting all columns when not all are needed",
        impact: "Transfers more data than necessary",
        suggestion: "Specify only needed columns"
      });
    }
    if (/SELECT.*FROM\s+\w+(?!\s+WHERE)/i.test(query) && !/LIMIT/i.test(query)) {
      issues.push({
        severity: "high",
        category: "query",
        title: `Query ${queryNum}: No WHERE or LIMIT`,
        description: "Query may return all rows",
        impact: "Full table scan, memory issues with large tables",
        suggestion: "Add WHERE clause or LIMIT"
      });
    }
    if (/LIKE\s+['"]%/i.test(query)) {
      issues.push({
        severity: "high",
        category: "index",
        title: `Query ${queryNum}: Leading wildcard in LIKE`,
        description: "LIKE '%value' cannot use indexes",
        impact: "Full table scan required",
        suggestion: "Use full-text search for substring matching"
      });
    }
    if (/WHERE.*\bOR\b.*\bOR\b/i.test(query)) {
      issues.push({
        severity: "medium",
        category: "query",
        title: `Query ${queryNum}: Multiple OR conditions`,
        description: "Multiple ORs may prevent index usage",
        impact: "May cause slower query execution",
        suggestion: "Consider UNION or restructuring the query"
      });
    }
    if (/IN\s*\([^)]*,\s*[^)]*,\s*[^)]*,\s*[^)]*,/i.test(query)) {
      issues.push({
        severity: "medium",
        category: "pattern",
        title: `Query ${queryNum}: Large IN clause`,
        description: "Very large IN clauses may indicate N+1 pattern",
        impact: "May be more efficient as a JOIN",
        suggestion: "Consider using a JOIN instead"
      });
    }
    if (/ORDER\s+BY\s+RAND\(\)/i.test(query)) {
      issues.push({
        severity: "critical",
        category: "query",
        title: `Query ${queryNum}: ORDER BY RAND()`,
        description: "Extremely slow on large tables",
        impact: "Full table scan and sort",
        suggestion: "Use application-level randomization or indexed column"
      });
    }
    if (/WHERE\s+\w+\s*\([^)]*\)\s*=/i.test(query)) {
      issues.push({
        severity: "high",
        category: "index",
        title: `Query ${queryNum}: Function on indexed column`,
        description: "Functions on columns prevent index usage",
        impact: "Full table scan",
        suggestion: "Compute the value before querying or use computed columns"
      });
    }
  }
  if (queries.length > 5) {
    recommendations.push("Consider batching queries to reduce round trips");
  }
  recommendations.push("Use EXPLAIN ANALYZE to verify query plans");
  recommendations.push("Ensure appropriate indexes exist for WHERE columns");
  return {
    analyzed: queries.length,
    issues,
    recommendations
  };
}
async function suggestCaching(params) {
  const { description, current_latency_ms, requests_per_minute } = params;
  const strategies = [];
  const recommendations = [];
  const descLower = description.toLowerCase();
  const isStaticContent = /static|image|css|js|font|asset/i.test(descLower);
  const isApiEndpoint = /api|endpoint|fetch|data/i.test(descLower);
  const isUserSpecific = /user|profile|personal|account/i.test(descLower);
  const isDatabaseQuery = /database|query|select|sql/i.test(descLower);
  if (isStaticContent) {
    strategies.push({
      name: "CDN Caching",
      type: "cdn",
      ttl_recommendation: "1 year for versioned assets, 1 day for others",
      implementation: "Use Cache-Control: public, max-age=31536000 for hashed assets",
      estimated_improvement: "90%+ reduction in origin requests"
    });
    strategies.push({
      name: "Browser Caching",
      type: "browser",
      ttl_recommendation: "1 week to 1 year",
      implementation: "Set appropriate Cache-Control headers",
      estimated_improvement: "Eliminates repeat requests for same user"
    });
  }
  if (isApiEndpoint && !isUserSpecific) {
    strategies.push({
      name: "HTTP Caching",
      type: "http",
      ttl_recommendation: "5-60 seconds for dynamic, longer for semi-static",
      implementation: "Add stale-while-revalidate for better UX",
      estimated_improvement: "50-90% reduction in API calls"
    });
    strategies.push({
      name: "Redis/Memory Cache",
      type: "redis",
      ttl_recommendation: "Match your data freshness requirements",
      implementation: "Cache API responses with appropriate keys",
      estimated_improvement: `${current_latency_ms ? Math.round(current_latency_ms * 0.9) : 50}ms+ latency reduction`
    });
  }
  if (isDatabaseQuery) {
    strategies.push({
      name: "Query Result Cache",
      type: "memory",
      ttl_recommendation: "1-5 minutes for frequently accessed data",
      implementation: "Use node-cache, lru-cache, or Redis",
      estimated_improvement: "Eliminate database round-trip"
    });
    recommendations.push("Consider database connection pooling");
    recommendations.push("Use prepared statements for repeated queries");
  }
  if (isUserSpecific) {
    strategies.push({
      name: "Per-User Cache",
      type: "redis",
      ttl_recommendation: "5-30 minutes",
      implementation: "Include user ID in cache key",
      estimated_improvement: "Significant for repeated requests"
    });
    recommendations.push("Be careful with cache invalidation on user data changes");
    recommendations.push("Consider short TTL or cache-aside pattern");
  }
  if (requests_per_minute && requests_per_minute > 1e3) {
    strategies.push({
      name: "Edge Caching",
      type: "cdn",
      ttl_recommendation: "As long as acceptable for freshness",
      implementation: "Use Vercel Edge, Cloudflare, or similar",
      estimated_improvement: "Sub-100ms global response times"
    });
    recommendations.push("Consider response streaming for large payloads");
  }
  recommendations.push("Implement cache invalidation strategy");
  recommendations.push("Monitor cache hit rates");
  recommendations.push("Consider cache warming for critical paths");
  return { strategies, recommendations };
}
const analyzeBundleSchema = z.object({
  project_path: z.string().describe("Path to project root")
});
const checkCodePerformanceSchema = z.object({
  file_path: z.string().describe("Path to file to analyze")
});
const analyzeDatabaseQueriesSchema = z.object({
  queries: z.array(z.string()).describe("SQL queries to analyze")
});
const suggestCachingSchema = z.object({
  description: z.string().describe("Description of what to cache"),
  current_latency_ms: z.number().optional().describe("Current latency"),
  requests_per_minute: z.number().optional().describe("Request rate")
});
export {
  analyzeBundle,
  analyzeBundleSchema,
  analyzeDatabaseQueries,
  analyzeDatabaseQueriesSchema,
  checkCodePerformance,
  checkCodePerformanceSchema,
  suggestCaching,
  suggestCachingSchema
};
