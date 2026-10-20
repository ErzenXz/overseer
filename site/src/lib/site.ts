export const REPO = "https://github.com/ErzenXz/overseer";
export const RELEASES = `${REPO}/releases`;
export const DOCS = "/docs/";
export const LICENSE = `${REPO}/blob/main/LICENSE`;
export const ISSUES = `${REPO}/issues`;

export const SITE = "https://overseer.sh";

export type OS = "macos" | "linux" | "windows";

export const INSTALL: Record<
  OS,
  {
    label: string;
    shell: string;
    prompt: string;
    command: string;
    note: string;
  }
> = {
  macos: {
    label: "macOS",
    shell: "Terminal",
    prompt: "$",
    command: `curl -fsSL ${SITE}/install-macos.sh | sh`,
    note: "Intel or Apple Silicon. Runs in your user session and starts again at login.",
  },
  linux: {
    label: "Linux",
    shell: "Shell",
    prompt: "$",
    command: `curl -fsSL ${SITE}/install.sh | sh`,
    note: "Installs a systemd service. The recommended home for an always-on hub.",
  },
  windows: {
    label: "Windows",
    shell: "PowerShell",
    prompt: "PS>",
    command: `irm ${SITE}/install.ps1 | iex`,
    note: "Windows 10/11 or Server 2016+, x64 or ARM64. Starts again at sign-in.",
  },
};

export const OS_ORDER: OS[] = ["macos", "linux", "windows"];

/** Best guess at the visitor's OS, so the first command they see is theirs. */
export function detectOS(): OS {
  if (typeof navigator === "undefined") return "macos";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("windows")) return "windows";
  if (ua.includes("mac os") || ua.includes("macintosh")) return "macos";
  if (ua.includes("linux") && !ua.includes("android")) return "linux";
  return "macos";
}
