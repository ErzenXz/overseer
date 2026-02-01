import { tool } from "ai";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { resolve } from "path";
import { toolExecutionsModel } from "../../database/index";
import { createLogger } from "../../lib/logger";

const execAsync = promisify(exec);
const logger = createLogger("tools:git");

const TIMEOUT_MS = 30000;

async function runGitCommand(
  command: string,
  cwd: string
): Promise<{ success: boolean; output: string; error?: string }> {
  try {
    const { stdout, stderr } = await execAsync(`git ${command}`, {
      cwd,
      timeout: TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });

    return {
      success: true,
      output: stdout.trim() || stderr.trim() || "(no output)",
    };
  } catch (error: unknown) {
    const err = error as { message?: string; stderr?: string };
    return {
      success: false,
      output: err.stderr || "",
      error: err.message || String(error),
    };
  }
}

export const gitStatus = tool({
  description: `Get the current git status of a repository. Shows modified, staged, and untracked files.`,
  parameters: z.object({
    path: z.string().optional().describe("Path to the git repository (default: current directory)"),
  }),
  execute: async ({ path }) => {
    const repoPath = resolve(path || process.cwd());

    if (!existsSync(`${repoPath}/.git`)) {
      return {
        success: false,
        error: `Not a git repository: ${repoPath}`,
      };
    }

    const result = await runGitCommand("status --porcelain=v2 --branch", repoPath);

    if (!result.success) {
      return result;
    }

    // Also get a human-readable status
    const humanResult = await runGitCommand("status", repoPath);

    toolExecutionsModel.create({
      tool_name: "gitStatus",
      input: { path },
      output: result.output.substring(0, 1000),
      success: true,
    });

    return {
      success: true,
      path: repoPath,
      status: humanResult.output,
      porcelain: result.output,
    };
  },
});

export const gitLog = tool({
  description: `View git commit history.`,
  parameters: z.object({
    path: z.string().optional().describe("Path to the git repository"),
    count: z.number().optional().describe("Number of commits to show (default: 10)"),
    oneline: z.boolean().optional().describe("Show compact one-line format (default: true)"),
  }),
  execute: async ({ path, count = 10, oneline = true }) => {
    const repoPath = resolve(path || process.cwd());

    const format = oneline ? "--oneline" : '--format="%h %an <%ae> %s (%cr)"';
    const result = await runGitCommand(`log ${format} -n ${count}`, repoPath);

    toolExecutionsModel.create({
      tool_name: "gitLog",
      input: { path, count },
      output: result.output.substring(0, 1000),
      success: result.success,
    });

    return {
      success: result.success,
      path: repoPath,
      commits: result.output,
      error: result.error,
    };
  },
});

export const gitDiff = tool({
  description: `Show changes in the repository.`,
  parameters: z.object({
    path: z.string().optional().describe("Path to the git repository"),
    staged: z.boolean().optional().describe("Show staged changes (default: false)"),
    file: z.string().optional().describe("Specific file to diff"),
  }),
  execute: async ({ path, staged = false, file }) => {
    const repoPath = resolve(path || process.cwd());

    let command = "diff";
    if (staged) command += " --staged";
    if (file) command += ` -- "${file}"`;

    const result = await runGitCommand(command, repoPath);

    toolExecutionsModel.create({
      tool_name: "gitDiff",
      input: { path, staged, file },
      output: result.output.substring(0, 2000),
      success: result.success,
    });

    return {
      success: result.success,
      path: repoPath,
      diff: result.output || "(no changes)",
      error: result.error,
    };
  },
});

export const gitBranch = tool({
  description: `List or manage git branches.`,
  parameters: z.object({
    path: z.string().optional().describe("Path to the git repository"),
    action: z.enum(["list", "current", "create", "delete", "checkout"]).describe("Branch action"),
    branchName: z.string().optional().describe("Branch name (for create/delete/checkout)"),
  }),
  execute: async ({ path, action, branchName }) => {
    const repoPath = resolve(path || process.cwd());

    let command: string;
    switch (action) {
      case "list":
        command = "branch -a";
        break;
      case "current":
        command = "branch --show-current";
        break;
      case "create":
        if (!branchName) return { success: false, error: "Branch name required" };
        command = `branch "${branchName}"`;
        break;
      case "delete":
        if (!branchName) return { success: false, error: "Branch name required" };
        command = `branch -d "${branchName}"`;
        break;
      case "checkout":
        if (!branchName) return { success: false, error: "Branch name required" };
        command = `checkout "${branchName}"`;
        break;
    }

    const result = await runGitCommand(command, repoPath);

    toolExecutionsModel.create({
      tool_name: "gitBranch",
      input: { path, action, branchName },
      output: result.output,
      success: result.success,
    });

    return {
      success: result.success,
      path: repoPath,
      output: result.output,
      error: result.error,
    };
  },
});

export const gitAdd = tool({
  description: `Stage files for commit.`,
  parameters: z.object({
    path: z.string().optional().describe("Path to the git repository"),
    files: z.array(z.string()).optional().describe("Files to stage (default: all)"),
  }),
  execute: async ({ path, files }) => {
    const repoPath = resolve(path || process.cwd());

    const fileSpec = files && files.length > 0 ? files.map(f => `"${f}"`).join(" ") : ".";
    const result = await runGitCommand(`add ${fileSpec}`, repoPath);

    toolExecutionsModel.create({
      tool_name: "gitAdd",
      input: { path, files },
      output: result.output || "Files staged",
      success: result.success,
    });

    return {
      success: result.success,
      path: repoPath,
      message: result.success ? "Files staged successfully" : result.error,
      output: result.output,
    };
  },
});

export const gitCommit = tool({
  description: `Create a git commit with staged changes.`,
  parameters: z.object({
    path: z.string().optional().describe("Path to the git repository"),
    message: z.string().describe("Commit message"),
  }),
  execute: async ({ path, message }) => {
    const repoPath = resolve(path || process.cwd());

    // Escape message for shell
    const escapedMessage = message.replace(/"/g, '\\"');
    const result = await runGitCommand(`commit -m "${escapedMessage}"`, repoPath);

    toolExecutionsModel.create({
      tool_name: "gitCommit",
      input: { path, message },
      output: result.output,
      success: result.success,
    });

    return {
      success: result.success,
      path: repoPath,
      output: result.output,
      error: result.error,
    };
  },
});

export const gitPull = tool({
  description: `Pull changes from remote repository.`,
  parameters: z.object({
    path: z.string().optional().describe("Path to the git repository"),
    remote: z.string().optional().describe("Remote name (default: origin)"),
    branch: z.string().optional().describe("Branch name (default: current branch)"),
  }),
  execute: async ({ path, remote = "origin", branch }) => {
    const repoPath = resolve(path || process.cwd());

    const command = branch ? `pull ${remote} ${branch}` : `pull ${remote}`;
    const result = await runGitCommand(command, repoPath);

    toolExecutionsModel.create({
      tool_name: "gitPull",
      input: { path, remote, branch },
      output: result.output,
      success: result.success,
    });

    return {
      success: result.success,
      path: repoPath,
      output: result.output,
      error: result.error,
    };
  },
});

export const gitPush = tool({
  description: `Push changes to remote repository.`,
  parameters: z.object({
    path: z.string().optional().describe("Path to the git repository"),
    remote: z.string().optional().describe("Remote name (default: origin)"),
    branch: z.string().optional().describe("Branch name (default: current branch)"),
    setUpstream: z.boolean().optional().describe("Set upstream tracking (default: false)"),
  }),
  execute: async ({ path, remote = "origin", branch, setUpstream }) => {
    const repoPath = resolve(path || process.cwd());

    let command = "push";
    if (setUpstream) command += " -u";
    command += ` ${remote}`;
    if (branch) command += ` ${branch}`;

    const result = await runGitCommand(command, repoPath);

    toolExecutionsModel.create({
      tool_name: "gitPush",
      input: { path, remote, branch, setUpstream },
      output: result.output,
      success: result.success,
    });

    return {
      success: result.success,
      path: repoPath,
      output: result.output,
      error: result.error,
    };
  },
});

export const gitClone = tool({
  description: `Clone a git repository.`,
  parameters: z.object({
    url: z.string().describe("Repository URL to clone"),
    destination: z.string().optional().describe("Destination directory"),
    branch: z.string().optional().describe("Branch to clone"),
  }),
  execute: async ({ url, destination, branch }) => {
    const cwd = process.cwd();

    let command = `clone "${url}"`;
    if (branch) command += ` --branch "${branch}"`;
    if (destination) command += ` "${destination}"`;

    const result = await runGitCommand(command, cwd);

    toolExecutionsModel.create({
      tool_name: "gitClone",
      input: { url, destination, branch },
      output: result.output,
      success: result.success,
    });

    return {
      success: result.success,
      output: result.output,
      error: result.error,
    };
  },
});

export const gitStash = tool({
  description: `Stash or restore uncommitted changes.`,
  parameters: z.object({
    path: z.string().optional().describe("Path to the git repository"),
    action: z.enum(["save", "pop", "list", "drop"]).describe("Stash action"),
    message: z.string().optional().describe("Stash message (for save action)"),
  }),
  execute: async ({ path, action, message }) => {
    const repoPath = resolve(path || process.cwd());

    let command: string;
    switch (action) {
      case "save":
        command = message ? `stash save "${message}"` : "stash";
        break;
      case "pop":
        command = "stash pop";
        break;
      case "list":
        command = "stash list";
        break;
      case "drop":
        command = "stash drop";
        break;
    }

    const result = await runGitCommand(command, repoPath);

    toolExecutionsModel.create({
      tool_name: "gitStash",
      input: { path, action, message },
      output: result.output,
      success: result.success,
    });

    return {
      success: result.success,
      path: repoPath,
      output: result.output || "(no output)",
      error: result.error,
    };
  },
});
