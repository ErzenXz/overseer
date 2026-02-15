import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";
import { z } from "zod";
const SECURITY_PATTERNS = [
  // Injection vulnerabilities
  {
    pattern: /eval\s*\(/g,
    title: "Code Injection Risk",
    description: "eval() can execute arbitrary code",
    severity: "critical",
    category: "injection",
    cwe: "CWE-94",
    owasp: "A03:2021",
    remediation: "Avoid eval() - use JSON.parse() for data or safer alternatives"
  },
  {
    pattern: /new\s+Function\s*\(/g,
    title: "Code Injection Risk",
    description: "new Function() can execute arbitrary code",
    severity: "critical",
    category: "injection",
    cwe: "CWE-94",
    owasp: "A03:2021",
    remediation: "Avoid dynamic function creation"
  },
  {
    pattern: /child_process\.exec\s*\(/g,
    title: "Command Injection Risk",
    description: "exec() with unsanitized input allows command injection",
    severity: "high",
    category: "injection",
    cwe: "CWE-78",
    owasp: "A03:2021",
    remediation: "Use execFile() with argument array or validate/sanitize inputs"
  },
  {
    pattern: /\.innerHTML\s*=/g,
    title: "XSS Vulnerability",
    description: "Direct innerHTML assignment can lead to XSS",
    severity: "high",
    category: "xss",
    cwe: "CWE-79",
    owasp: "A03:2021",
    remediation: "Use textContent or sanitize HTML with DOMPurify"
  },
  {
    pattern: /document\.write\s*\(/g,
    title: "DOM-based XSS Risk",
    description: "document.write() can introduce XSS vulnerabilities",
    severity: "medium",
    category: "xss",
    cwe: "CWE-79",
    owasp: "A03:2021",
    remediation: "Use DOM manipulation methods instead"
  },
  {
    pattern: /dangerouslySetInnerHTML/g,
    title: "React XSS Risk",
    description: "dangerouslySetInnerHTML can lead to XSS if input is unsanitized",
    severity: "medium",
    category: "xss",
    cwe: "CWE-79",
    owasp: "A03:2021",
    remediation: "Sanitize HTML with DOMPurify before using"
  },
  // Authentication & Authorization
  {
    pattern: /password\s*[=:]\s*["'][^"']+["']/gi,
    title: "Hardcoded Password",
    description: "Password is hardcoded in source code",
    severity: "critical",
    category: "secrets",
    cwe: "CWE-798",
    owasp: "A07:2021",
    remediation: "Use environment variables or secret management"
  },
  {
    pattern: /api[_-]?key\s*[=:]\s*["'][a-zA-Z0-9_-]{16,}["']/gi,
    title: "Hardcoded API Key",
    description: "API key is hardcoded in source code",
    severity: "critical",
    category: "secrets",
    cwe: "CWE-798",
    owasp: "A07:2021",
    remediation: "Use environment variables"
  },
  {
    pattern: /secret[_-]?key\s*[=:]\s*["'][^"']+["']/gi,
    title: "Hardcoded Secret",
    description: "Secret key is hardcoded in source code",
    severity: "critical",
    category: "secrets",
    cwe: "CWE-798",
    owasp: "A07:2021",
    remediation: "Use environment variables or secret vault"
  },
  {
    pattern: /Bearer\s+[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
    title: "Hardcoded JWT Token",
    description: "JWT token is hardcoded",
    severity: "critical",
    category: "secrets",
    cwe: "CWE-798",
    owasp: "A07:2021"
  },
  // Cryptography
  {
    pattern: /\bmd5\s*\(/gi,
    title: "Weak Hash Algorithm",
    description: "MD5 is cryptographically broken",
    severity: "high",
    category: "crypto",
    cwe: "CWE-327",
    owasp: "A02:2021",
    remediation: "Use SHA-256 or bcrypt for passwords"
  },
  {
    pattern: /\bsha1\s*\(/gi,
    title: "Weak Hash Algorithm",
    description: "SHA1 is cryptographically weak",
    severity: "medium",
    category: "crypto",
    cwe: "CWE-327",
    owasp: "A02:2021",
    remediation: "Use SHA-256 or stronger"
  },
  {
    pattern: /createCipher\s*\(/g,
    title: "Deprecated Crypto Function",
    description: "createCipher is deprecated - use createCipheriv",
    severity: "medium",
    category: "crypto",
    cwe: "CWE-327",
    owasp: "A02:2021"
  },
  {
    pattern: /Math\.random\s*\(\)/g,
    title: "Insecure Random",
    description: "Math.random() is not cryptographically secure",
    severity: "medium",
    category: "crypto",
    cwe: "CWE-338",
    owasp: "A02:2021",
    remediation: "Use crypto.randomBytes() for security-sensitive operations"
  },
  // SQL Injection
  {
    pattern: /query\s*\(\s*[`"'].*\$\{/g,
    title: "SQL Injection Risk",
    description: "String interpolation in SQL query",
    severity: "critical",
    category: "sql-injection",
    cwe: "CWE-89",
    owasp: "A03:2021",
    remediation: "Use parameterized queries"
  },
  {
    pattern: /\+\s*req\.(body|query|params)/g,
    title: "SQL/NoSQL Injection Risk",
    description: "User input concatenated into query",
    severity: "high",
    category: "injection",
    cwe: "CWE-89",
    owasp: "A03:2021",
    remediation: "Use parameterized queries and validate input"
  },
  // Security Misconfigurations
  {
    pattern: /cors\s*:\s*true|origin\s*:\s*['"]\*['"]/gi,
    title: "Permissive CORS",
    description: "CORS allows all origins",
    severity: "medium",
    category: "misconfiguration",
    cwe: "CWE-942",
    owasp: "A05:2021",
    remediation: "Restrict CORS to specific origins"
  },
  {
    pattern: /helmet\s*\(\s*\)/g,
    title: "Helmet Check",
    description: "Helmet is used but verify configuration",
    severity: "info",
    category: "headers",
    owasp: "A05:2021"
  },
  {
    pattern: /httpOnly\s*:\s*false/gi,
    title: "Insecure Cookie",
    description: "Cookie accessible via JavaScript (XSS risk)",
    severity: "high",
    category: "cookies",
    cwe: "CWE-1004",
    owasp: "A05:2021",
    remediation: "Set httpOnly: true for sensitive cookies"
  },
  {
    pattern: /secure\s*:\s*false/gi,
    title: "Insecure Cookie",
    description: "Cookie sent over non-HTTPS",
    severity: "high",
    category: "cookies",
    cwe: "CWE-614",
    owasp: "A05:2021",
    remediation: "Set secure: true for cookies"
  },
  // Path Traversal
  {
    pattern: /\.\.\//g,
    title: "Potential Path Traversal",
    description: "Path with ../ may allow directory traversal",
    severity: "medium",
    category: "path-traversal",
    cwe: "CWE-22",
    owasp: "A01:2021",
    remediation: "Validate and sanitize file paths"
  },
  // Debug/Development
  {
    pattern: /console\.(log|debug|trace)\s*\(/g,
    title: "Debug Statement",
    description: "Debug logging may expose sensitive information",
    severity: "low",
    category: "logging",
    remediation: "Remove debug statements before production"
  },
  {
    pattern: /debugger\s*;?/g,
    title: "Debugger Statement",
    description: "Debugger statement in code",
    severity: "low",
    category: "debug",
    remediation: "Remove debugger statements"
  }
];
const SECRET_PATTERNS = [
  { pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/g, type: "Private Key" },
  { pattern: /-----BEGIN\s+CERTIFICATE-----/g, type: "Certificate" },
  { pattern: /ghp_[a-zA-Z0-9]{36}/g, type: "GitHub Personal Access Token" },
  { pattern: /github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}/g, type: "GitHub Fine-grained PAT" },
  { pattern: /sk-[a-zA-Z0-9]{48}/g, type: "OpenAI API Key" },
  { pattern: /sk-proj-[a-zA-Z0-9-_]{48,}/g, type: "OpenAI Project Key" },
  { pattern: /AIza[0-9A-Za-z\-_]{35}/g, type: "Google API Key" },
  { pattern: /AKIA[0-9A-Z]{16}/g, type: "AWS Access Key ID" },
  { pattern: /npm_[a-zA-Z0-9]{36}/g, type: "NPM Token" },
  { pattern: /xox[baprs]-[0-9a-zA-Z-]{10,}/g, type: "Slack Token" },
  { pattern: /sk_live_[a-zA-Z0-9]{24,}/g, type: "Stripe Secret Key" },
  { pattern: /sq0atp-[a-zA-Z0-9_-]{22}/g, type: "Square Access Token" },
  { pattern: /SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}/g, type: "SendGrid API Key" }
];
async function scanFile(params) {
  const { file_path, severity_threshold = "low" } = params;
  const vulnerabilities = [];
  if (!existsSync(file_path)) {
    return {
      scanned: false,
      path: file_path,
      vulnerabilities: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      risk_score: 0
    };
  }
  try {
    const content = readFileSync(file_path, "utf-8");
    const lines = content.split("\n");
    for (const check of SECURITY_PATTERNS) {
      let match;
      const regex = new RegExp(check.pattern.source, check.pattern.flags);
      while ((match = regex.exec(content)) !== null) {
        const lineNumber = content.substring(0, match.index).split("\n").length;
        vulnerabilities.push({
          severity: check.severity,
          category: check.category,
          title: check.title,
          description: check.description,
          file: file_path,
          line: lineNumber,
          cwe: check.cwe,
          owasp: check.owasp,
          remediation: check.remediation
        });
      }
    }
    for (const secret of SECRET_PATTERNS) {
      let match;
      const regex = new RegExp(secret.pattern.source, secret.pattern.flags);
      while ((match = regex.exec(content)) !== null) {
        const lineNumber = content.substring(0, match.index).split("\n").length;
        vulnerabilities.push({
          severity: "critical",
          category: "secrets",
          title: `Exposed ${secret.type}`,
          description: `${secret.type} found in source code`,
          file: file_path,
          line: lineNumber,
          cwe: "CWE-798",
          owasp: "A07:2021",
          remediation: "Remove and rotate the exposed credential immediately"
        });
      }
    }
    const severityOrder = ["info", "low", "medium", "high", "critical"];
    const thresholdIndex = severityOrder.indexOf(severity_threshold);
    const filteredVulns = vulnerabilities.filter(
      (v) => severityOrder.indexOf(v.severity) >= thresholdIndex
    );
    const summary = {
      critical: filteredVulns.filter((v) => v.severity === "critical").length,
      high: filteredVulns.filter((v) => v.severity === "high").length,
      medium: filteredVulns.filter((v) => v.severity === "medium").length,
      low: filteredVulns.filter((v) => v.severity === "low").length,
      info: filteredVulns.filter((v) => v.severity === "info").length
    };
    const risk_score = Math.min(
      100,
      summary.critical * 25 + summary.high * 10 + summary.medium * 5 + summary.low * 1
    );
    return {
      scanned: true,
      path: file_path,
      vulnerabilities: filteredVulns,
      summary,
      risk_score
    };
  } catch (error) {
    return {
      scanned: false,
      path: file_path,
      vulnerabilities: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      risk_score: 0
    };
  }
}
async function scanDependencies(params) {
  const { project_path } = params;
  const vulnerabilities = [];
  const outdated = [];
  const recommendations = [];
  const packageJsonPath = join(project_path, "package.json");
  if (!existsSync(packageJsonPath)) {
    return {
      scanned: false,
      project: project_path,
      vulnerabilities: [],
      outdated: [],
      recommendations: ["No package.json found"]
    };
  }
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies
    };
    const knownVulnerable = {
      "lodash": { severity: "medium", description: "Older versions have prototype pollution", fixed: "4.17.21" },
      "minimist": { severity: "medium", description: "Prototype pollution in versions < 1.2.6", fixed: "1.2.6" },
      "node-fetch": { severity: "medium", description: "Versions < 2.6.7 have security issues", fixed: "2.6.7" },
      "axios": { severity: "medium", description: "Versions < 0.21.1 have security issues", fixed: "0.21.1" },
      "serialize-javascript": { severity: "high", description: "XSS vulnerability in older versions", fixed: "3.1.0" },
      "jquery": { severity: "medium", description: "Multiple XSS vulnerabilities in older versions", fixed: "3.5.0" }
    };
    for (const [name, version] of Object.entries(allDeps)) {
      const versionStr = String(version).replace(/[\^~]/, "");
      if (knownVulnerable[name]) {
        const vuln = knownVulnerable[name];
        vulnerabilities.push({
          severity: vuln.severity,
          category: "dependency",
          title: `Potentially vulnerable: ${name}`,
          description: vuln.description,
          remediation: vuln.fixed ? `Upgrade to version ${vuln.fixed} or later` : "Check for updates"
        });
      }
      if (/^[0-1]\./.test(versionStr)) {
        outdated.push({ name, current: versionStr });
      }
    }
    const securityPackages = ["helmet", "cors", "express-rate-limit", "hpp", "csurf"];
    const hasSecurityPackages = securityPackages.some((pkg) => allDeps[pkg]);
    if (!hasSecurityPackages && allDeps["express"]) {
      recommendations.push("Consider adding helmet for security headers");
      recommendations.push("Consider adding express-rate-limit for rate limiting");
    }
    const hasLockFile = existsSync(join(project_path, "package-lock.json")) || existsSync(join(project_path, "yarn.lock")) || existsSync(join(project_path, "pnpm-lock.yaml"));
    if (!hasLockFile) {
      recommendations.push("Add a lock file for reproducible builds and security audits");
    }
    recommendations.push("Run 'npm audit' or 'yarn audit' for comprehensive vulnerability scan");
    return {
      scanned: true,
      project: project_path,
      vulnerabilities,
      outdated,
      recommendations
    };
  } catch (error) {
    return {
      scanned: false,
      project: project_path,
      vulnerabilities: [],
      outdated: [],
      recommendations: ["Failed to parse package.json"]
    };
  }
}
async function checkSecrets(params) {
  const { path: scanPath, recursive = true } = params;
  const secrets = [];
  let filesScanned = 0;
  const ignorePatterns = [
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "__pycache__",
    "venv",
    ".env.example",
    ".env.sample"
  ];
  function shouldIgnore(filePath) {
    return ignorePatterns.some((pattern) => filePath.includes(pattern));
  }
  function scanFileForSecrets(filePath) {
    if (shouldIgnore(filePath)) return;
    const ext = extname(filePath).toLowerCase();
    const textExtensions = [".js", ".ts", ".jsx", ".tsx", ".py", ".rb", ".go", ".java", ".php", ".json", ".yml", ".yaml", ".env", ".sh", ".bash", ".zsh", ".conf", ".cfg", ".ini", ".xml", ".html", ".css", ".sql", ".md", ".txt"];
    if (!textExtensions.includes(ext) && ext !== "") return;
    try {
      const content = readFileSync(filePath, "utf-8");
      filesScanned++;
      for (const secretPattern of SECRET_PATTERNS) {
        let match;
        const regex = new RegExp(secretPattern.pattern.source, secretPattern.pattern.flags);
        while ((match = regex.exec(content)) !== null) {
          const lineNumber = content.substring(0, match.index).split("\n").length;
          const matchedValue = match[0];
          const masked = matchedValue.substring(0, 8) + "..." + matchedValue.substring(matchedValue.length - 4);
          secrets.push({
            type: secretPattern.type,
            file: filePath,
            line: lineNumber,
            masked
          });
        }
      }
    } catch {
    }
  }
  function scanDirectory(dirPath) {
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        if (shouldIgnore(fullPath)) continue;
        if (entry.isDirectory() && recursive) {
          scanDirectory(fullPath);
        } else if (entry.isFile()) {
          scanFileForSecrets(fullPath);
        }
      }
    } catch {
    }
  }
  if (!existsSync(scanPath)) {
    return { scanned: false, path: scanPath, secrets: [], files_scanned: 0 };
  }
  const stat = statSync(scanPath);
  if (stat.isDirectory()) {
    scanDirectory(scanPath);
  } else {
    scanFileForSecrets(scanPath);
  }
  return {
    scanned: true,
    path: scanPath,
    secrets,
    files_scanned: filesScanned
  };
}
async function auditConfig(params) {
  const { config_type, content } = params;
  const issues = [];
  const recommendations = [];
  switch (config_type.toLowerCase()) {
    case "cors":
      if (/origin\s*:\s*['"]\*['"]/i.test(content) || /origin\s*:\s*true/i.test(content)) {
        issues.push({
          severity: "high",
          category: "cors",
          title: "Permissive CORS Configuration",
          description: "CORS allows all origins, which may expose your API to cross-origin attacks",
          owasp: "A05:2021",
          remediation: "Specify allowed origins explicitly"
        });
      }
      if (!/credentials\s*:\s*true/i.test(content)) {
        recommendations.push("Consider if credentials need to be allowed");
      }
      break;
    case "csp":
      if (/unsafe-inline/i.test(content)) {
        issues.push({
          severity: "medium",
          category: "csp",
          title: "CSP allows unsafe-inline",
          description: "unsafe-inline weakens XSS protection",
          owasp: "A03:2021",
          remediation: "Use nonces or hashes instead of unsafe-inline"
        });
      }
      if (/unsafe-eval/i.test(content)) {
        issues.push({
          severity: "high",
          category: "csp",
          title: "CSP allows unsafe-eval",
          description: "unsafe-eval allows eval() which is dangerous",
          owasp: "A03:2021",
          remediation: "Remove unsafe-eval from CSP"
        });
      }
      break;
    case "docker":
      if (/USER\s+root/i.test(content) || !/USER\s+/i.test(content)) {
        issues.push({
          severity: "medium",
          category: "docker",
          title: "Container runs as root",
          description: "Running as root increases attack surface",
          remediation: "Add USER directive with non-root user"
        });
      }
      if (!/:latest\s*$/im.test(content)) {
        recommendations.push("Avoid using :latest tag for reproducibility");
      }
      break;
    case "nginx":
      if (/server_tokens\s+on/i.test(content) || !/server_tokens\s+off/i.test(content)) {
        issues.push({
          severity: "low",
          category: "nginx",
          title: "Server tokens not disabled",
          description: "Nginx version may be exposed",
          remediation: "Add 'server_tokens off;'"
        });
      }
      if (!/X-Content-Type-Options/i.test(content)) {
        recommendations.push("Add X-Content-Type-Options: nosniff header");
      }
      if (!/X-Frame-Options/i.test(content)) {
        recommendations.push("Add X-Frame-Options header to prevent clickjacking");
      }
      break;
    case "kubernetes":
      if (/runAsRoot\s*:\s*true/i.test(content) || /privileged\s*:\s*true/i.test(content)) {
        issues.push({
          severity: "high",
          category: "kubernetes",
          title: "Privileged container",
          description: "Container has elevated privileges",
          remediation: "Set privileged: false and runAsNonRoot: true"
        });
      }
      if (!/readOnlyRootFilesystem\s*:\s*true/i.test(content)) {
        recommendations.push("Consider setting readOnlyRootFilesystem: true");
      }
      break;
  }
  return {
    config_type,
    issues,
    recommendations
  };
}
const scanFileSchema = z.object({
  file_path: z.string().describe("Path to the file"),
  severity_threshold: z.enum(["low", "medium", "high", "critical"]).optional()
});
const scanDependenciesSchema = z.object({
  project_path: z.string().describe("Path to project root")
});
const checkSecretsSchema = z.object({
  path: z.string().describe("Path to scan"),
  recursive: z.boolean().optional()
});
const auditConfigSchema = z.object({
  config_type: z.string().describe("Type of configuration"),
  content: z.string().describe("Configuration content")
});
export {
  auditConfig,
  auditConfigSchema,
  checkSecrets,
  checkSecretsSchema,
  scanDependencies,
  scanDependenciesSchema,
  scanFile,
  scanFileSchema
};
