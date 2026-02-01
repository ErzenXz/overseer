/**
 * Platform-specific command tools for cross-platform compatibility
 * Provides unified interface for common system operations across Windows, Linux, and macOS
 */

import { tool } from "ai";
import { z } from "zod";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import { toolExecutionsModel } from "../../database/index";
import { createLogger } from "../../lib/logger";
import {
  getPlatform,
  isWindows,
  isUnix,
  getShellArgs,
  getPlatformEnv,
  getServiceManager,
} from "../../lib/platform";

const execAsync = promisify(exec);
const logger = createLogger("tools:platform-commands");

const DEFAULT_TIMEOUT = 15000;

/**
 * Execute a platform-specific command
 */
async function execPlatformCommand(
  unixCommand: string,
  windowsCommand: string,
  timeout = DEFAULT_TIMEOUT
): Promise<{ stdout: string; stderr: string }> {
  if (isWindows()) {
    const { shell, args } = getShellArgs(windowsCommand);

    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";

      const child = spawn(shell, args, {
        env: getPlatformEnv(),
        timeout,
      });

      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("error", reject);

      child.on("close", (code) => {
        resolve({ stdout, stderr });
      });

      setTimeout(() => {
        child.kill();
        reject(new Error("Command timed out"));
      }, timeout);
    });
  }

  return execAsync(unixCommand, {
    timeout,
    env: getPlatformEnv(),
    shell: process.env.SHELL || "/bin/bash",
  });
}

export const listProcesses = tool({
  description: `List running processes on the system.
Platform support:
- Windows: Uses Get-Process (PowerShell)
- Linux/macOS: Uses ps aux`,
  parameters: z.object({
    filter: z.string().optional().describe("Filter by process name"),
    sortBy: z.enum(["cpu", "memory", "name", "pid"]).optional().describe("Sort by field (default: cpu)"),
    limit: z.number().optional().describe("Maximum number of processes to show (default: 25)"),
  }),
  execute: async ({ filter, sortBy = "cpu", limit = 25 }) => {
    try {
      let unixCommand: string;
      let windowsCommand: string;

      // Build Unix command
      const unixSortFlag = sortBy === "memory" ? "-m" : sortBy === "pid" ? "-p" : "-r";
      if (filter) {
        unixCommand = `ps aux | grep -i "${filter}" | grep -v grep | head -n ${limit}`;
      } else {
        unixCommand = `ps aux ${unixSortFlag} | head -n ${limit + 1}`;
      }

      // Build Windows command
      let windowsSortProperty = "CPU";
      if (sortBy === "memory") windowsSortProperty = "WorkingSet64";
      if (sortBy === "name") windowsSortProperty = "ProcessName";
      if (sortBy === "pid") windowsSortProperty = "Id";

      if (filter) {
        windowsCommand = `Get-Process | Where-Object { $_.ProcessName -like '*${filter}*' } | Sort-Object ${windowsSortProperty} -Descending | Select-Object -First ${limit} | Format-Table Id, ProcessName, @{N='CPU(s)';E={[math]::Round($_.CPU,2)}}, @{N='MemoryMB';E={[math]::Round($_.WorkingSet64/1MB,2)}} -AutoSize | Out-String`;
      } else {
        windowsCommand = `Get-Process | Sort-Object ${windowsSortProperty} -Descending | Select-Object -First ${limit} | Format-Table Id, ProcessName, @{N='CPU(s)';E={[math]::Round($_.CPU,2)}}, @{N='MemoryMB';E={[math]::Round($_.WorkingSet64/1MB,2)}} -AutoSize | Out-String`;
      }

      const { stdout, stderr } = await execPlatformCommand(unixCommand, windowsCommand);

      toolExecutionsModel.create({
        tool_name: "listProcesses",
        input: { filter, sortBy, limit },
        output: stdout.substring(0, 2000),
        success: true,
      });

      return {
        success: true,
        output: stdout.trim(),
        platform: getPlatform(),
        command: isWindows() ? "Get-Process" : "ps aux",
      };
    } catch (error: unknown) {
      const err = error as { message?: string };
      return {
        success: false,
        error: err.message || String(error),
        platform: getPlatform(),
      };
    }
  },
});

export const killProcessByPidOrName = tool({
  description: `Kill a process by PID or name.
Platform support:
- Windows: Uses Stop-Process (PowerShell)
- Linux/macOS: Uses kill or killall`,
  parameters: z.object({
    pid: z.number().optional().describe("Process ID to kill"),
    name: z.string().optional().describe("Process name to kill (kills all matching)"),
    force: z.boolean().optional().describe("Force kill (default: false)"),
    confirmed: z.boolean().describe("Confirm killing the process(es)"),
  }),
  execute: async ({ pid, name, force = false, confirmed }) => {
    if (!pid && !name) {
      return {
        success: false,
        error: "Either pid or name must be provided",
      };
    }

    if (!confirmed) {
      const target = pid ? `PID ${pid}` : `processes named "${name}"`;
      return {
        success: false,
        error: `⚠️ Killing ${target} not confirmed. Set confirmed: true to proceed.`,
        requiresConfirmation: true,
      };
    }

    try {
      let unixCommand: string;
      let windowsCommand: string;

      if (pid) {
        unixCommand = force ? `kill -9 ${pid}` : `kill ${pid}`;
        windowsCommand = force
          ? `Stop-Process -Id ${pid} -Force -ErrorAction Stop`
          : `Stop-Process -Id ${pid} -ErrorAction Stop`;
      } else {
        unixCommand = force ? `killall -9 "${name}"` : `killall "${name}"`;
        windowsCommand = force
          ? `Get-Process -Name '*${name}*' | Stop-Process -Force -ErrorAction Stop`
          : `Get-Process -Name '*${name}*' | Stop-Process -ErrorAction Stop`;
      }

      await execPlatformCommand(unixCommand, windowsCommand, 10000);

      const target = pid ? `Process ${pid}` : `Processes matching "${name}"`;
      
      toolExecutionsModel.create({
        tool_name: "killProcessByPidOrName",
        input: { pid, name, force },
        output: `${target} killed`,
        success: true,
      });

      return {
        success: true,
        message: `${target} killed${force ? " (forced)" : ""}`,
        platform: getPlatform(),
      };
    } catch (error: unknown) {
      const err = error as { message?: string };
      return {
        success: false,
        error: err.message || String(error),
        platform: getPlatform(),
      };
    }
  },
});

export const listServices = tool({
  description: `List system services.
Platform support:
- Windows: Uses Get-Service (PowerShell)
- Linux: Uses systemctl
- macOS: Uses launchctl`,
  parameters: z.object({
    filter: z.string().optional().describe("Filter by service name"),
    status: z.enum(["all", "running", "stopped"]).optional().describe("Filter by status (default: all)"),
    limit: z.number().optional().describe("Maximum number of services to show (default: 50)"),
  }),
  execute: async ({ filter, status = "all", limit = 50 }) => {
    try {
      const serviceManager = getServiceManager();
      let unixCommand: string;
      let windowsCommand: string;

      // Windows command
      let windowsFilter = "";
      if (filter) {
        windowsFilter = ` | Where-Object { $_.DisplayName -like '*${filter}*' -or $_.Name -like '*${filter}*' }`;
      }
      if (status === "running") {
        windowsFilter += " | Where-Object { $_.Status -eq 'Running' }";
      } else if (status === "stopped") {
        windowsFilter += " | Where-Object { $_.Status -eq 'Stopped' }";
      }
      windowsCommand = `Get-Service${windowsFilter} | Select-Object -First ${limit} | Format-Table Name, DisplayName, Status, StartType -AutoSize | Out-String`;

      // Unix command
      if (serviceManager === "systemd") {
        let stateFilter = "";
        if (status === "running") stateFilter = "--state=running";
        if (status === "stopped") stateFilter = "--state=inactive";
        
        if (filter) {
          unixCommand = `systemctl list-units --type=service ${stateFilter} --no-pager | grep -i "${filter}" | head -n ${limit}`;
        } else {
          unixCommand = `systemctl list-units --type=service ${stateFilter} --no-pager | head -n ${limit}`;
        }
      } else if (serviceManager === "launchctl") {
        // macOS launchctl
        if (filter) {
          unixCommand = `launchctl list | grep -i "${filter}" | head -n ${limit}`;
        } else {
          unixCommand = `launchctl list | head -n ${limit}`;
        }
      } else {
        // Generic init system
        unixCommand = filter
          ? `service --status-all 2>/dev/null | grep -i "${filter}" | head -n ${limit}`
          : `service --status-all 2>/dev/null | head -n ${limit}`;
      }

      const { stdout, stderr } = await execPlatformCommand(unixCommand, windowsCommand, 20000);

      return {
        success: true,
        output: stdout.trim() || stderr.trim(),
        platform: getPlatform(),
        serviceManager: isWindows() ? "sc/Get-Service" : serviceManager,
      };
    } catch (error: unknown) {
      const err = error as { message?: string };
      return {
        success: false,
        error: err.message || String(error),
        platform: getPlatform(),
      };
    }
  },
});

export const manageService = tool({
  description: `Start, stop, or restart a system service.
Platform support:
- Windows: Uses Start-Service/Stop-Service/Restart-Service
- Linux: Uses systemctl
- macOS: Uses launchctl`,
  parameters: z.object({
    name: z.string().describe("Service name"),
    action: z.enum(["start", "stop", "restart", "status"]).describe("Action to perform"),
    confirmed: z.boolean().optional().describe("Confirm the action (required for start/stop/restart)"),
  }),
  execute: async ({ name, action, confirmed }) => {
    if (action !== "status" && !confirmed) {
      return {
        success: false,
        error: `⚠️ ${action} service "${name}" not confirmed. Set confirmed: true to proceed.`,
        requiresConfirmation: true,
      };
    }

    try {
      const serviceManager = getServiceManager();
      let unixCommand: string;
      let windowsCommand: string;

      switch (action) {
        case "status":
          if (serviceManager === "systemd") {
            unixCommand = `systemctl status ${name} --no-pager`;
          } else if (serviceManager === "launchctl") {
            unixCommand = `launchctl list | grep ${name}`;
          } else {
            unixCommand = `service ${name} status`;
          }
          windowsCommand = `Get-Service -Name '${name}' | Format-List Name, DisplayName, Status, StartType | Out-String`;
          break;

        case "start":
          if (serviceManager === "systemd") {
            unixCommand = `sudo systemctl start ${name} && systemctl status ${name} --no-pager`;
          } else if (serviceManager === "launchctl") {
            unixCommand = `sudo launchctl start ${name}`;
          } else {
            unixCommand = `sudo service ${name} start`;
          }
          windowsCommand = `Start-Service -Name '${name}' -PassThru | Format-List Name, Status | Out-String`;
          break;

        case "stop":
          if (serviceManager === "systemd") {
            unixCommand = `sudo systemctl stop ${name} && systemctl status ${name} --no-pager`;
          } else if (serviceManager === "launchctl") {
            unixCommand = `sudo launchctl stop ${name}`;
          } else {
            unixCommand = `sudo service ${name} stop`;
          }
          windowsCommand = `Stop-Service -Name '${name}' -PassThru | Format-List Name, Status | Out-String`;
          break;

        case "restart":
          if (serviceManager === "systemd") {
            unixCommand = `sudo systemctl restart ${name} && systemctl status ${name} --no-pager`;
          } else if (serviceManager === "launchctl") {
            unixCommand = `sudo launchctl stop ${name} && sudo launchctl start ${name}`;
          } else {
            unixCommand = `sudo service ${name} restart`;
          }
          windowsCommand = `Restart-Service -Name '${name}' -PassThru | Format-List Name, Status | Out-String`;
          break;
      }

      const { stdout, stderr } = await execPlatformCommand(unixCommand!, windowsCommand!, 20000);

      toolExecutionsModel.create({
        tool_name: "manageService",
        input: { name, action },
        output: stdout.substring(0, 1000),
        success: true,
      });

      return {
        success: true,
        service: name,
        action,
        output: stdout.trim() || stderr.trim(),
        platform: getPlatform(),
        serviceManager: isWindows() ? "sc" : serviceManager,
      };
    } catch (error: unknown) {
      const err = error as { message?: string; stderr?: string };
      return {
        success: false,
        error: err.message || String(error),
        details: err.stderr,
        platform: getPlatform(),
      };
    }
  },
});

export const networkInfo = tool({
  description: `Get network configuration information.
Platform support:
- Windows: Uses Get-NetIPAddress, Get-NetAdapter, etc.
- Linux: Uses ip, ss, netstat
- macOS: Uses ifconfig, netstat`,
  parameters: z.object({
    type: z.enum(["interfaces", "routes", "connections", "dns"]).describe("Type of network info"),
  }),
  execute: async ({ type }) => {
    try {
      let unixCommand: string;
      let windowsCommand: string;

      switch (type) {
        case "interfaces":
          unixCommand = process.platform === "darwin"
            ? "ifconfig"
            : "ip -c addr show";
          windowsCommand = `Get-NetIPAddress | Where-Object { $_.AddressFamily -eq 'IPv4' } | Format-Table InterfaceAlias, IPAddress, PrefixLength -AutoSize | Out-String`;
          break;

        case "routes":
          unixCommand = process.platform === "darwin"
            ? "netstat -rn"
            : "ip route show";
          windowsCommand = "Get-NetRoute | Format-Table DestinationPrefix, NextHop, InterfaceAlias -AutoSize | Out-String";
          break;

        case "connections":
          unixCommand = process.platform === "darwin"
            ? "netstat -an | head -50"
            : "ss -tuln | head -50";
          windowsCommand = "Get-NetTCPConnection | Select-Object -First 50 | Format-Table LocalAddress, LocalPort, RemoteAddress, RemotePort, State -AutoSize | Out-String";
          break;

        case "dns":
          unixCommand = "cat /etc/resolv.conf";
          windowsCommand = "Get-DnsClientServerAddress | Where-Object { $_.ServerAddresses } | Format-Table InterfaceAlias, ServerAddresses -AutoSize | Out-String";
          break;
      }

      const { stdout, stderr } = await execPlatformCommand(unixCommand, windowsCommand);

      return {
        success: true,
        type,
        output: stdout.trim() || stderr.trim(),
        platform: getPlatform(),
      };
    } catch (error: unknown) {
      const err = error as { message?: string };
      return {
        success: false,
        error: err.message || String(error),
        platform: getPlatform(),
      };
    }
  },
});

export const diskUsage = tool({
  description: `Get disk usage information.
Platform support:
- Windows: Uses Get-Volume, Get-PSDrive
- Linux/macOS: Uses df`,
  parameters: z.object({
    path: z.string().optional().describe("Specific path to check (default: all drives/mounts)"),
    humanReadable: z.boolean().optional().describe("Human readable output (default: true)"),
  }),
  execute: async ({ path, humanReadable = true }) => {
    try {
      let unixCommand: string;
      let windowsCommand: string;

      if (path) {
        unixCommand = humanReadable ? `df -h "${path}"` : `df "${path}"`;
        // On Windows, extract drive letter from path
        const driveLetter = path.match(/^([A-Za-z]):/)?.[1];
        if (driveLetter) {
          windowsCommand = `Get-Volume -DriveLetter ${driveLetter} | Format-Table DriveLetter, FileSystemLabel, @{N='SizeGB';E={[math]::Round($_.Size/1GB,2)}}, @{N='FreeGB';E={[math]::Round($_.SizeRemaining/1GB,2)}}, @{N='UsedPercent';E={[math]::Round((($_.Size - $_.SizeRemaining) / $_.Size) * 100, 1)}} -AutoSize | Out-String`;
        } else {
          windowsCommand = `Get-Volume | Format-Table DriveLetter, FileSystemLabel, @{N='SizeGB';E={[math]::Round($_.Size/1GB,2)}}, @{N='FreeGB';E={[math]::Round($_.SizeRemaining/1GB,2)}} -AutoSize | Out-String`;
        }
      } else {
        unixCommand = humanReadable ? "df -h" : "df";
        windowsCommand = `Get-Volume | Where-Object { $_.DriveLetter } | Format-Table DriveLetter, FileSystemLabel, @{N='SizeGB';E={[math]::Round($_.Size/1GB,2)}}, @{N='FreeGB';E={[math]::Round($_.SizeRemaining/1GB,2)}}, @{N='UsedPercent';E={[math]::Round((($_.Size - $_.SizeRemaining) / $_.Size) * 100, 1)}} -AutoSize | Out-String`;
      }

      const { stdout, stderr } = await execPlatformCommand(unixCommand, windowsCommand);

      return {
        success: true,
        output: stdout.trim() || stderr.trim(),
        platform: getPlatform(),
      };
    } catch (error: unknown) {
      const err = error as { message?: string };
      return {
        success: false,
        error: err.message || String(error),
        platform: getPlatform(),
      };
    }
  },
});

export const memoryUsage = tool({
  description: `Get memory usage information.
Platform support:
- Windows: Uses Get-CimInstance Win32_OperatingSystem
- Linux: Uses free
- macOS: Uses vm_stat`,
  parameters: z.object({
    detailed: z.boolean().optional().describe("Show detailed breakdown (default: false)"),
  }),
  execute: async ({ detailed = false }) => {
    try {
      let unixCommand: string;
      let windowsCommand: string;

      if (process.platform === "darwin") {
        // macOS
        unixCommand = detailed
          ? "vm_stat && echo '---' && top -l 1 -s 0 | head -10"
          : "vm_stat | head -10";
      } else {
        // Linux
        unixCommand = detailed ? "free -h && echo '---' && cat /proc/meminfo | head -20" : "free -h";
      }

      windowsCommand = detailed
        ? `$os = Get-CimInstance Win32_OperatingSystem; [PSCustomObject]@{TotalMemoryGB = [math]::Round($os.TotalVisibleMemorySize/1MB, 2); FreeMemoryGB = [math]::Round($os.FreePhysicalMemory/1MB, 2); UsedMemoryGB = [math]::Round(($os.TotalVisibleMemorySize - $os.FreePhysicalMemory)/1MB, 2); UsedPercent = [math]::Round((1 - $os.FreePhysicalMemory/$os.TotalVisibleMemorySize) * 100, 1)} | Format-List | Out-String`
        : `$os = Get-CimInstance Win32_OperatingSystem; "Total: $([math]::Round($os.TotalVisibleMemorySize/1MB, 2)) GB | Free: $([math]::Round($os.FreePhysicalMemory/1MB, 2)) GB | Used: $([math]::Round((1 - $os.FreePhysicalMemory/$os.TotalVisibleMemorySize) * 100, 1))%"`;

      const { stdout, stderr } = await execPlatformCommand(unixCommand, windowsCommand);

      return {
        success: true,
        output: stdout.trim() || stderr.trim(),
        platform: getPlatform(),
      };
    } catch (error: unknown) {
      const err = error as { message?: string };
      return {
        success: false,
        error: err.message || String(error),
        platform: getPlatform(),
      };
    }
  },
});

export const cpuInfo = tool({
  description: `Get CPU information and usage.
Platform support:
- Windows: Uses Get-CimInstance, Get-Counter
- Linux: Uses /proc/cpuinfo, top
- macOS: Uses sysctl, top`,
  parameters: z.object({
    includeUsage: z.boolean().optional().describe("Include current CPU usage (default: true)"),
  }),
  execute: async ({ includeUsage = true }) => {
    try {
      let unixCommand: string;
      let windowsCommand: string;

      if (process.platform === "darwin") {
        // macOS
        unixCommand = includeUsage
          ? "sysctl -n machdep.cpu.brand_string && echo '---' && top -l 1 -s 0 | grep 'CPU usage'"
          : "sysctl -n machdep.cpu.brand_string && sysctl -n hw.ncpu";
      } else {
        // Linux
        unixCommand = includeUsage
          ? "cat /proc/cpuinfo | grep 'model name' | head -1 && echo '---' && top -bn1 | head -5"
          : "cat /proc/cpuinfo | grep 'model name' | head -1 && nproc";
      }

      windowsCommand = includeUsage
        ? `$cpu = Get-CimInstance Win32_Processor; [PSCustomObject]@{Name = $cpu.Name; Cores = $cpu.NumberOfCores; Threads = $cpu.NumberOfLogicalProcessors; CurrentSpeed = "$($cpu.CurrentClockSpeed) MHz"; LoadPercent = "$($cpu.LoadPercentage)%"} | Format-List | Out-String`
        : `Get-CimInstance Win32_Processor | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors | Format-List | Out-String`;

      const { stdout, stderr } = await execPlatformCommand(unixCommand, windowsCommand);

      return {
        success: true,
        output: stdout.trim() || stderr.trim(),
        platform: getPlatform(),
      };
    } catch (error: unknown) {
      const err = error as { message?: string };
      return {
        success: false,
        error: err.message || String(error),
        platform: getPlatform(),
      };
    }
  },
});

export const findFiles = tool({
  description: `Find files matching a pattern.
Platform support:
- Windows: Uses Get-ChildItem
- Linux/macOS: Uses find`,
  parameters: z.object({
    path: z.string().describe("Starting directory path"),
    pattern: z.string().describe("File pattern to match (e.g., '*.txt', 'config*')"),
    maxDepth: z.number().optional().describe("Maximum directory depth (default: 5)"),
    type: z.enum(["file", "directory", "all"]).optional().describe("Type to find (default: file)"),
  }),
  execute: async ({ path, pattern, maxDepth = 5, type = "file" }) => {
    try {
      let unixCommand: string;
      let windowsCommand: string;

      // Unix command
      let typeFlag = "";
      if (type === "file") typeFlag = "-type f";
      if (type === "directory") typeFlag = "-type d";
      
      unixCommand = `find "${path}" -maxdepth ${maxDepth} ${typeFlag} -name "${pattern}" 2>/dev/null | head -100`;

      // Windows command
      let windowsTypeFilter = "";
      if (type === "file") windowsTypeFilter = " | Where-Object { !$_.PSIsContainer }";
      if (type === "directory") windowsTypeFilter = " | Where-Object { $_.PSIsContainer }";
      
      windowsCommand = `Get-ChildItem -Path '${path}' -Recurse -Depth ${maxDepth} -Filter '${pattern}' -ErrorAction SilentlyContinue${windowsTypeFilter} | Select-Object -First 100 | Format-Table FullName, Length, LastWriteTime -AutoSize | Out-String`;

      const { stdout, stderr } = await execPlatformCommand(unixCommand, windowsCommand, 30000);

      return {
        success: true,
        output: stdout.trim() || stderr.trim() || "(no matches found)",
        platform: getPlatform(),
      };
    } catch (error: unknown) {
      const err = error as { message?: string };
      return {
        success: false,
        error: err.message || String(error),
        platform: getPlatform(),
      };
    }
  },
});

export const searchInFiles = tool({
  description: `Search for text within files.
Platform support:
- Windows: Uses Select-String (PowerShell grep equivalent)
- Linux/macOS: Uses grep`,
  parameters: z.object({
    path: z.string().describe("Directory to search in"),
    pattern: z.string().describe("Text pattern to search for (regex supported)"),
    filePattern: z.string().optional().describe("File pattern to search in (e.g., '*.js', default: '*')"),
    ignoreCase: z.boolean().optional().describe("Case insensitive search (default: false)"),
    maxResults: z.number().optional().describe("Maximum number of results (default: 50)"),
  }),
  execute: async ({ path, pattern, filePattern = "*", ignoreCase = false, maxResults = 50 }) => {
    try {
      let unixCommand: string;
      let windowsCommand: string;

      const caseFlag = ignoreCase ? "-i" : "";
      unixCommand = `grep -r ${caseFlag} -n "${pattern}" --include="${filePattern}" "${path}" 2>/dev/null | head -n ${maxResults}`;

      const windowsCaseFlag = ignoreCase ? "" : "-CaseSensitive";
      windowsCommand = `Get-ChildItem -Path '${path}' -Recurse -Filter '${filePattern}' -ErrorAction SilentlyContinue | Select-String -Pattern '${pattern}' ${windowsCaseFlag} | Select-Object -First ${maxResults} | Format-Table Path, LineNumber, Line -AutoSize -Wrap | Out-String`;

      const { stdout, stderr } = await execPlatformCommand(unixCommand, windowsCommand, 30000);

      return {
        success: true,
        output: stdout.trim() || stderr.trim() || "(no matches found)",
        platform: getPlatform(),
        command: isWindows() ? "Select-String" : "grep",
      };
    } catch (error: unknown) {
      const err = error as { message?: string };
      return {
        success: false,
        error: err.message || String(error),
        platform: getPlatform(),
      };
    }
  },
});
