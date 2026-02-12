import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type InterfaceType = "telegram" | "discord" | "slack" | "web";

function getServiceName(type: InterfaceType): string | null {
  if (type === "telegram") return "overseer-telegram";
  if (type === "discord") return "overseer-discord";
  if (type === "slack") return "overseer-slack";
  return null;
}

async function hasSystemctl(): Promise<boolean> {
  try {
    await access("/usr/bin/systemctl", constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Best-effort interface service synchronization.
 * This is intentionally non-fatal so UI state can still be updated even if service control fails.
 */
export async function syncInterfaceServiceState(
  type: InterfaceType,
  isActive: boolean,
): Promise<{ attempted: boolean; ok: boolean; message?: string }> {
  const serviceName = getServiceName(type);
  if (!serviceName) {
    return { attempted: false, ok: true };
  }

  if (process.platform !== "linux") {
    return { attempted: false, ok: true };
  }

  if (!(await hasSystemctl())) {
    return {
      attempted: false,
      ok: false,
      message: "systemctl is not available on this host.",
    };
  }

  const action = isActive ? "start" : "stop";

  try {
    await execFileAsync("systemctl", [action, serviceName]);
    return { attempted: true, ok: true };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : `Failed to ${action} ${serviceName}`,
    };
  }
}
