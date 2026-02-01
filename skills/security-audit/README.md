# Security Audit Skill

Scan code and configurations for security vulnerabilities and compliance issues.

## Features

- **File Scanning**: Detect security vulnerabilities in code
- **Dependency Scanning**: Check for vulnerable packages
- **Secret Detection**: Find hardcoded credentials
- **Config Auditing**: Audit security configurations

## Tools

### `scan_file`

Scan a file for security vulnerabilities.

**Parameters:**
- `file_path` (required): Path to the file to scan
- `severity_threshold` (optional): Minimum severity to report (low, medium, high, critical)

**Returns:**
- List of vulnerabilities with CWE and OWASP references
- Risk score (0-100)
- Summary by severity

### `scan_dependencies`

Scan project dependencies for known vulnerabilities.

**Parameters:**
- `project_path` (required): Path to the project root

**Returns:**
- Vulnerable dependencies
- Outdated packages
- Security recommendations

### `check_secrets`

Scan for hardcoded secrets and credentials.

**Parameters:**
- `path` (required): Path to scan (file or directory)
- `recursive` (optional): Scan subdirectories (default: true)

**Detects:**
- API keys (OpenAI, Google, AWS, etc.)
- Private keys and certificates
- GitHub tokens
- Slack tokens
- Stripe keys

### `audit_config`

Audit security configuration files.

**Parameters:**
- `config_type` (required): cors, csp, docker, nginx, kubernetes
- `content` (required): Configuration content

## Vulnerability Categories

| Category | Description |
|----------|-------------|
| `injection` | Code/command injection risks |
| `xss` | Cross-site scripting vulnerabilities |
| `secrets` | Hardcoded credentials |
| `crypto` | Weak cryptography |
| `sql-injection` | SQL injection risks |
| `misconfiguration` | Security misconfigurations |

## OWASP Top 10 Coverage

- A01:2021 - Broken Access Control
- A02:2021 - Cryptographic Failures
- A03:2021 - Injection
- A05:2021 - Security Misconfiguration
- A07:2021 - Identification and Authentication Failures

## Triggers

- "security"
- "audit"
- "vulnerability"
- "scan"
- "secure"
- "CVE"
- "OWASP"

## Usage Examples

1. "Scan this file for security issues"
2. "Check my project for vulnerable dependencies"
3. "Audit my CORS configuration"
4. "Find hardcoded secrets in my codebase"
