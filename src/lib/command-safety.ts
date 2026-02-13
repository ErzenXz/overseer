export type CommandRisk = "allow" | "confirm" | "deny";

export interface CommandSafetyResult {
  risk: CommandRisk;
  reasons: string[];
}

function anyMatch(patterns: RegExp[], input: string): RegExp | null {
  for (const p of patterns) {
    if (p.test(input)) return p;
  }
  return null;
}

// "Deny" means we will not run the command even with confirmation.
const UNIX_DENY_PATTERNS: RegExp[] = [
  /\b:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:\b/, // fork bomb
  /\brm\b.*\b--no-preserve-root\b/i,
  /\brm\b.*\b--preserve-root\s*=\s*false\b/i,
  /\brm\b.*\s-[^\n]*\brf\b[^\n]*\s+\/(\s|$)/i, // rm ... -rf ... /
  /\brm\b.*\s-[^\n]*\brf\b[^\n]*\s+\/\*/i, // rm ... -rf ... /*
  /\bsudo\s+rm\b[^\n]*\s-[^\n]*\brf\b/i, // user explicitly called out "sudo rm -rf" as unacceptable
  /\bmkfs(\.|\\s)/i,
  /\bwipefs\b/i,
  /\bsgdisk\b.*\b--zap-all\b/i,
  /\bdd\b.*\bof=\/dev\/(sd[a-z]+|xvd[a-z]+|vd[a-z]+|nvme\\d+n\\d+|mmcblk\\d+)\b/i,
  /\b(?:pv|vg|lv)remove\b/i,
];

// "Confirm" means we block in the safe shell tool, but allow via the confirmed tool.
const UNIX_CONFIRM_PATTERNS: RegExp[] = [
  /\bsudo\s+rm\b/i,
  /\brm\s+-[^\n]*\br\b/i,
  /\brm\s+-[^\n]*\bf\b/i,
  /\brmdir\b/i,
  /\bchmod\s+-R\b/i,
  /\bchown\s+-R\b/i,
  /\bkill\s+-9\b/i,
  /\bkillall\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bsystemctl\s+(stop|disable|mask)\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-f\b/i,
  /\bdocker\s+system\s+prune\b/i,
  /\bkubectl\s+delete\b/i,
  />\s*\/(etc|bin|sbin|usr|var|boot|dev|proc|sys)\b/i, // redirect into system paths
];

const SQL_CONFIRM_PATTERNS: RegExp[] = [
  /\bdrop\s+database\b/i,
  /\bdrop\s+table\b/i,
  /\btruncate\s+table\b/i,
  /\bdelete\s+from\b/i,
  /\bupdate\s+.+\s+set\s+.+\s+where\b/i,
];

const WINDOWS_DENY_PATTERNS: RegExp[] = [
  /format\s+[a-z]:/i,
  /diskpart/i,
  /bcdedit/i,
  /reg\s+delete/i,
  /Remove-Item\s+.*\\bC:\\\\Windows\\b/i,
  /Remove-Item\s+.*-Recurse.*C:\\\\/i,
];

const WINDOWS_CONFIRM_PATTERNS: RegExp[] = [
  /Remove-Item\s+.*-Recurse/i,
  /Remove-Item\s+.*-Force/i,
  /del\s+\/[sS]/i,
  /rd\s+\/[sS]/i,
  /rmdir\s+\/[sS]/i,
  /Stop-Process\s+.*-Force/i,
  /Stop-Service/i,
  /Disable-Service/i,
  /shutdown/i,
  /Restart-Computer/i,
  /Stop-Computer/i,
];

export function classifyCommandSafety(
  command: string,
  platform: string,
): CommandSafetyResult {
  const trimmed = command.trim();
  const reasons: string[] = [];

  // SQL commands can be embedded in shell invocations; treat as confirm.
  if (anyMatch(SQL_CONFIRM_PATTERNS, trimmed)) {
    reasons.push("SQL data-destructive pattern detected");
    return { risk: "confirm", reasons };
  }

  const isWindows = platform === "win32";

  if (isWindows) {
    const deny = anyMatch(WINDOWS_DENY_PATTERNS, trimmed);
    if (deny) {
      reasons.push(`Blocked high-risk Windows pattern: ${deny}`);
      return { risk: "deny", reasons };
    }

    const confirm = anyMatch(WINDOWS_CONFIRM_PATTERNS, trimmed);
    if (confirm) {
      reasons.push(`Requires confirmation (Windows): ${confirm}`);
      return { risk: "confirm", reasons };
    }

    return { risk: "allow", reasons: [] };
  }

  const deny = anyMatch(UNIX_DENY_PATTERNS, trimmed);
  if (deny) {
    reasons.push(`Blocked high-risk Unix pattern: ${deny}`);
    return { risk: "deny", reasons };
  }

  const confirm = anyMatch(UNIX_CONFIRM_PATTERNS, trimmed);
  if (confirm) {
    reasons.push(`Requires confirmation (Unix): ${confirm}`);
    return { risk: "confirm", reasons };
  }

  return { risk: "allow", reasons: [] };
}
