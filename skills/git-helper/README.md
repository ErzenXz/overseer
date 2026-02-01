# Git Helper Skill

Advanced git operations, branch management, commit formatting, and workflow assistance.

## Features

- **Commit Messages**: Generate conventional commit messages
- **Command Explanation**: Understand complex git commands
- **Workflow Assistance**: Step-by-step guides for common tasks
- **History Analysis**: Insights from git history
- **Conflict Resolution**: Guided conflict resolution

## Tools

### `suggest_commit_message`

Suggest a commit message based on changes.

**Parameters:**
- `diff` (required): Git diff of the changes
- `style` (optional): conventional, angular, simple

**Returns:**
- Suggested type (feat, fix, etc.)
- Scope
- Subject line
- Full formatted message
- Alternative suggestions

**Example:**
```json
{
  "diff": "diff --git a/src/auth.ts...",
  "style": "conventional"
}
```

### `explain_git_command`

Explain what a git command does.

**Parameters:**
- `command` (required): The git command to explain

**Returns:**
- Description
- Flag meanings
- Effects
- Whether it's reversible
- Warnings for dangerous commands

### `suggest_git_workflow`

Get step-by-step commands for a workflow.

**Parameters:**
- `goal` (required): What you want to accomplish
- `current_state` (optional): Current git state

**Supported goals:**
- Undo commit
- Squash commits
- Create feature branch
- Resolve merge conflicts
- Stash changes
- Clean/discard changes
- Sync with remote

### `analyze_git_history`

Analyze git history for patterns.

**Parameters:**
- `log_output` (required): Output of git log

**Returns:**
- Commit count
- Contributors
- Activity patterns
- Style suggestions

### `resolve_conflict_guide`

Get a guide for resolving conflicts.

**Parameters:**
- `conflict_files` (required): Files with conflicts
- `conflict_type` (optional): merge, rebase, cherry-pick

## Conventional Commit Types

| Type | Description |
|------|-------------|
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation changes |
| `style` | Formatting, no code change |
| `refactor` | Code restructuring |
| `perf` | Performance improvement |
| `test` | Adding tests |
| `build` | Build system changes |
| `ci` | CI configuration |
| `chore` | Maintenance tasks |

## Triggers

- "git"
- "commit"
- "branch"
- "merge"
- "rebase"
- "stash"
- "cherry-pick"
- "bisect"

## Usage Examples

1. "Suggest a commit message for my changes"
2. "Explain what git reset --hard does"
3. "How do I squash my last 3 commits?"
4. "Help me resolve this merge conflict"
5. "Analyze my repository's commit history"
