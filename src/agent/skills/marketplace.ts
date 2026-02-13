import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

export interface MarketplaceSkill {
  name: string;
  description?: string;
  github: string;
  tags?: string[];
}

const DEFAULT_MARKETPLACE_URL =
  "https://raw.githubusercontent.com/ErzenXz/overseer-skills/main/marketplace.json";

function loadLocalMarketplace(): MarketplaceSkill[] {
  const localPath = resolve(process.cwd(), "skills-marketplace.json");
  if (!existsSync(localPath)) return [];

  try {
    const raw = readFileSync(localPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is MarketplaceSkill =>
        Boolean(x) &&
        typeof x === "object" &&
        typeof (x as any).github === "string" &&
        typeof (x as any).name === "string",
    );
  } catch {
    return [];
  }
}

export async function getMarketplaceSkills(): Promise<{
  source: "remote" | "local" | "empty";
  url?: string;
  skills: MarketplaceSkill[];
}> {
  const url = process.env.SKILLS_MARKETPLACE_URL || DEFAULT_MARKETPLACE_URL;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as unknown;
      if (Array.isArray(data)) {
        const skills = data.filter(
          (x): x is MarketplaceSkill =>
            Boolean(x) &&
            typeof x === "object" &&
            typeof (x as any).github === "string" &&
            typeof (x as any).name === "string",
        );
        return { source: "remote", url, skills };
      }
    }
  } catch {
    // ignore and fall back
  }

  const localSkills = loadLocalMarketplace();
  if (localSkills.length > 0) {
    return { source: "local", skills: localSkills };
  }

  return { source: "empty", skills: [] };
}

