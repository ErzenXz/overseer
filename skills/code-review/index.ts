/**
 * Code Review Skill Implementation
 * Analyze code for bugs, security issues, and best practices
 */

import { readFileSync, existsSync } from "fs";
import { extname } from "path";
import { z } from "zod";

export interface ReviewIssue {
  severity: "error" | "warning" | "info" | "suggestion";
  category: string;
  message: string;
  line?: number;
  code?: string;
  suggestion?: string;
}

export interface ReviewResult {
  success: boolean;
  file_path?: string;
  language?: string;
  issues: ReviewIssue[];
  summary: {
    total: number;
    errors: number;
    warnings: number;
    info: number;
    suggestions: number;
  };
  score?: number;
}

// Language-specific patterns to check
const PATTERNS: Record<string, Array<{ regex: RegExp; message: string; severity: ReviewIssue["severity"]; category: string; suggestion?: string }>> = {
  typescript: [
    { regex: /console\.log\(/g, message: "Console.log statement found - remove for production", severity: "warning", category: "debugging", suggestion: "Remove or replace with proper logging" },
    { regex: /any(?:\s|;|,|\))/g, message: "Usage of 'any' type detected", severity: "warning", category: "type-safety", suggestion: "Use specific types instead of 'any'" },
    { regex: /\/\/\s*TODO/gi, message: "TODO comment found", severity: "info", category: "todo" },
    { regex: /\/\/\s*FIXME/gi, message: "FIXME comment found", severity: "warning", category: "todo" },
    { regex: /\/\/\s*HACK/gi, message: "HACK comment found - needs refactoring", severity: "warning", category: "code-quality" },
    { regex: /==(?!=)/g, message: "Use === instead of == for strict equality", severity: "warning", category: "best-practice", suggestion: "Replace == with ===" },
    { regex: /!=(?!=)/g, message: "Use !== instead of != for strict inequality", severity: "warning", category: "best-practice", suggestion: "Replace != with !==" },
    { regex: /eval\(/g, message: "eval() is dangerous and should be avoided", severity: "error", category: "security", suggestion: "Avoid using eval() - find alternative approaches" },
    { regex: /new Function\(/g, message: "new Function() is similar to eval and should be avoided", severity: "error", category: "security" },
    { regex: /innerHTML\s*=/g, message: "Direct innerHTML assignment - potential XSS vulnerability", severity: "error", category: "security", suggestion: "Use textContent or sanitize HTML input" },
    { regex: /password\s*[=:]\s*['"]/gi, message: "Hardcoded password detected", severity: "error", category: "security", suggestion: "Use environment variables for secrets" },
    { regex: /api[_-]?key\s*[=:]\s*['"]/gi, message: "Hardcoded API key detected", severity: "error", category: "security", suggestion: "Use environment variables for API keys" },
    { regex: /catch\s*\(\s*\w*\s*\)\s*\{\s*\}/g, message: "Empty catch block - errors are silently ignored", severity: "warning", category: "error-handling", suggestion: "Handle or log the error" },
    { regex: /async\s+function[^{]*\{[^}]*\bawait\b/g, message: "Async function without error handling", severity: "info", category: "error-handling" },
    { regex: /\bvar\s+/g, message: "Use 'let' or 'const' instead of 'var'", severity: "warning", category: "best-practice", suggestion: "Replace var with let or const" },
    { regex: /\.then\([^)]*\)(?!\s*\.catch)/g, message: "Promise without .catch() error handling", severity: "info", category: "error-handling" },
  ],
  javascript: [
    { regex: /console\.log\(/g, message: "Console.log statement found", severity: "warning", category: "debugging" },
    { regex: /==(?!=)/g, message: "Use === instead of ==", severity: "warning", category: "best-practice" },
    { regex: /eval\(/g, message: "eval() is dangerous", severity: "error", category: "security" },
    { regex: /innerHTML\s*=/g, message: "Direct innerHTML assignment", severity: "error", category: "security" },
    { regex: /\bvar\s+/g, message: "Use 'let' or 'const' instead of 'var'", severity: "warning", category: "best-practice" },
    { regex: /document\.write\(/g, message: "document.write() is deprecated", severity: "warning", category: "best-practice" },
  ],
  python: [
    { regex: /print\(/g, message: "Print statement found - use logging for production", severity: "info", category: "debugging" },
    { regex: /exec\(/g, message: "exec() is dangerous", severity: "error", category: "security" },
    { regex: /eval\(/g, message: "eval() is dangerous", severity: "error", category: "security" },
    { regex: /import \*/g, message: "Wildcard imports are discouraged", severity: "warning", category: "best-practice" },
    { regex: /except:\s*$/gm, message: "Bare except clause - catches all exceptions", severity: "warning", category: "error-handling" },
    { regex: /password\s*=\s*['"]/gi, message: "Hardcoded password detected", severity: "error", category: "security" },
    { regex: /#\s*TODO/gi, message: "TODO comment found", severity: "info", category: "todo" },
    { regex: /os\.system\(/g, message: "os.system() can be vulnerable to injection", severity: "warning", category: "security" },
  ],
};

// Common patterns for all languages
const COMMON_PATTERNS = [
  { regex: /FIXME/gi, message: "FIXME comment found", severity: "warning" as const, category: "todo" },
  { regex: /XXX/g, message: "XXX marker found", severity: "info" as const, category: "todo" },
  { regex: /\n{4,}/g, message: "Excessive blank lines", severity: "info" as const, category: "style" },
  { regex: /.{200,}/g, message: "Line exceeds 200 characters", severity: "info" as const, category: "style" },
];

/**
 * Get language from file extension
 */
function getLanguage(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const langMap: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".py": "python",
    ".rb": "ruby",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".cs": "csharp",
    ".php": "php",
  };
  return langMap[ext] || "unknown";
}

/**
 * Review a file for issues
 */
export async function reviewFile(params: {
  file_path: string;
  focus_areas?: string[];
}): Promise<ReviewResult> {
  const { file_path, focus_areas } = params;

  if (!existsSync(file_path)) {
    return {
      success: false,
      file_path,
      issues: [{ severity: "error", category: "file", message: "File not found" }],
      summary: { total: 1, errors: 1, warnings: 0, info: 0, suggestions: 0 },
    };
  }

  try {
    const content = readFileSync(file_path, "utf-8");
    const language = getLanguage(file_path);
    const lines = content.split("\n");
    const issues: ReviewIssue[] = [];

    // Get language-specific patterns
    const patterns = PATTERNS[language] || [];
    const allPatterns = [...patterns, ...COMMON_PATTERNS];

    // Filter by focus areas if specified
    const activePatterns = focus_areas?.length
      ? allPatterns.filter((p) => focus_areas.some((area) => p.category.includes(area)))
      : allPatterns;

    // Check each pattern
    for (const pattern of activePatterns) {
      let match;
      while ((match = pattern.regex.exec(content)) !== null) {
        // Find line number
        const lineNumber = content.substring(0, match.index).split("\n").length;
        issues.push({
          severity: pattern.severity,
          category: pattern.category,
          message: pattern.message,
          line: lineNumber,
          code: lines[lineNumber - 1]?.trim().substring(0, 100),
          suggestion: pattern.suggestion,
        });
      }
    }

    // Additional checks
    // Check for long functions (heuristic based on line count)
    const functionMatches = content.match(/function\s+\w+[^{]*\{|=>\s*\{|:\s*function[^{]*\{/g);
    if (functionMatches && functionMatches.length > 0) {
      // Simple heuristic: if file has few functions but many lines, functions might be too long
      const linesPerFunction = lines.length / functionMatches.length;
      if (linesPerFunction > 100) {
        issues.push({
          severity: "info",
          category: "complexity",
          message: `Average function length is ~${Math.round(linesPerFunction)} lines - consider breaking into smaller functions`,
        });
      }
    }

    // Check for deep nesting
    let maxIndent = 0;
    for (const line of lines) {
      const indent = line.match(/^(\s*)/)?.[1].length || 0;
      if (indent > maxIndent) maxIndent = indent;
    }
    if (maxIndent > 24) {
      issues.push({
        severity: "warning",
        category: "complexity",
        message: "Deep nesting detected - consider refactoring to reduce complexity",
      });
    }

    // Calculate summary
    const summary = {
      total: issues.length,
      errors: issues.filter((i) => i.severity === "error").length,
      warnings: issues.filter((i) => i.severity === "warning").length,
      info: issues.filter((i) => i.severity === "info").length,
      suggestions: issues.filter((i) => i.severity === "suggestion").length,
    };

    // Calculate score (100 - penalties)
    let score = 100;
    score -= summary.errors * 10;
    score -= summary.warnings * 3;
    score -= summary.info * 1;
    score = Math.max(0, Math.min(100, score));

    return {
      success: true,
      file_path,
      language,
      issues,
      summary,
      score,
    };
  } catch (error) {
    return {
      success: false,
      file_path,
      issues: [{
        severity: "error",
        category: "system",
        message: `Failed to read file: ${error instanceof Error ? error.message : "Unknown error"}`,
      }],
      summary: { total: 1, errors: 1, warnings: 0, info: 0, suggestions: 0 },
    };
  }
}

/**
 * Review a git diff
 */
export async function reviewDiff(params: {
  diff: string;
  context?: string;
}): Promise<ReviewResult> {
  const { diff, context } = params;
  const issues: ReviewIssue[] = [];

  // Parse diff to find added lines
  const lines = diff.split("\n");
  let currentFile = "";
  let lineNumber = 0;

  for (const line of lines) {
    // Track file
    if (line.startsWith("+++ ")) {
      currentFile = line.substring(4).replace(/^[ab]\//, "");
      continue;
    }

    // Track line numbers from @@ markers
    const hunkMatch = line.match(/@@ -\d+,?\d* \+(\d+),?\d* @@/);
    if (hunkMatch) {
      lineNumber = parseInt(hunkMatch[1], 10) - 1;
      continue;
    }

    // Only check added lines
    if (line.startsWith("+") && !line.startsWith("+++")) {
      lineNumber++;
      const addedLine = line.substring(1);

      // Check for common issues in added code
      if (/console\.log\(/.test(addedLine)) {
        issues.push({
          severity: "warning",
          category: "debugging",
          message: "Console.log added - remove before merging",
          line: lineNumber,
          code: addedLine.trim().substring(0, 80),
        });
      }

      if (/debugger/.test(addedLine)) {
        issues.push({
          severity: "error",
          category: "debugging",
          message: "Debugger statement added",
          line: lineNumber,
        });
      }

      if (/TODO|FIXME|HACK/.test(addedLine)) {
        issues.push({
          severity: "info",
          category: "todo",
          message: "TODO/FIXME/HACK comment added",
          line: lineNumber,
          code: addedLine.trim().substring(0, 80),
        });
      }

      if (/password|api[_-]?key|secret/i.test(addedLine) && /[=:]\s*['"]/.test(addedLine)) {
        issues.push({
          severity: "error",
          category: "security",
          message: "Potential hardcoded secret added",
          line: lineNumber,
          suggestion: "Use environment variables instead",
        });
      }
    } else if (!line.startsWith("-")) {
      lineNumber++;
    }
  }

  const summary = {
    total: issues.length,
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
    info: issues.filter((i) => i.severity === "info").length,
    suggestions: issues.filter((i) => i.severity === "suggestion").length,
  };

  return {
    success: true,
    issues,
    summary,
  };
}

/**
 * Check code against anti-patterns
 */
export async function checkPatterns(params: {
  code: string;
  language: string;
}): Promise<ReviewResult> {
  const { code, language } = params;
  const patterns = PATTERNS[language.toLowerCase()] || [];
  const issues: ReviewIssue[] = [];
  const lines = code.split("\n");

  for (const pattern of [...patterns, ...COMMON_PATTERNS]) {
    let match;
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    while ((match = regex.exec(code)) !== null) {
      const lineNumber = code.substring(0, match.index).split("\n").length;
      issues.push({
        severity: pattern.severity,
        category: pattern.category,
        message: pattern.message,
        line: lineNumber,
        code: lines[lineNumber - 1]?.trim().substring(0, 100),
        suggestion: pattern.suggestion,
      });
    }
  }

  const summary = {
    total: issues.length,
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
    info: issues.filter((i) => i.severity === "info").length,
    suggestions: issues.filter((i) => i.severity === "suggestion").length,
  };

  return {
    success: true,
    language,
    issues,
    summary,
  };
}

// Export schemas
export const reviewFileSchema = z.object({
  file_path: z.string().describe("Path to the file to review"),
  focus_areas: z.array(z.string()).optional().describe("Areas to focus on"),
});

export const reviewDiffSchema = z.object({
  diff: z.string().describe("Git diff content"),
  context: z.string().optional().describe("Additional context"),
});

export const checkPatternsSchema = z.object({
  code: z.string().describe("Code to check"),
  language: z.string().describe("Programming language"),
});
