import { tool } from "ai";
import { z } from "zod";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import { readFileSync, existsSync } from "fs";
import { toolExecutionsModel } from "../../database/index";
import { createLogger } from "../../lib/logger";
import os from "os";
import {
  getPlatform,
  isWindows,
  isUnix,
  getShellArgs,
  getPlatformEnv,
  getServiceManager,
  getPackageManager,
  getPlatformInfo,
} from "../../lib/platform";

const execAsync = promisify(exec);
const logger = createLogger("tools:system");

/**
 * Execute a command with platform awareness
 */
async function execPlatformCommand(
  unixCommand: string,
  windowsCommand: string,
  timeout = 10000
): Promise<{ stdout: string; stderr: string }> {
  const command = isWindows() ? windowsCommand : unixCommand;
  
  if (isWindows()) {
    const { shell, args } = getShellArgs(command);
    
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

  return execAsync(command, {
    timeout,
    env: getPlatformEnv(),
  });
}

export const systemInfo = tool({
  description: `Get system information (CPU, memory, disk, OS, uptime, etc.)
Works on: Windows, Linux, macOS`,
  parameters: z.object({
    detailed: z.boolean().optional().describe("Include detailed information (default: false)"),
  }),
  execute: async ({ detailed = false }) => {
    const platform = getPlatform();
    const info: Record<string, unknown> = {
      hostname: os.hostname(),
      platform,
      platformDetails: process.platform,
      arch: os.arch(),
      release: os.release(),
      uptime: formatUptime(os.uptime()),
      uptimeSeconds: os.uptime(),
      cpus: os.cpus().length,
      cpuModel: os.cpus()[0]?.model,
      totalMemory: formatBytes(os.totalmem()),
      freeMemory: formatBytes(os.freemem()),
      usedMemory: formatBytes(os.totalmem() - os.freemem()),
      memoryUsagePercent: ((1 - os.freemem() / os.totalmem()) * 100).toFixed(1) + "%",
      loadAverage: isWindows() ? "N/A (Windows)" : os.loadavg().map((l) => l.toFixed(2)),
      homeDirectory: os.homedir(),
      tempDirectory: os.tmpdir(),
      currentUser: os.userInfo().username,
      shell: isWindows() ? "PowerShell" : process.env.SHELL || "/bin/bash",
      packageManager: getPackageManager(),
      serviceManager: getServiceManager(),
    };

    if (detailed) {
      // Get disk usage - platform specific
      try {
        if (isWindows()) {
          const { stdout } = await execPlatformCommand(
            "",
            "Get-Volume | Where-Object DriveLetter | Format-Table DriveLetter, FileSystemLabel, @{N='SizeGB';E={[math]::Round($_.Size/1GB,2)}}, @{N='FreeGB';E={[math]::Round($_.SizeRemaining/1GB,2)}} -AutoSize | Out-String"
          );
          info.diskUsage = stdout.trim();
        } else {
          const { stdout } = await execAsync("df -h /", { timeout: 5000 });
          info.diskUsage = stdout.trim();
        }
      } catch {
        info.diskUsage = "Unable to get disk usage";
      }

      // Get running processes count - platform specific
      try {
        if (isWindows()) {
          const { stdout } = await execPlatformCommand(
            "",
            "(Get-Process).Count"
          );
          info.processCount = parseInt(stdout.trim());
        } else {
          const { stdout } = await execAsync("ps aux | wc -l", { timeout: 5000 });
          info.processCount = parseInt(stdout.trim()) - 1;
        }
      } catch {
        info.processCount = "Unknown";
      }

      // Get network interfaces
      const networkInterfaces = os.networkInterfaces();
      info.networkInterfaces = Object.entries(networkInterfaces).map(([name, addrs]) => ({
        name,
        addresses: addrs?.filter((a) => !a.internal).map((a) => ({
          address: a.address,
          family: a.family,
        })),
      }));

      // Platform-specific detailed info
      if (isWindows()) {
        try {
          const { stdout } = await execPlatformCommand(
            "",
            "Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, BuildNumber | ConvertTo-Json"
          );
          const osInfo = JSON.parse(stdout);
          info.osCaption = osInfo.Caption;
          info.osBuild = osInfo.BuildNumber;
        } catch {
          // Ignore
        }
      }
    }

    toolExecutionsModel.create({
      tool_name: "systemInfo",
      input: { detailed },
      output: JSON.stringify(info).substring(0, 1000),
      success: true,
    });

    return {
      success: true,
      info,
    };
  },
});

export const processInfo = tool({
  description: `List running processes or get information about a specific process.
Works on: Windows (PowerShell), Linux, macOS`,
  parameters: z.object({
    filter: z.string().optional().describe("Filter processes by name"),
    pid: z.number().optional().describe("Get info for specific process ID"),
    sortBy: z.enum(["cpu", "memory", "pid"]).optional().describe("Sort by (default: cpu)"),
    limit: z.number().optional().describe("Number of processes to show (default: 20)"),
  }),
  execute: async ({ filter, pid, sortBy = "cpu", limit = 20 }) => {
    try {
      let command: string;

      if (isWindows()) {
        // Windows PowerShell commands
        if (pid) {
          command = `Get-Process -Id ${pid} | Format-Table Id, ProcessName, CPU, @{N='MemoryMB';E={[math]::Round($_.WorkingSet64/1MB,2)}}, StartTime -AutoSize | Out-String`;
        } else {
          let sortProperty = "CPU";
          if (sortBy === "memory") sortProperty = "WorkingSet64";
          if (sortBy === "pid") sortProperty = "Id";

          if (filter) {
            command = `Get-Process | Where-Object { $_.ProcessName -like '*${filter}*' } | Sort-Object ${sortProperty} -Descending | Select-Object -First ${limit} | Format-Table Id, ProcessName, CPU, @{N='MemoryMB';E={[math]::Round($_.WorkingSet64/1MB,2)}} -AutoSize | Out-String`;
          } else {
            command = `Get-Process | Sort-Object ${sortProperty} -Descending | Select-Object -First ${limit} | Format-Table Id, ProcessName, CPU, @{N='MemoryMB';E={[math]::Round($_.WorkingSet64/1MB,2)}} -AutoSize | Out-String`;
          }
        }

        const { stdout } = await execPlatformCommand("", command);

        toolExecutionsModel.create({
          tool_name: "processInfo",
          input: { filter, pid, sortBy, limit },
          output: stdout.substring(0, 2000),
          success: true,
        });

        return {
          success: true,
          output: stdout.trim(),
          platform: "windows",
        };
      } else {
        // Unix commands
        if (pid) {
          command = `ps -p ${pid} -o pid,ppid,user,%cpu,%mem,stat,start,time,command`;
        } else {
          const sortFlag = sortBy === "memory" ? "-m" : sortBy === "pid" ? "-p" : "-r";
          command = `ps aux ${sortFlag} | head -n ${limit + 1}`;
          if (filter) {
            command = `ps aux | grep -i "${filter}" | grep -v grep | head -n ${limit}`;
          }
        }

        const { stdout } = await execAsync(command, { timeout: 10000 });

        toolExecutionsModel.create({
          tool_name: "processInfo",
          input: { filter, pid, sortBy, limit },
          output: stdout.substring(0, 2000),
          success: true,
        });

        return {
          success: true,
          output: stdout.trim(),
          platform: getPlatform(),
        };
      }
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

export const killProcess = tool({
  description: `Kill/terminate a process by PID. Use with caution!
Works on: Windows (Stop-Process), Linux/macOS (kill)`,
  parameters: z.object({
    pid: z.number().describe("Process ID to kill"),
    signal: z.enum(["TERM", "KILL", "HUP", "INT"]).optional().describe("Signal to send (default: TERM, ignored on Windows)"),
    force: z.boolean().optional().describe("Force kill (Windows: -Force, Unix: -9)"),
    confirmed: z.boolean().describe("Confirm killing the process"),
  }),
  execute: async ({ pid, signal = "TERM", force = false, confirmed }) => {
    if (!confirmed) {
      return {
        success: false,
        error: `⚠️ Killing process ${pid} not confirmed. Set confirmed: true to proceed.`,
        requiresConfirmation: true,
      };
    }

    try {
      let command: string;

      if (isWindows()) {
        command = force
          ? `Stop-Process -Id ${pid} -Force -ErrorAction Stop`
          : `Stop-Process -Id ${pid} -ErrorAction Stop`;
        
        await execPlatformCommand("", command);
      } else {
        const killSignal = force ? "KILL" : signal;
        command = `kill -${killSignal} ${pid}`;
        
        await execAsync(command, { timeout: 5000 });
      }

      toolExecutionsModel.create({
        tool_name: "killProcess",
        input: { pid, signal, force },
        output: `Process ${pid} killed`,
        success: true,
      });

      return {
        success: true,
        message: `Process ${pid} killed${force ? " (forced)" : ""}`,
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

export const networkInfo = tool({
  description: `Get network information and diagnostics.
Works on: Windows, Linux, macOS`,
  parameters: z.object({
    action: z.enum(["interfaces", "connections", "ports", "dns"]).describe("What network info to get"),
  }),
  execute: async ({ action }) => {
    try {
      let unixCommand: string;
      let windowsCommand: string;

      switch (action) {
        case "interfaces":
          unixCommand = process.platform === "darwin" ? "ifconfig" : "ip addr";
          windowsCommand = "Get-NetIPAddress | Format-Table InterfaceAlias, IPAddress, AddressFamily, PrefixLength -AutoSize | Out-String";
          break;
        case "connections":
          unixCommand = "netstat -an | head -50";
          windowsCommand = "Get-NetTCPConnection | Select-Object -First 50 | Format-Table LocalAddress, LocalPort, RemoteAddress, RemotePort, State -AutoSize | Out-String";
          break;
        case "ports":
          unixCommand = process.platform === "darwin" 
            ? "lsof -iTCP -sTCP:LISTEN -n -P | head -30"
            : "ss -tlnp | head -30";
          windowsCommand = "Get-NetTCPConnection -State Listen | Select-Object -First 30 | Format-Table LocalAddress, LocalPort, OwningProcess -AutoSize | Out-String";
          break;
        case "dns":
          unixCommand = "cat /etc/resolv.conf";
          windowsCommand = "Get-DnsClientServerAddress | Format-Table InterfaceAlias, ServerAddresses -AutoSize | Out-String";
          break;
      }

      const { stdout } = await execPlatformCommand(unixCommand, windowsCommand);

      toolExecutionsModel.create({
        tool_name: "networkInfo",
        input: { action },
        output: stdout.substring(0, 2000),
        success: true,
      });

      return {
        success: true,
        action,
        output: stdout.trim(),
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

export const ping = tool({
  description: `Ping a host to check connectivity.
Works on: Windows (Test-Connection), Linux/macOS (ping)`,
  parameters: z.object({
    host: z.string().describe("Host or IP to ping"),
    count: z.number().optional().describe("Number of pings (default: 4)"),
  }),
  execute: async ({ host, count = 4 }) => {
    try {
      let unixCommand: string;
      let windowsCommand: string;

      unixCommand = `ping -c ${count} ${host}`;
      windowsCommand = `Test-Connection -ComputerName ${host} -Count ${count} | Format-Table Address, ResponseTime, StatusCode -AutoSize | Out-String`;

      const timeout = (count + 2) * 2000;
      const { stdout, stderr } = await execPlatformCommand(unixCommand, windowsCommand, timeout);

      toolExecutionsModel.create({
        tool_name: "ping",
        input: { host, count },
        output: stdout.substring(0, 1000),
        success: true,
      });

      return {
        success: true,
        host,
        output: stdout.trim() || stderr.trim(),
        platform: getPlatform(),
      };
    } catch (error: unknown) {
      const err = error as { message?: string; stdout?: string };
      return {
        success: false,
        host,
        output: err.stdout || "",
        error: err.message || String(error),
        platform: getPlatform(),
      };
    }
  },
});

export const curl = tool({
  description: `Make HTTP requests.
Works on: Windows (Invoke-WebRequest), Linux/macOS (curl)`,
  parameters: z.object({
    url: z.string().describe("URL to request"),
    method: z.enum(["GET", "POST", "PUT", "DELETE", "HEAD"]).optional().describe("HTTP method"),
    headers: z.record(z.string()).optional().describe("Request headers"),
    data: z.string().optional().describe("Request body data"),
    followRedirects: z.boolean().optional().describe("Follow redirects (default: true)"),
  }),
  execute: async ({ url, method = "GET", headers, data, followRedirects = true }) => {
    try {
      let command: string;

      if (isWindows()) {
        // Build PowerShell Invoke-WebRequest command
        let headerParams = "";
        if (headers) {
          const headerObj = Object.entries(headers)
            .map(([k, v]) => `'${k}'='${v}'`)
            .join("; ");
          headerParams = ` -Headers @{${headerObj}}`;
        }

        let bodyParam = "";
        if (data) {
          bodyParam = ` -Body '${data.replace(/'/g, "''")}'`;
        }

        command = `Invoke-WebRequest -Uri '${url}' -Method ${method}${headerParams}${bodyParam}${followRedirects ? "" : " -MaximumRedirection 0"} -UseBasicParsing | Select-Object StatusCode, StatusDescription, Content | ConvertTo-Json`;
      } else {
        // Build curl command
        command = "curl -s";
        
        if (followRedirects) command += " -L";
        command += ` -X ${method}`;
        
        if (headers) {
          for (const [key, value] of Object.entries(headers)) {
            command += ` -H "${key}: ${value}"`;
          }
        }
        
        if (data) {
          command += ` -d '${data.replace(/'/g, "\\'")}'`;
        }
        
        command += ` "${url}"`;
      }

      const result = await execPlatformCommand(
        isWindows() ? "" : command,
        isWindows() ? command : "",
        30000
      );

      toolExecutionsModel.create({
        tool_name: "curl",
        input: { url, method },
        output: result.stdout.substring(0, 2000),
        success: true,
      });

      return {
        success: true,
        url,
        method,
        response: result.stdout.trim(),
        error: result.stderr || undefined,
        platform: getPlatform(),
      };
    } catch (error: unknown) {
      const err = error as { message?: string };
      return {
        success: false,
        url,
        error: err.message || String(error),
        platform: getPlatform(),
      };
    }
  },
});

export const serviceInfo = tool({
  description: `List and manage system services.
Works on: Windows (Get-Service), Linux (systemctl), macOS (launchctl)`,
  parameters: z.object({
    action: z.enum(["list", "status", "start", "stop", "restart"]).describe("Action to perform"),
    serviceName: z.string().optional().describe("Service name (required for status/start/stop/restart)"),
    filter: z.string().optional().describe("Filter services by name (for list action)"),
  }),
  execute: async ({ action, serviceName, filter }) => {
    const serviceManager = getServiceManager();

    try {
      let command: string;

      if (action === "list") {
        if (isWindows()) {
          command = filter
            ? `Get-Service | Where-Object { $_.DisplayName -like '*${filter}*' } | Format-Table Name, DisplayName, Status -AutoSize | Out-String`
            : "Get-Service | Format-Table Name, DisplayName, Status -AutoSize | Out-String";
        } else if (serviceManager === "systemd") {
          command = filter
            ? `systemctl list-units --type=service | grep -i "${filter}"`
            : "systemctl list-units --type=service --no-pager | head -50";
        } else if (serviceManager === "launchctl") {
          command = filter
            ? `launchctl list | grep -i "${filter}"`
            : "launchctl list | head -50";
        } else {
          command = "service --status-all 2>/dev/null | head -50";
        }
      } else {
        if (!serviceName) {
          return {
            success: false,
            error: "Service name is required for this action",
          };
        }

        if (isWindows()) {
          switch (action) {
            case "status":
              command = `Get-Service -Name '${serviceName}' | Format-List Name, DisplayName, Status, StartType | Out-String`;
              break;
            case "start":
              command = `Start-Service -Name '${serviceName}' -PassThru | Format-List Name, Status | Out-String`;
              break;
            case "stop":
              command = `Stop-Service -Name '${serviceName}' -PassThru | Format-List Name, Status | Out-String`;
              break;
            case "restart":
              command = `Restart-Service -Name '${serviceName}' -PassThru | Format-List Name, Status | Out-String`;
              break;
          }
        } else if (serviceManager === "systemd") {
          switch (action) {
            case "status":
              command = `systemctl status ${serviceName} --no-pager`;
              break;
            case "start":
              command = `systemctl start ${serviceName} && systemctl status ${serviceName} --no-pager`;
              break;
            case "stop":
              command = `systemctl stop ${serviceName} && systemctl status ${serviceName} --no-pager`;
              break;
            case "restart":
              command = `systemctl restart ${serviceName} && systemctl status ${serviceName} --no-pager`;
              break;
          }
        } else if (serviceManager === "launchctl") {
          switch (action) {
            case "status":
              command = `launchctl list | grep ${serviceName}`;
              break;
            case "start":
              command = `launchctl start ${serviceName}`;
              break;
            case "stop":
              command = `launchctl stop ${serviceName}`;
              break;
            case "restart":
              command = `launchctl stop ${serviceName} && launchctl start ${serviceName}`;
              break;
          }
        } else {
          command = `service ${serviceName} ${action}`;
        }
      }

      const { stdout, stderr } = await execPlatformCommand(
        isWindows() ? "" : command!,
        isWindows() ? command! : "",
        15000
      );

      return {
        success: true,
        action,
        serviceName,
        output: stdout.trim() || stderr.trim(),
        serviceManager,
        platform: getPlatform(),
      };
    } catch (error: unknown) {
      const err = error as { message?: string; stderr?: string };
      return {
        success: false,
        error: err.message || String(error),
        serviceManager,
        platform: getPlatform(),
      };
    }
  },
});

export const environmentVariables = tool({
  description: `List environment variables (sensitive values are masked).`,
  parameters: z.object({
    filter: z.string().optional().describe("Filter variables by name pattern"),
    showValues: z.boolean().optional().describe("Show values (masked by default)"),
  }),
  execute: async ({ filter, showValues = false }) => {
    const env = process.env;
    const sensitivePatterns = [
      /key/i, /secret/i, /password/i, /token/i, /credential/i, /auth/i, /api/i,
    ];

    const variables: Record<string, string> = {};

    for (const [key, value] of Object.entries(env)) {
      if (filter && !key.toLowerCase().includes(filter.toLowerCase())) {
        continue;
      }

      if (!showValues || sensitivePatterns.some((p) => p.test(key))) {
        variables[key] = value ? "***" : "(empty)";
      } else {
        variables[key] = value || "(empty)";
      }
    }

    return {
      success: true,
      count: Object.keys(variables).length,
      variables,
      platform: getPlatform(),
      note: showValues
        ? "Sensitive values are still masked for security"
        : "Values are masked. Use showValues: true to see non-sensitive values.",
    };
  },
});

/**
 * Get platform-specific information
 */
export const platformInfo = tool({
  description: `Get detailed platform information for cross-platform compatibility.`,
  parameters: z.object({}),
  execute: async () => {
    const info = getPlatformInfo();
    
    return {
      success: true,
      ...info,
    };
  },
});

// Helper functions
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (parts.length === 0) parts.push(`${Math.floor(seconds)}s`);

  return parts.join(" ");
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unitIndex = 0;
  let value = bytes;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
}
