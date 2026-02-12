export interface SkillSecurityIssue {
  level: "error" | "warning";
  code: string;
  message: string;
}

export interface SkillSecurityScanInput {
  skillId: string;
  name: string;
  description?: string | null;
  systemPrompt?: string | null;
  tools?: unknown;
  indexSource?: string;
  readmeSource?: string;
  repositoryUrl?: string;
}

export interface SkillSecurityScanResult {
  allowed: boolean;
  issues: SkillSecurityIssue[];
  verification: {
    verified: boolean;
    method: "static-agentic-guard";
    riskScore: number;
    verdict: "allow" | "warn" | "block";
  };
}

const BLOCKED_CONTENT_PATTERNS: Array<{
  code: string;
  regex: RegExp;
  message: string;
}> = [
  {
    code: "SCRIPT_TAG",
    regex: /<script\b/i,
    message:
      "Contains HTML <script> content, which is not allowed in skill metadata/source.",
  },
  {
    code: "DANGEROUS_SHELL_PIPE",
    regex: /(curl|wget)\s+[^\n|]+\|\s*(sh|bash)/i,
    message: "Contains pipe-to-shell command pattern (curl/wget | sh/bash).",
  },
  {
    code: "DESTRUCTIVE_RM",
    regex: /rm\s+-rf\s+\//i,
    message: "Contains destructive command pattern rm -rf /.",
  },
  {
    code: "ENCODED_POWERSHELL",
    regex: /powershell(?:\.exe)?\s+.*-enc/i,
    message: "Contains encoded PowerShell execution pattern.",
  },
  {
    code: "PROMPT_INJECTION_OVERRIDE",
    regex: /ignore\s+(all\s+)?previous\s+instructions/i,
    message: "Contains prompt-injection style instruction override text.",
  },
  {
    code: "TOKEN_EXFILTRATION",
    regex: /(exfiltrat|steal|dump).*(token|secret|credential|password)/i,
    message: "Contains suspicious credential exfiltration language.",
  },
];

const SUSPICIOUS_CONTENT_PATTERNS: Array<{
  code: string;
  regex: RegExp;
  message: string;
}> = [
  {
    code: "INSTALL_HINT",
    regex: /\b(apt-get|brew|choco|winget|npm\s+i\s+-g)\b/i,
    message: "Contains package installation commands. Verify this is expected.",
  },
  {
    code: "EVAL_USAGE",
    regex: /\beval\s*\(/i,
    message: "Contains eval() usage. This is potentially unsafe.",
  },
  {
    code: "FUNCTION_CONSTRUCTOR",
    regex: /new\s+Function\s*\(/i,
    message: "Contains Function constructor usage. This is potentially unsafe.",
  },
];

function normalizeTextParts(input: SkillSecurityScanInput): string[] {
  const toolJson = input.tools ? JSON.stringify(input.tools) : "";

  return [
    input.skillId,
    input.name,
    input.description || "",
    input.systemPrompt || "",
    toolJson,
    input.indexSource || "",
    input.readmeSource || "",
    input.repositoryUrl || "",
  ];
}

function hasSafeExecuteReference(value: string): boolean {
  // Allowed format: "functionName" or "index.ts:functionName" or "module.js:functionName"
  // Blocks whitespace and shell-like separators.
  return /^[a-zA-Z0-9_.-]+(?::[a-zA-Z0-9_.-]+)?$/.test(value);
}

function validateToolsShape(tools: unknown): SkillSecurityIssue[] {
  const issues: SkillSecurityIssue[] = [];

  if (!Array.isArray(tools)) {
    issues.push({
      level: "error",
      code: "TOOLS_NOT_ARRAY",
      message: "Skill tools must be an array.",
    });
    return issues;
  }

  if (tools.length > 40) {
    issues.push({
      level: "warning",
      code: "TOOLS_LARGE_COUNT",
      message: `Skill defines ${tools.length} tools; this is unusually high.`,
    });
  }

  for (const item of tools) {
    if (!item || typeof item !== "object") {
      issues.push({
        level: "error",
        code: "TOOL_INVALID_ITEM",
        message: "Skill tool entry is not an object.",
      });
      continue;
    }

    const tool = item as { name?: unknown; execute?: unknown };
    if (typeof tool.name !== "string" || tool.name.trim().length === 0) {
      issues.push({
        level: "error",
        code: "TOOL_NAME_INVALID",
        message: "Skill tool name must be a non-empty string.",
      });
    }

    const execute = typeof tool.execute === "string" ? tool.execute.trim() : "";
    if (!execute) {
      issues.push({
        level: "error",
        code: "TOOL_EXECUTE_MISSING",
        message: `Skill tool '${String(tool.name || "unknown")}' is missing execute reference.`,
      });
      continue;
    }

    if (!hasSafeExecuteReference(execute)) {
      issues.push({
        level: "error",
        code: "TOOL_EXECUTE_UNSAFE",
        message: `Skill tool '${String(tool.name || "unknown")}' has unsafe execute reference '${execute}'.`,
      });
    }
  }

  return issues;
}

export function scanSkillSecurity(
  input: SkillSecurityScanInput,
): SkillSecurityScanResult {
  const issues: SkillSecurityIssue[] = [];
  const text = normalizeTextParts(input).join("\n");

  for (const pattern of BLOCKED_CONTENT_PATTERNS) {
    if (pattern.regex.test(text)) {
      issues.push({
        level: "error",
        code: pattern.code,
        message: pattern.message,
      });
    }
  }

  for (const pattern of SUSPICIOUS_CONTENT_PATTERNS) {
    if (pattern.regex.test(text)) {
      issues.push({
        level: "warning",
        code: pattern.code,
        message: pattern.message,
      });
    }
  }

  issues.push(...validateToolsShape(input.tools));

  const errorCount = issues.filter((issue) => issue.level === "error").length;
  const warningCount = issues.filter(
    (issue) => issue.level === "warning",
  ).length;
  const riskScore = Math.min(100, errorCount * 40 + warningCount * 10);
  const verdict =
    errorCount > 0 ? "block" : warningCount > 0 ? "warn" : "allow";

  return {
    allowed: errorCount === 0,
    issues,
    verification: {
      verified: true,
      method: "static-agentic-guard",
      riskScore,
      verdict,
    },
  };
}
