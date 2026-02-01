# Code Review Skill

Automated code review for bugs, security issues, performance problems, and best practices violations.

## Features

- **File Review**: Analyze entire files for issues
- **Diff Review**: Review git diffs before committing
- **Pattern Detection**: Check code against known anti-patterns
- **Multi-language Support**: TypeScript, JavaScript, Python, and more

## Tools

### `review_file`

Review a file for code quality issues.

**Parameters:**
- `file_path` (required): Path to the file to review
- `focus_areas` (optional): Specific areas to focus on (security, performance, style)

**Example:**
```json
{
  "file_path": "src/app/api/auth/route.ts",
  "focus_areas": ["security", "error-handling"]
}
```

### `review_diff`

Review a git diff for issues.

**Parameters:**
- `diff` (required): The git diff content
- `context` (optional): Additional context about the changes

### `check_patterns`

Check code against anti-patterns.

**Parameters:**
- `code` (required): The code snippet to check
- `language` (required): Programming language

## Issue Categories

| Category | Description |
|----------|-------------|
| `security` | Security vulnerabilities |
| `performance` | Performance issues |
| `best-practice` | Best practice violations |
| `error-handling` | Missing error handling |
| `type-safety` | Type safety issues |
| `debugging` | Debug code left in |
| `complexity` | Code complexity issues |
| `style` | Style/formatting issues |
| `todo` | TODO/FIXME comments |

## Severity Levels

- **error**: Critical issues that must be fixed
- **warning**: Issues that should be addressed
- **info**: Informational findings
- **suggestion**: Optional improvements

## Triggers

- "review code"
- "check code"
- "code review"
- "analyze code"
- "review my code"
- "code quality"

## Usage Examples

1. "Review this file for security issues"
2. "Check my code for best practices"
3. "Analyze the changes in my last commit"
