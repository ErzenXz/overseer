/**
 * Cross-platform utilities for MyBot
 * Provides platform detection and command mapping for Windows, Linux, and macOS
 */

import os from "os";
import path from "path";

export type Platform = "windows" | "linux" | "macos";

/**
 * Get the current platform
 */
export function getPlatform(): Platform {
  switch (process.platform) {
    case "win32":
      return "windows";
    case "darwin":
      return "macos";
    default:
      return "linux";
  }
}

/**
 * Check if running on Windows
 */
export function isWindows(): boolean {
  return process.platform === "win32";
}

/**
 * Check if running on macOS
 */
export function isMacOS(): boolean {
  return process.platform === "darwin";
}

/**
 * Check if running on Linux
 */
export function isLinux(): boolean {
  return process.platform === "linux";
}

/**
 * Check if running on Unix-like system (Linux or macOS)
 */
export function isUnix(): boolean {
  return isLinux() || isMacOS();
}

/**
 * Get the default shell for the current platform
 */
export function getShell(): string {
  if (isWindows()) {
    // Prefer PowerShell on Windows
    return process.env.COMSPEC || "powershell.exe";
  }

  // Unix-like systems
  return process.env.SHELL || "/bin/bash";
}

/**
 * Get shell execution arguments for the platform
 */
export function getShellArgs(command: string): { shell: string; args: string[] } {
  if (isWindows()) {
    // Check if we should use PowerShell or cmd
    const usePowerShell = !process.env.USE_CMD;
    if (usePowerShell) {
      return {
        shell: "powershell.exe",
        args: ["-NoProfile", "-NonInteractive", "-Command", command],
      };
    }
    return {
      shell: process.env.COMSPEC || "cmd.exe",
      args: ["/c", command],
    };
  }

  // Unix-like systems
  const shell = getShell();
  return {
    shell,
    args: ["-c", command],
  };
}

/**
 * Get the home directory for the current platform
 */
export function getHomeDir(): string {
  return os.homedir();
}

/**
 * Get the temp directory for the current platform
 */
export function getTempDir(): string {
  return os.tmpdir();
}

/**
 * Get the data directory for the application
 * Windows: %APPDATA%\mybot
 * macOS: ~/Library/Application Support/mybot
 * Linux: ~/.local/share/mybot or $XDG_DATA_HOME/mybot
 */
export function getDataDir(): string {
  const appName = "mybot";

  if (isWindows()) {
    return path.join(process.env.APPDATA || path.join(getHomeDir(), "AppData", "Roaming"), appName);
  }

  if (isMacOS()) {
    return path.join(getHomeDir(), "Library", "Application Support", appName);
  }

  // Linux - follow XDG Base Directory spec
  const xdgDataHome = process.env.XDG_DATA_HOME || path.join(getHomeDir(), ".local", "share");
  return path.join(xdgDataHome, appName);
}

/**
 * Normalize a file path for the current platform
 * Converts forward slashes to backslashes on Windows
 */
export function normalizePath(filePath: string): string {
  if (!filePath) return filePath;

  // Convert to native path separators
  let normalized = path.normalize(filePath);

  // Handle Windows drive letters
  if (isWindows()) {
    // Convert forward slashes to backslashes
    normalized = normalized.replace(/\//g, "\\");

    // Ensure drive letter is uppercase
    if (/^[a-z]:/.test(normalized)) {
      normalized = normalized[0].toUpperCase() + normalized.slice(1);
    }
  }

  return normalized;
}

/**
 * Convert a path to POSIX style (forward slashes)
 * Useful for display or cross-platform storage
 */
export function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

/**
 * Get the path separator for the current platform
 */
export function getPathSeparator(): string {
  return path.sep;
}

/**
 * Get the path delimiter for the current platform (: on Unix, ; on Windows)
 */
export function getPathDelimiter(): string {
  return path.delimiter;
}

/**
 * Get the appropriate package manager for the current platform
 */
export function getPackageManager(): string {
  if (isWindows()) {
    // Check for common Windows package managers
    if (process.env.SCOOP) return "scoop";
    if (process.env.CHOCOLATEYINSTALL) return "choco";
    return "winget"; // Default to winget on modern Windows
  }

  if (isMacOS()) {
    return "brew";
  }

  // Linux - try to detect the package manager
  const fs = require("fs");
  if (fs.existsSync("/usr/bin/apt")) return "apt";
  if (fs.existsSync("/usr/bin/dnf")) return "dnf";
  if (fs.existsSync("/usr/bin/yum")) return "yum";
  if (fs.existsSync("/usr/bin/pacman")) return "pacman";
  if (fs.existsSync("/usr/bin/zypper")) return "zypper";
  if (fs.existsSync("/usr/bin/apk")) return "apk";

  return "apt"; // Default to apt
}

/**
 * Get the service manager for the current platform
 */
export function getServiceManager(): "systemd" | "launchctl" | "sc" | "init" {
  if (isWindows()) {
    return "sc";
  }

  if (isMacOS()) {
    return "launchctl";
  }

  // Linux - check for systemd
  const fs = require("fs");
  if (fs.existsSync("/run/systemd/system") || fs.existsSync("/usr/bin/systemctl")) {
    return "systemd";
  }

  return "init";
}

/**
 * Command mapping between platforms
 */
interface CommandMapping {
  unix: string;
  windows: string;
  description: string;
}

const COMMAND_MAPPINGS: Record<string, CommandMapping> = {
  // Process management
  ps: {
    unix: "ps aux",
    windows: "Get-Process | Format-Table -AutoSize",
    description: "List running processes",
  },
  "ps aux": {
    unix: "ps aux",
    windows: "Get-Process | Format-Table Id, ProcessName, CPU, WorkingSet64 -AutoSize",
    description: "List all processes with details",
  },
  top: {
    unix: "top -b -n 1 | head -20",
    windows: "Get-Process | Sort-Object CPU -Descending | Select-Object -First 20 | Format-Table -AutoSize",
    description: "Show top processes",
  },
  kill: {
    unix: "kill",
    windows: "Stop-Process -Id",
    description: "Kill a process by PID",
  },
  killall: {
    unix: "killall",
    windows: "Stop-Process -Name",
    description: "Kill processes by name",
  },

  // File operations
  ls: {
    unix: "ls -la",
    windows: "Get-ChildItem -Force | Format-Table -AutoSize",
    description: "List directory contents",
  },
  "ls -la": {
    unix: "ls -la",
    windows: "Get-ChildItem -Force | Format-Table Mode, LastWriteTime, Length, Name -AutoSize",
    description: "List directory with details",
  },
  cat: {
    unix: "cat",
    windows: "Get-Content",
    description: "Display file contents",
  },
  head: {
    unix: "head",
    windows: "Get-Content -Head",
    description: "Show first lines of file",
  },
  tail: {
    unix: "tail",
    windows: "Get-Content -Tail",
    description: "Show last lines of file",
  },
  touch: {
    unix: "touch",
    windows: "New-Item -ItemType File -Force",
    description: "Create empty file",
  },
  mkdir: {
    unix: "mkdir -p",
    windows: "New-Item -ItemType Directory -Force",
    description: "Create directory",
  },
  rm: {
    unix: "rm",
    windows: "Remove-Item",
    description: "Remove file",
  },
  "rm -rf": {
    unix: "rm -rf",
    windows: "Remove-Item -Recurse -Force",
    description: "Remove directory recursively",
  },
  cp: {
    unix: "cp",
    windows: "Copy-Item",
    description: "Copy file",
  },
  "cp -r": {
    unix: "cp -r",
    windows: "Copy-Item -Recurse",
    description: "Copy directory recursively",
  },
  mv: {
    unix: "mv",
    windows: "Move-Item",
    description: "Move/rename file",
  },
  find: {
    unix: "find",
    windows: "Get-ChildItem -Recurse | Where-Object",
    description: "Find files",
  },
  grep: {
    unix: "grep",
    windows: "Select-String",
    description: "Search in files",
  },
  which: {
    unix: "which",
    windows: "Get-Command",
    description: "Find command location",
  },
  chmod: {
    unix: "chmod",
    windows: "icacls",
    description: "Change file permissions",
  },
  chown: {
    unix: "chown",
    windows: "icacls",
    description: "Change file owner",
  },

  // Network
  ifconfig: {
    unix: "ip addr",
    windows: "Get-NetIPAddress | Format-Table -AutoSize",
    description: "Show network interfaces",
  },
  "ip addr": {
    unix: "ip addr",
    windows: "Get-NetIPAddress | Format-Table InterfaceAlias, IPAddress, AddressFamily -AutoSize",
    description: "Show IP addresses",
  },
  netstat: {
    unix: "netstat -an",
    windows: "Get-NetTCPConnection | Format-Table -AutoSize",
    description: "Show network connections",
  },
  "netstat -tlnp": {
    unix: "netstat -tlnp",
    windows: "Get-NetTCPConnection -State Listen | Format-Table LocalAddress, LocalPort, OwningProcess -AutoSize",
    description: "Show listening ports",
  },
  ping: {
    unix: "ping -c 4",
    windows: "Test-Connection -Count 4",
    description: "Ping host",
  },
  curl: {
    unix: "curl",
    windows: "Invoke-WebRequest",
    description: "HTTP request",
  },
  wget: {
    unix: "wget",
    windows: "Invoke-WebRequest -OutFile",
    description: "Download file",
  },
  nslookup: {
    unix: "nslookup",
    windows: "Resolve-DnsName",
    description: "DNS lookup",
  },

  // System info
  uname: {
    unix: "uname -a",
    windows: "[System.Environment]::OSVersion | Format-List",
    description: "System information",
  },
  hostname: {
    unix: "hostname",
    windows: "$env:COMPUTERNAME",
    description: "Show hostname",
  },
  uptime: {
    unix: "uptime",
    windows: "(Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime | Format-Table",
    description: "Show uptime",
  },
  whoami: {
    unix: "whoami",
    windows: "$env:USERNAME",
    description: "Current user",
  },
  df: {
    unix: "df -h",
    windows: "Get-PSDrive -PSProvider FileSystem | Format-Table Name, Used, Free -AutoSize",
    description: "Disk usage",
  },
  "df -h": {
    unix: "df -h",
    windows: "Get-Volume | Format-Table DriveLetter, SizeRemaining, Size -AutoSize",
    description: "Disk usage (human readable)",
  },
  free: {
    unix: "free -h",
    windows: "Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize, FreePhysicalMemory",
    description: "Memory usage",
  },
  du: {
    unix: "du -sh",
    windows: "(Get-ChildItem -Recurse | Measure-Object -Property Length -Sum).Sum",
    description: "Directory size",
  },

  // Services
  systemctl: {
    unix: "systemctl",
    windows: "Get-Service",
    description: "Service management",
  },
  "systemctl status": {
    unix: "systemctl status",
    windows: "Get-Service",
    description: "Service status",
  },
  "systemctl start": {
    unix: "systemctl start",
    windows: "Start-Service",
    description: "Start service",
  },
  "systemctl stop": {
    unix: "systemctl stop",
    windows: "Stop-Service",
    description: "Stop service",
  },
  "systemctl restart": {
    unix: "systemctl restart",
    windows: "Restart-Service",
    description: "Restart service",
  },
  "systemctl enable": {
    unix: "systemctl enable",
    windows: "Set-Service -StartupType Automatic",
    description: "Enable service",
  },
  "systemctl disable": {
    unix: "systemctl disable",
    windows: "Set-Service -StartupType Disabled",
    description: "Disable service",
  },

  // Package management
  "apt update": {
    unix: "apt update",
    windows: "winget upgrade",
    description: "Update package list",
  },
  "apt install": {
    unix: "apt install -y",
    windows: "winget install",
    description: "Install package",
  },

  // Environment
  env: {
    unix: "env",
    windows: "Get-ChildItem Env: | Format-Table -AutoSize",
    description: "List environment variables",
  },
  export: {
    unix: "export",
    windows: "$env:",
    description: "Set environment variable",
  },
  echo: {
    unix: "echo",
    windows: "Write-Output",
    description: "Print text",
  },

  // Other utilities
  date: {
    unix: "date",
    windows: "Get-Date",
    description: "Show date/time",
  },
  clear: {
    unix: "clear",
    windows: "Clear-Host",
    description: "Clear screen",
  },
  history: {
    unix: "history",
    windows: "Get-History",
    description: "Command history",
  },
  tar: {
    unix: "tar",
    windows: "Expand-Archive",
    description: "Archive operations",
  },
  zip: {
    unix: "zip",
    windows: "Compress-Archive",
    description: "Create zip archive",
  },
  unzip: {
    unix: "unzip",
    windows: "Expand-Archive",
    description: "Extract zip archive",
  },
};

/**
 * Map a Unix command to the Windows equivalent (or vice versa)
 */
export function mapCommand(command: string, targetPlatform?: Platform): string {
  const platform = targetPlatform || getPlatform();
  const isTargetWindows = platform === "windows";

  // Check for exact match first
  const mapping = COMMAND_MAPPINGS[command];
  if (mapping) {
    return isTargetWindows ? mapping.windows : mapping.unix;
  }

  // Check if command starts with a known pattern
  for (const [key, value] of Object.entries(COMMAND_MAPPINGS)) {
    if (command.startsWith(key + " ")) {
      const args = command.slice(key.length + 1);
      const baseCmd = isTargetWindows ? value.windows : value.unix;
      return `${baseCmd} ${args}`;
    }
  }

  // No mapping found, return original command
  return command;
}

/**
 * Get available command mappings
 */
export function getCommandMappings(): Record<string, CommandMapping> {
  return { ...COMMAND_MAPPINGS };
}

/**
 * Get platform-specific environment variables
 */
export function getPlatformEnv(): Record<string, string> {
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    TERM: isWindows() ? "dumb" : process.env.TERM || "xterm-256color",
  };

  if (isWindows()) {
    // Ensure proper Windows environment
    env.SystemRoot = process.env.SystemRoot || "C:\\Windows";
    env.PATHEXT = process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD;.VBS;.JS;.WS;.MSC";
  }

  return env;
}

/**
 * Get the null device for the current platform
 */
export function getNullDevice(): string {
  return isWindows() ? "NUL" : "/dev/null";
}

/**
 * Get the line ending for the current platform
 */
export function getLineEnding(): string {
  return isWindows() ? "\r\n" : "\n";
}

/**
 * Platform information object
 */
export interface PlatformInfo {
  platform: Platform;
  arch: string;
  release: string;
  hostname: string;
  shell: string;
  homeDir: string;
  tempDir: string;
  pathSeparator: string;
  pathDelimiter: string;
  lineEnding: string;
  packageManager: string;
  serviceManager: string;
  isWindows: boolean;
  isMacOS: boolean;
  isLinux: boolean;
  isUnix: boolean;
}

/**
 * Get comprehensive platform information
 */
export function getPlatformInfo(): PlatformInfo {
  return {
    platform: getPlatform(),
    arch: os.arch(),
    release: os.release(),
    hostname: os.hostname(),
    shell: getShell(),
    homeDir: getHomeDir(),
    tempDir: getTempDir(),
    pathSeparator: getPathSeparator(),
    pathDelimiter: getPathDelimiter(),
    lineEnding: getLineEnding(),
    packageManager: getPackageManager(),
    serviceManager: getServiceManager(),
    isWindows: isWindows(),
    isMacOS: isMacOS(),
    isLinux: isLinux(),
    isUnix: isUnix(),
  };
}

export default {
  getPlatform,
  isWindows,
  isMacOS,
  isLinux,
  isUnix,
  getShell,
  getShellArgs,
  getHomeDir,
  getTempDir,
  getDataDir,
  normalizePath,
  toPosixPath,
  getPathSeparator,
  getPathDelimiter,
  getPackageManager,
  getServiceManager,
  mapCommand,
  getCommandMappings,
  getPlatformEnv,
  getNullDevice,
  getLineEnding,
  getPlatformInfo,
};
