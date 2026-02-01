/**
 * Git Helper Skill Implementation
 * Advanced git operations and workflow assistance
 */

import { z } from "zod";

export interface CommitSuggestion {
  type: string;
  scope?: string;
  subject: string;
  body?: string;
  full_message: string;
  alternatives: string[];
}

export interface GitCommandExplanation {
  command: string;
  description: string;
  flags: Array<{ flag: string; meaning: string }>;
  effects: string[];
  reversible: boolean;
  warning?: string;
  alternatives?: string[];
}

export interface WorkflowStep {
  step: number;
  command: string;
  description: string;
  optional?: boolean;
}

export interface HistoryAnalysis {
  commits_analyzed: number;
  contributors: string[];
  activity: {
    most_active_day?: string;
    average_commits_per_day?: number;
  };
  patterns: string[];
  suggestions: string[];
}

export interface ConflictGuide {
  conflict_type: string;
  files: string[];
  steps: Array<{
    step: number;
    action: string;
    command?: string;
  }>;
  tips: string[];
}

// Conventional commit types
const COMMIT_TYPES = {
  feat: "A new feature",
  fix: "A bug fix",
  docs: "Documentation only changes",
  style: "Changes that do not affect the meaning of the code",
  refactor: "A code change that neither fixes a bug nor adds a feature",
  perf: "A code change that improves performance",
  test: "Adding missing tests or correcting existing tests",
  build: "Changes that affect the build system or external dependencies",
  ci: "Changes to CI configuration files and scripts",
  chore: "Other changes that don't modify src or test files",
  revert: "Reverts a previous commit",
};

/**
 * Suggest a commit message based on diff
 */
export async function suggestCommitMessage(params: {
  diff: string;
  style?: string;
}): Promise<CommitSuggestion> {
  const { diff, style = "conventional" } = params;

  // Analyze the diff
  const analysis = analyzeDiff(diff);

  // Determine commit type
  let type = "chore";
  let scope = "";
  let subject = "";
  const alternatives: string[] = [];

  if (analysis.hasNewFeatures) {
    type = "feat";
  } else if (analysis.hasBugFix) {
    type = "fix";
  } else if (analysis.hasOnlyDocs) {
    type = "docs";
  } else if (analysis.hasOnlyTests) {
    type = "test";
  } else if (analysis.hasOnlyConfig) {
    type = "build";
  } else if (analysis.hasRefactoring) {
    type = "refactor";
  }

  // Determine scope from file paths
  scope = analysis.primaryScope || "";

  // Generate subject
  if (analysis.filesChanged.length === 1) {
    subject = `${analysis.changeVerb} ${analysis.filesChanged[0]}`;
  } else if (analysis.primaryScope) {
    subject = `${analysis.changeVerb} ${analysis.primaryScope} ${analysis.changeDescription}`;
  } else {
    subject = analysis.changeDescription || "update code";
  }

  // Clean up subject
  subject = subject.toLowerCase().replace(/\.$/, "");
  if (subject.length > 50) {
    subject = subject.substring(0, 47) + "...";
  }

  // Generate full message based on style
  let fullMessage = "";
  if (style === "conventional" || style === "angular") {
    fullMessage = scope ? `${type}(${scope}): ${subject}` : `${type}: ${subject}`;
  } else {
    fullMessage = subject.charAt(0).toUpperCase() + subject.slice(1);
  }

  // Generate alternatives
  if (type === "feat") {
    alternatives.push(scope ? `add(${scope}): ${subject}` : `add: ${subject}`);
  }
  alternatives.push(subject.charAt(0).toUpperCase() + subject.slice(1));
  if (analysis.filesChanged.length > 1) {
    alternatives.push(`${type}: update ${analysis.filesChanged.length} files`);
  }

  return {
    type,
    scope: scope || undefined,
    subject,
    full_message: fullMessage,
    alternatives: alternatives.filter((a) => a !== fullMessage),
  };
}

interface DiffAnalysis {
  filesChanged: string[];
  linesAdded: number;
  linesRemoved: number;
  hasNewFeatures: boolean;
  hasBugFix: boolean;
  hasOnlyDocs: boolean;
  hasOnlyTests: boolean;
  hasOnlyConfig: boolean;
  hasRefactoring: boolean;
  primaryScope: string;
  changeVerb: string;
  changeDescription: string;
}

function analyzeDiff(diff: string): DiffAnalysis {
  const lines = diff.split("\n");
  const filesChanged: string[] = [];
  let linesAdded = 0;
  let linesRemoved = 0;
  let hasNewFile = false;

  // Parse diff
  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      const match = line.match(/b\/(.+)$/);
      if (match) filesChanged.push(match[1]);
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      linesAdded++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      linesRemoved++;
    } else if (line.includes("new file mode")) {
      hasNewFile = true;
    }
  }

  // Analyze file types
  const hasOnlyDocs = filesChanged.every((f) => /\.(md|txt|rst|doc)$/i.test(f) || f.toLowerCase().includes("readme"));
  const hasOnlyTests = filesChanged.every((f) => /\.(test|spec)\.[jt]sx?$/i.test(f) || f.includes("__tests__"));
  const hasOnlyConfig = filesChanged.every((f) => /\.(json|ya?ml|toml|ini|env|config\.[jt]s)$/i.test(f) || f.includes("config"));

  // Check for feature indicators
  const hasNewFeatures = hasNewFile || (linesAdded > linesRemoved * 2 && linesAdded > 20);
  const hasBugFix = diff.toLowerCase().includes("fix") || diff.includes("bug");
  const hasRefactoring = linesAdded > 0 && linesRemoved > 0 && Math.abs(linesAdded - linesRemoved) < 10;

  // Determine primary scope
  let primaryScope = "";
  if (filesChanged.length > 0) {
    const firstFile = filesChanged[0];
    const scopeMatch = firstFile.match(/src\/(\w+)\//);
    if (scopeMatch) primaryScope = scopeMatch[1];
  }

  // Determine change verb
  let changeVerb = "update";
  if (hasNewFile) changeVerb = "add";
  else if (linesRemoved > linesAdded) changeVerb = "remove";
  else if (hasRefactoring) changeVerb = "refactor";

  // Generate description
  let changeDescription = "";
  if (filesChanged.length === 1) {
    const file = filesChanged[0].split("/").pop() || "";
    changeDescription = file;
  } else {
    changeDescription = `${filesChanged.length} files`;
  }

  return {
    filesChanged,
    linesAdded,
    linesRemoved,
    hasNewFeatures,
    hasBugFix,
    hasOnlyDocs,
    hasOnlyTests,
    hasOnlyConfig,
    hasRefactoring,
    primaryScope,
    changeVerb,
    changeDescription,
  };
}

/**
 * Explain a git command
 */
export async function explainGitCommand(params: {
  command: string;
}): Promise<GitCommandExplanation> {
  const { command } = params;

  // Parse command
  const parts = command.trim().split(/\s+/);
  const gitCmd = parts[0] === "git" ? parts[1] : parts[0];
  const flags = parts.slice(2).filter((p) => p.startsWith("-"));

  const explanations: Record<string, Partial<GitCommandExplanation>> = {
    "rebase": {
      description: "Reapply commits on top of another base tip",
      effects: ["Rewrites commit history", "Creates new commit hashes", "Maintains linear history"],
      reversible: true,
      warning: "Don't rebase commits that have been pushed to shared branches",
    },
    "reset": {
      description: "Reset current HEAD to the specified state",
      effects: ["Moves HEAD pointer", "Can modify staging area", "Can modify working directory"],
      reversible: true,
      warning: "With --hard, uncommitted changes are lost",
    },
    "cherry-pick": {
      description: "Apply the changes from specific commits to current branch",
      effects: ["Creates new commit with same changes", "New commit has different hash"],
      reversible: true,
    },
    "stash": {
      description: "Stash the changes in a dirty working directory",
      effects: ["Saves local modifications", "Cleans working directory", "Changes can be reapplied later"],
      reversible: true,
    },
    "merge": {
      description: "Join two or more development histories together",
      effects: ["Creates merge commit", "Combines branch histories"],
      reversible: true,
    },
    "push": {
      description: "Update remote refs along with associated objects",
      effects: ["Uploads local commits", "Updates remote branch"],
      reversible: false,
      warning: "Use --force with extreme caution",
    },
    "pull": {
      description: "Fetch from and integrate with another repository or branch",
      effects: ["Downloads remote changes", "Merges into current branch"],
      reversible: true,
    },
    "fetch": {
      description: "Download objects and refs from another repository",
      effects: ["Downloads remote refs", "Does not modify local branches"],
      reversible: true,
    },
    "bisect": {
      description: "Use binary search to find the commit that introduced a bug",
      effects: ["Checks out commits for testing", "Helps identify problematic commit"],
      reversible: true,
    },
    "reflog": {
      description: "Manage reflog information (reference logs)",
      effects: ["Shows history of HEAD positions", "Useful for recovery"],
      reversible: true,
    },
  };

  const base = explanations[gitCmd] || {
    description: `Git ${gitCmd} command`,
    effects: [],
    reversible: true,
  };

  // Parse flags
  const flagExplanations: Array<{ flag: string; meaning: string }> = [];
  const flagMeanings: Record<string, Record<string, string>> = {
    common: {
      "-f": "Force the operation",
      "--force": "Force the operation",
      "-v": "Verbose output",
      "--verbose": "Verbose output",
      "-n": "Dry run (show what would happen)",
      "--dry-run": "Dry run (show what would happen)",
      "-q": "Quiet mode",
      "--quiet": "Quiet mode",
    },
    reset: {
      "--hard": "Reset staging area and working directory (destructive)",
      "--soft": "Keep working directory and staging area",
      "--mixed": "Keep working directory, reset staging area (default)",
    },
    rebase: {
      "-i": "Interactive rebase",
      "--interactive": "Interactive rebase",
      "--onto": "Rebase onto a different base",
      "--continue": "Continue after resolving conflicts",
      "--abort": "Abort and return to original state",
    },
    push: {
      "-u": "Set upstream tracking",
      "--set-upstream": "Set upstream tracking",
      "--force-with-lease": "Force push with safety check",
    },
  };

  for (const flag of flags) {
    const meaning =
      flagMeanings[gitCmd]?.[flag] ||
      flagMeanings.common[flag] ||
      "Unknown flag";
    flagExplanations.push({ flag, meaning });
  }

  // Check for dangerous combinations
  let warning = base.warning;
  if (gitCmd === "push" && (flags.includes("-f") || flags.includes("--force"))) {
    warning = "Force push rewrites remote history - very dangerous on shared branches!";
  }
  if (gitCmd === "reset" && flags.includes("--hard")) {
    warning = "Hard reset will permanently lose uncommitted changes!";
  }

  return {
    command,
    description: base.description || "",
    flags: flagExplanations,
    effects: base.effects || [],
    reversible: base.reversible ?? true,
    warning,
  };
}

/**
 * Suggest git workflow for a goal
 */
export async function suggestGitWorkflow(params: {
  goal: string;
  current_state?: string;
}): Promise<{
  goal: string;
  steps: WorkflowStep[];
  notes: string[];
}> {
  const { goal, current_state } = params;
  const steps: WorkflowStep[] = [];
  const notes: string[] = [];

  const goalLower = goal.toLowerCase();

  if (goalLower.includes("undo") && goalLower.includes("commit")) {
    steps.push(
      { step: 1, command: "git log --oneline -5", description: "View recent commits" },
      { step: 2, command: "git reset --soft HEAD~1", description: "Undo last commit, keep changes staged" }
    );
    notes.push("Use --hard instead of --soft to discard changes completely");
    notes.push("If already pushed, use git revert instead");
  } else if (goalLower.includes("squash")) {
    steps.push(
      { step: 1, command: "git log --oneline -10", description: "View commits to squash" },
      { step: 2, command: "git rebase -i HEAD~N", description: "Interactive rebase (replace N with number of commits)" },
      { step: 3, command: "# Change 'pick' to 'squash' for commits to combine", description: "Edit the rebase file" },
      { step: 4, command: "# Edit the commit message", description: "Combine commit messages" }
    );
    notes.push("Don't squash commits that have been pushed to shared branches");
  } else if (goalLower.includes("feature branch") || goalLower.includes("new branch")) {
    steps.push(
      { step: 1, command: "git checkout main", description: "Switch to main branch" },
      { step: 2, command: "git pull origin main", description: "Get latest changes" },
      { step: 3, command: "git checkout -b feature/your-feature-name", description: "Create and switch to new branch" },
      { step: 4, command: "# Make your changes", description: "Develop your feature" },
      { step: 5, command: "git add .", description: "Stage changes" },
      { step: 6, command: "git commit -m 'feat: your feature description'", description: "Commit with conventional message" },
      { step: 7, command: "git push -u origin feature/your-feature-name", description: "Push and set upstream" }
    );
  } else if (goalLower.includes("merge conflict") || goalLower.includes("resolve conflict")) {
    steps.push(
      { step: 1, command: "git status", description: "See which files have conflicts" },
      { step: 2, command: "# Edit conflicting files", description: "Resolve conflicts manually" },
      { step: 3, command: "git add <resolved-files>", description: "Mark as resolved" },
      { step: 4, command: "git commit", description: "Complete the merge" }
    );
    notes.push("Look for <<<<<<< HEAD, =======, and >>>>>>> markers");
    notes.push("Use git mergetool for a visual merge tool");
  } else if (goalLower.includes("stash")) {
    steps.push(
      { step: 1, command: "git stash", description: "Stash current changes" },
      { step: 2, command: "git stash list", description: "View stashed changes", optional: true },
      { step: 3, command: "git stash pop", description: "Apply and remove stash" }
    );
    notes.push("Use git stash apply to apply without removing from stash");
    notes.push("Use git stash drop to remove without applying");
  } else if (goalLower.includes("clean") || goalLower.includes("discard")) {
    steps.push(
      { step: 1, command: "git status", description: "See what will be affected" },
      { step: 2, command: "git checkout -- .", description: "Discard all unstaged changes" },
      { step: 3, command: "git clean -fd", description: "Remove untracked files and directories", optional: true }
    );
    notes.push("These operations are destructive - changes cannot be recovered!");
    notes.push("Use git clean -n first to preview what will be removed");
  } else if (goalLower.includes("sync") || goalLower.includes("update")) {
    steps.push(
      { step: 1, command: "git fetch origin", description: "Get remote changes" },
      { step: 2, command: "git status", description: "Check current state" },
      { step: 3, command: "git pull --rebase origin main", description: "Rebase your changes on top of main" }
    );
    notes.push("--rebase keeps history linear");
    notes.push("Resolve any conflicts if they occur");
  } else {
    steps.push(
      { step: 1, command: "git status", description: "Check current state" },
      { step: 2, command: "git log --oneline -5", description: "View recent history" },
      { step: 3, command: "git branch -a", description: "List all branches" }
    );
    notes.push("Please provide more details about what you want to accomplish");
  }

  return { goal, steps, notes };
}

/**
 * Analyze git history
 */
export async function analyzeGitHistory(params: {
  log_output: string;
}): Promise<HistoryAnalysis> {
  const { log_output } = params;
  const lines = log_output.split("\n").filter((l) => l.trim());
  const contributors = new Set<string>();
  const dates: string[] = [];
  const patterns: string[] = [];
  const suggestions: string[] = [];

  // Parse log lines (assuming format from git log)
  for (const line of lines) {
    // Extract author
    const authorMatch = line.match(/Author:\s*([^<]+)</);
    if (authorMatch) {
      contributors.add(authorMatch[1].trim());
    }

    // Extract date
    const dateMatch = line.match(/Date:\s*(.+)/);
    if (dateMatch) {
      dates.push(dateMatch[1].trim());
    }
  }

  // Check for patterns
  const hasConventionalCommits = log_output.match(/(feat|fix|docs|style|refactor|test|chore)(\(.+\))?:/g);
  if (hasConventionalCommits) {
    patterns.push("Uses Conventional Commits format");
  } else {
    suggestions.push("Consider adopting Conventional Commits for better automation");
  }

  const hasLongCommits = lines.some((l) => l.length > 72 && !l.startsWith("Date:") && !l.startsWith("Author:"));
  if (hasLongCommits) {
    patterns.push("Some commits have long subject lines");
    suggestions.push("Keep commit subjects under 72 characters");
  }

  const hasMergeCommits = log_output.includes("Merge pull request") || log_output.includes("Merge branch");
  if (hasMergeCommits) {
    patterns.push("Uses merge commits");
  }

  return {
    commits_analyzed: lines.filter((l) => l.match(/^[a-f0-9]{7,}/)).length || lines.length,
    contributors: Array.from(contributors),
    activity: {
      most_active_day: dates[0] || undefined,
      average_commits_per_day: dates.length > 0 ? Math.round(dates.length / 7) : undefined,
    },
    patterns,
    suggestions,
  };
}

/**
 * Guide for resolving merge conflicts
 */
export async function resolveConflictGuide(params: {
  conflict_files: string[];
  conflict_type?: string;
}): Promise<ConflictGuide> {
  const { conflict_files, conflict_type = "merge" } = params;

  const steps: ConflictGuide["steps"] = [
    { step: 1, action: "View the conflicting files", command: "git status" },
  ];

  for (let i = 0; i < conflict_files.length; i++) {
    steps.push({
      step: i + 2,
      action: `Open and resolve conflicts in ${conflict_files[i]}`,
      command: `code ${conflict_files[i]}`,
    });
  }

  const nextStep = conflict_files.length + 2;

  steps.push(
    { step: nextStep, action: "Stage resolved files", command: `git add ${conflict_files.join(" ")}` }
  );

  if (conflict_type === "rebase") {
    steps.push(
      { step: nextStep + 1, action: "Continue the rebase", command: "git rebase --continue" }
    );
  } else if (conflict_type === "cherry-pick") {
    steps.push(
      { step: nextStep + 1, action: "Continue the cherry-pick", command: "git cherry-pick --continue" }
    );
  } else {
    steps.push(
      { step: nextStep + 1, action: "Complete the merge", command: "git commit" }
    );
  }

  const tips = [
    "Look for <<<<<<< (current changes), ======= (separator), and >>>>>>> (incoming changes)",
    "You can use git diff to see the conflict more clearly",
    "Use a visual merge tool: git mergetool",
    `To abort the ${conflict_type}: git ${conflict_type} --abort`,
    "Make sure to remove all conflict markers after resolving",
  ];

  return {
    conflict_type,
    files: conflict_files,
    steps,
    tips,
  };
}

// Export schemas
export const suggestCommitMessageSchema = z.object({
  diff: z.string().describe("Git diff of changes"),
  style: z.enum(["conventional", "angular", "simple"]).optional(),
});

export const explainGitCommandSchema = z.object({
  command: z.string().describe("Git command to explain"),
});

export const suggestGitWorkflowSchema = z.object({
  goal: z.string().describe("What you want to accomplish"),
  current_state: z.string().optional(),
});

export const analyzeGitHistorySchema = z.object({
  log_output: z.string().describe("Git log output"),
});

export const resolveConflictGuideSchema = z.object({
  conflict_files: z.array(z.string()).describe("Files with conflicts"),
  conflict_type: z.enum(["merge", "rebase", "cherry-pick"]).optional(),
});
