import {
  executeShellCommand,
  executeShellCommandConfirmed,
  getShellInfo,
} from "./shell";
import { readFile, writeFile, listDirectory } from "./files";
import {
  createCronJob,
  listCronJobs,
  deleteCronJob,
  toggleCronJob,
  runCronJobNow,
} from "./cron";
import { searchCodebase } from "./search";

/**
 * Built-in tools that do NOT depend on sub-agent tooling.
 * Keep this file free of imports from ./subagent-tool to avoid circular deps.
 */
export const builtinTools = {
  // Shell
  executeShellCommand,
  executeShellCommandConfirmed,
  getShellInfo,

  // Files
  readFile,
  writeFile,
  listDirectory,

  // Cron
  createCronJob,
  listCronJobs,
  deleteCronJob,
  toggleCronJob,
  runCronJobNow,

  // Search
  searchCodebase,
};

export type BuiltinToolName = keyof typeof builtinTools;

