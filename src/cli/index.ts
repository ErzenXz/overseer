#!/usr/bin/env node
/**
 * Overseer CLI
 * Command-line interface for managing the Overseer AI agent.
 *
 * Usage:
 *   overseer status                    Show system status
 *   overseer agent run <prompt>        Run agent with a prompt (non-interactive)
 *   overseer agent interactive         Start interactive agent session
 *   overseer cron list                 List all cron jobs
 *   overseer cron add                  Add a new cron job
 *   overseer cron remove <id>          Remove a cron job
 *   overseer cron enable <id>          Enable a cron job
 *   overseer cron disable <id>         Disable a cron job
 *   overseer cron run <id>             Run a cron job immediately
 *   overseer cron history [id]         Show execution history
 */

import { config } from "dotenv";
import { resolve } from "path";
import readline from "readline";

// Load environment variables
config({ path: resolve(process.cwd(), ".env") });

// =====================================================
// Formatting helpers
// =====================================================

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const AMBER = "\x1b[38;5;214m";

function heading(text: string): void {
  console.log(`\n${BOLD}${AMBER}${text}${RESET}`);
}

function success(text: string): void {
  console.log(`${GREEN}[OK]${RESET} ${text}`);
}

function error(text: string): void {
  console.error(`${RED}[ERROR]${RESET} ${text}`);
}

function warn(text: string): void {
  console.log(`${YELLOW}[WARN]${RESET} ${text}`);
}

function info(text: string): void {
  console.log(`${DIM}${text}${RESET}`);
}

function table(rows: string[][]): void {
  if (rows.length === 0) return;

  // Calculate column widths
  const colWidths = rows[0].map((_, colIdx) =>
    Math.max(...rows.map((row) => (row[colIdx] || "").length))
  );

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const line = row
      .map((cell, colIdx) => (cell || "").padEnd(colWidths[colIdx]))
      .join("  ");

    if (i === 0) {
      console.log(`${BOLD}${line}${RESET}`);
      console.log(colWidths.map((w) => "─".repeat(w)).join("──"));
    } else {
      console.log(line);
    }
  }
}

// =====================================================
// Commands
// =====================================================

async function cmdStatus(): Promise<void> {
  const { cronJobsModel, cronExecutionsModel } = await import("../database/models/cron");
  const { conversationsModel, providersModel } = await import("../database/index");

  heading("OVERSEER STATUS");

  // Provider status
  const providers = providersModel.findActive();
  console.log(`\n${BOLD}Providers:${RESET}`);
  if (providers.length === 0) {
    warn("No active providers configured");
  } else {
    for (const p of providers) {
      success(`${p.name} / ${p.model}`);
    }
  }

  // Cron status
  const totalJobs = cronJobsModel.count();
  const enabledJobs = cronJobsModel.countEnabled();
  const totalExecs = cronExecutionsModel.count();
  const runningExecs = cronExecutionsModel.getRunningCount();

  console.log(`\n${BOLD}Cron Jobs:${RESET}`);
  console.log(`  Total:    ${totalJobs}`);
  console.log(`  Enabled:  ${enabledJobs}`);
  console.log(`  Running:  ${runningExecs}`);
  console.log(`  Executed: ${totalExecs}`);

  // Recent conversations
  const convCount = conversationsModel.count();
  console.log(`\n${BOLD}Conversations:${RESET} ${convCount}`);

  console.log();
}

async function cmdAgentRun(prompt: string): Promise<void> {
  const { executeSingleCommand } = await import("../agent/runner");
  await executeSingleCommand(prompt);
}

async function cmdAgentInteractive(): Promise<void> {
  const { startInteractiveMode } = await import("../agent/runner");
  await startInteractiveMode();
}

async function cmdCronList(): Promise<void> {
  const { cronJobsModel } = await import("../database/models/cron");
  const { describeCronExpression } = await import("../database/models/cron");

  heading("CRON JOBS");

  const jobs = cronJobsModel.findAll();

  if (jobs.length === 0) {
    info("No cron jobs configured.\n");
    return;
  }

  const rows: string[][] = [
    ["ID", "Name", "Schedule", "Enabled", "Last Status", "Runs", "Next Run"],
  ];

  for (const job of jobs) {
    rows.push([
      String(job.id),
      job.name,
      describeCronExpression(job.cron_expression),
      job.enabled ? `${GREEN}yes${RESET}` : `${RED}no${RESET}`,
      job.last_status || "never",
      String(job.run_count),
      job.next_run_at
        ? new Date(job.next_run_at).toLocaleString()
        : "—",
    ]);
  }

  table(rows);
  console.log(`\n${DIM}Total: ${jobs.length} job(s)${RESET}\n`);
}

async function cmdCronAdd(): Promise<void> {
  const { cronJobsModel, isValidCronExpression } = await import("../database/models/cron");

  heading("ADD CRON JOB");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question: string): Promise<string> =>
    new Promise((resolve) => {
      rl.question(`${CYAN}${question}${RESET} `, (answer) => resolve(answer.trim()));
    });

  try {
    const name = await ask("Job name:");
    if (!name) {
      error("Name is required");
      rl.close();
      return;
    }

    const cronExpr = await ask("Cron expression (e.g. '0 9 * * *'):");
    if (!isValidCronExpression(cronExpr)) {
      error(`Invalid cron expression: "${cronExpr}"`);
      rl.close();
      return;
    }

    const prompt = await ask("AI prompt (what should the agent do?):");
    if (!prompt) {
      error("Prompt is required");
      rl.close();
      return;
    }

    const description = await ask("Description (optional):");
    const timezone = await ask("Timezone (default: UTC):");

    const job = cronJobsModel.create({
      name,
      cron_expression: cronExpr,
      prompt,
      description: description || undefined,
      timezone: timezone || "UTC",
      created_by: "cli",
    });

    success(`Cron job created: ID=${job.id}, Name="${job.name}"`);
    info(`Next run: ${job.next_run_at}`);
  } finally {
    rl.close();
  }

  console.log();
}

async function cmdCronRemove(idStr: string): Promise<void> {
  const { cronJobsModel } = await import("../database/models/cron");

  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    error(`Invalid job ID: "${idStr}"`);
    process.exit(1);
  }

  const job = cronJobsModel.findById(id);
  if (!job) {
    error(`Cron job ${id} not found`);
    process.exit(1);
  }

  const deleted = cronJobsModel.delete(id);
  if (deleted) {
    success(`Cron job "${job.name}" (ID: ${id}) deleted`);
  } else {
    error(`Failed to delete cron job ${id}`);
  }
}

async function cmdCronToggle(idStr: string, enable: boolean): Promise<void> {
  const { cronJobsModel } = await import("../database/models/cron");

  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    error(`Invalid job ID: "${idStr}"`);
    process.exit(1);
  }

  const job = enable ? cronJobsModel.enable(id) : cronJobsModel.disable(id);

  if (!job) {
    error(`Cron job ${id} not found`);
    process.exit(1);
  }

  success(`Cron job "${job.name}" ${enable ? "enabled" : "disabled"}`);
  if (enable && job.next_run_at) {
    info(`Next run: ${new Date(job.next_run_at).toLocaleString()}`);
  }
}

async function cmdCronRun(idStr: string): Promise<void> {
  const { cronJobsModel } = await import("../database/models/cron");
  const { triggerJob } = await import("../lib/cron-engine");

  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    error(`Invalid job ID: "${idStr}"`);
    process.exit(1);
  }

  const job = cronJobsModel.findById(id);
  if (!job) {
    error(`Cron job ${id} not found`);
    process.exit(1);
  }

  console.log(`\nTriggering cron job "${job.name}" (ID: ${id})...`);
  console.log(`Prompt: ${job.prompt.slice(0, 200)}${job.prompt.length > 200 ? "..." : ""}\n`);

  const result = await triggerJob(id);

  if (result.success) {
    success("Job execution completed");
  } else {
    error(`Job execution failed: ${result.error}`);
  }
}

async function cmdCronHistory(idStr?: string): Promise<void> {
  const { cronExecutionsModel } = await import("../database/models/cron");

  heading("CRON EXECUTION HISTORY");

  let executions;
  if (idStr) {
    const id = parseInt(idStr, 10);
    if (isNaN(id)) {
      error(`Invalid job ID: "${idStr}"`);
      process.exit(1);
    }
    executions = cronExecutionsModel.findByJobId(id, 20);
  } else {
    executions = cronExecutionsModel.findRecent(30);
  }

  if (executions.length === 0) {
    info("No execution history found.\n");
    return;
  }

  const rows: string[][] = [
    ["ID", "Job ID", "Status", "Started", "Duration", "Tokens", "Error"],
  ];

  for (const exec of executions) {
    const status =
      exec.status === "success"
        ? `${GREEN}success${RESET}`
        : exec.status === "running"
          ? `${YELLOW}running${RESET}`
          : `${RED}${exec.status}${RESET}`;

    rows.push([
      String(exec.id),
      String(exec.cron_job_id),
      status,
      exec.started_at
        ? new Date(exec.started_at).toLocaleString()
        : "—",
      exec.duration_ms ? `${(exec.duration_ms / 1000).toFixed(1)}s` : "—",
      exec.input_tokens || exec.output_tokens
        ? `${(exec.input_tokens || 0) + (exec.output_tokens || 0)}`
        : "—",
      exec.error ? exec.error.slice(0, 40) : "",
    ]);
  }

  table(rows);
  console.log(`\n${DIM}Showing ${executions.length} execution(s)${RESET}\n`);
}

function printUsage(): void {
  heading("OVERSEER CLI");
  console.log(`
${BOLD}Usage:${RESET}
  overseer <command> [options]

${BOLD}Commands:${RESET}
  ${CYAN}status${RESET}                      Show system status
  
  ${CYAN}agent run${RESET} <prompt>           Run agent with a prompt
  ${CYAN}agent interactive${RESET}            Start interactive agent session
  
  ${CYAN}cron list${RESET}                    List all cron jobs
  ${CYAN}cron add${RESET}                     Add a new cron job (interactive)
  ${CYAN}cron remove${RESET} <id>             Remove a cron job
  ${CYAN}cron enable${RESET} <id>             Enable a cron job
  ${CYAN}cron disable${RESET} <id>            Disable a cron job
  ${CYAN}cron run${RESET} <id>                Run a cron job immediately
  ${CYAN}cron history${RESET} [id]            Show execution history

${BOLD}Examples:${RESET}
  overseer status
  overseer agent run "Check disk space and report"
  overseer cron add
  overseer cron list
  overseer cron run 1
`);
}

// =====================================================
// Main
// =====================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printUsage();
    process.exit(0);
  }

  const command = args[0];
  const subcommand = args[1];

  try {
    switch (command) {
      case "status":
        await cmdStatus();
        break;

      case "agent":
        switch (subcommand) {
          case "run":
            if (!args[2]) {
              error("Missing prompt. Usage: overseer agent run <prompt>");
              process.exit(1);
            }
            await cmdAgentRun(args.slice(2).join(" "));
            break;
          case "interactive":
          case "chat":
            await cmdAgentInteractive();
            break;
          default:
            error(`Unknown agent subcommand: "${subcommand}"`);
            info("Available: run, interactive");
            process.exit(1);
        }
        break;

      case "cron":
        switch (subcommand) {
          case "list":
          case "ls":
            await cmdCronList();
            break;
          case "add":
          case "create":
            await cmdCronAdd();
            break;
          case "remove":
          case "delete":
          case "rm":
            if (!args[2]) {
              error("Missing job ID. Usage: overseer cron remove <id>");
              process.exit(1);
            }
            await cmdCronRemove(args[2]);
            break;
          case "enable":
            if (!args[2]) {
              error("Missing job ID. Usage: overseer cron enable <id>");
              process.exit(1);
            }
            await cmdCronToggle(args[2], true);
            break;
          case "disable":
            if (!args[2]) {
              error("Missing job ID. Usage: overseer cron disable <id>");
              process.exit(1);
            }
            await cmdCronToggle(args[2], false);
            break;
          case "run":
            if (!args[2]) {
              error("Missing job ID. Usage: overseer cron run <id>");
              process.exit(1);
            }
            await cmdCronRun(args[2]);
            break;
          case "history":
          case "log":
            await cmdCronHistory(args[2]);
            break;
          default:
            error(`Unknown cron subcommand: "${subcommand}"`);
            info("Available: list, add, remove, enable, disable, run, history");
            process.exit(1);
        }
        break;

      default:
        error(`Unknown command: "${command}"`);
        printUsage();
        process.exit(1);
    }
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
