/**
 * Skills System for Overseer
 * Modular, discoverable capabilities like Vercel's skills.sh
 */

import { db, initializeSchema } from "../../database/db";
import { createLogger } from "../../lib/logger";
import { tool, type Tool } from "ai";
import { z } from "zod";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join, resolve } from "path";
import { pathToFileURL } from "url";
import { scanSkillSecurity } from "./security";

const logger = createLogger("skills");

initializeSchema();

// Built-in skills directory
const BUILTIN_SKILLS_DIR = resolve(process.cwd(), "skills");

// Cache for loaded skill modules
const skillModulesCache = new Map<string, Record<string, Function>>();

export interface Skill {
  id: number;
  skill_id: string;
  name: string;
  description: string | null;
  version: string;
  author: string | null;
  source: "builtin" | "github" | "local" | "marketplace";
  source_url: string | null;
  triggers: string | null; // JSON array
  system_prompt: string | null;
  tools: string | null; // JSON array of tool definitions
  config_schema: string | null; // JSON schema
  config: string | null; // JSON
  is_active: number;
  is_builtin: number;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  use_count: number;
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  triggers: string[];
  system_prompt?: string;
  tools: SkillToolDefinition[];
  config_schema?: Record<string, any>;
  default_config?: Record<string, any>;
}

export interface SkillToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
  execute: string; // Path to execution function or inline code
}

function toJsonString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function parseJsonValue<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;

  try {
    const first = JSON.parse(raw);
    if (typeof first === "string") {
      try {
        return JSON.parse(first) as T;
      } catch {
        return fallback;
      }
    }
    return first as T;
  } catch {
    return fallback;
  }
}

function parseStringArray(raw: string | null): string[] {
  const parsed = parseJsonValue<unknown>(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === "string");
}

async function fetchGitHubTextFile(
  owner: string,
  repo: string,
  filePath: string,
): Promise<string | null> {
  const branches = ["main", "master"];

  for (const branch of branches) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
    try {
      const response = await fetch(rawUrl);
      if (response.ok) {
        return await response.text();
      }
    } catch {
      // Ignore and continue with next candidate
    }
  }

  return null;
}

// Cache for loaded skills
const skillToolsCache = new Map<string, Record<string, Tool>>();

/**
 * Load a skill module dynamically
 */
async function loadSkillModule(
  skillId: string,
): Promise<Record<string, Function>> {
  // Return from cache if available
  if (skillModulesCache.has(skillId)) {
    return skillModulesCache.get(skillId)!;
  }

  const skillDir = join(BUILTIN_SKILLS_DIR, skillId);
  const indexTsPath = join(skillDir, "index.ts");
  const indexJsPath = join(skillDir, "index.js");

  try {
    let modulePath: string | null = null;

    if (existsSync(indexTsPath)) {
      modulePath = indexTsPath;
    } else if (existsSync(indexJsPath)) {
      modulePath = indexJsPath;
    }

    if (modulePath) {
      // Use dynamic import for both TS and JS modules
      // For TypeScript, this relies on ts-node or tsx being available
      const moduleUrl = pathToFileURL(modulePath).href;
      const skillModule = await import(moduleUrl);
      skillModulesCache.set(skillId, skillModule);
      logger.info("Loaded skill module", { skillId, path: modulePath });
      return skillModule;
    }
  } catch (error) {
    logger.error("Failed to load skill module", { skillId, error });
  }

  return {};
}

/**
 * Execute a skill tool function
 */
async function executeSkillFunction(
  skillId: string,
  functionName: string,
  args: Record<string, any>,
): Promise<any> {
  try {
    const skillModule = await loadSkillModule(skillId);

    if (
      skillModule[functionName] &&
      typeof skillModule[functionName] === "function"
    ) {
      const result = await skillModule[functionName](args);
      return result;
    }

    logger.warn("Skill function not found", { skillId, functionName });
    return { error: `Function ${functionName} not found in skill ${skillId}` };
  } catch (error) {
    logger.error("Failed to execute skill function", {
      skillId,
      functionName,
      error,
    });
    return { error: error instanceof Error ? error.message : "Unknown error" };
  }
}

/**
 * Load built-in skills from filesystem
 */
export function loadBuiltinSkills(): SkillDefinition[] {
  const skills: SkillDefinition[] = [];

  if (!existsSync(BUILTIN_SKILLS_DIR)) {
    logger.warn("Built-in skills directory not found", {
      path: BUILTIN_SKILLS_DIR,
    });
    return skills;
  }

  try {
    const entries = readdirSync(BUILTIN_SKILLS_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = join(BUILTIN_SKILLS_DIR, entry.name, "skill.json");

        if (existsSync(skillPath)) {
          try {
            const skillData = JSON.parse(readFileSync(skillPath, "utf-8"));
            const indexTsPath = join(
              BUILTIN_SKILLS_DIR,
              entry.name,
              "index.ts",
            );
            const indexJsPath = join(
              BUILTIN_SKILLS_DIR,
              entry.name,
              "index.js",
            );
            const readmePath = join(
              BUILTIN_SKILLS_DIR,
              entry.name,
              "README.md",
            );

            const indexSource = existsSync(indexTsPath)
              ? readFileSync(indexTsPath, "utf-8")
              : existsSync(indexJsPath)
                ? readFileSync(indexJsPath, "utf-8")
                : "";
            const readmeSource = existsSync(readmePath)
              ? readFileSync(readmePath, "utf-8")
              : "";

            const security = scanSkillSecurity({
              skillId: entry.name,
              name: String(skillData.name || entry.name),
              description:
                typeof skillData.description === "string"
                  ? skillData.description
                  : null,
              systemPrompt:
                typeof skillData.system_prompt === "string"
                  ? skillData.system_prompt
                  : null,
              tools: skillData.tools,
              indexSource,
              readmeSource,
            });

            if (!security.allowed) {
              logger.warn(
                "Built-in skill flagged by security scan; allowing but marked for review",
                {
                  skillId: entry.name,
                  issues: security.issues,
                },
              );
            }

            if (security.issues.length > 0) {
              logger.warn("Built-in skill has security warnings", {
                skillId: entry.name,
                issues: security.issues,
              });
            }

            skills.push({
              id: entry.name,
              ...skillData,
            });
          } catch (error) {
            logger.error("Failed to load skill", { skill: entry.name, error });
          }
        }
      }
    }
  } catch (error) {
    logger.error("Failed to read skills directory", { error });
  }

  return skills;
}

/**
 * Sync built-in skills to database
 */
export function syncBuiltinSkills(): void {
  const builtinSkills = loadBuiltinSkills();

  for (const skill of builtinSkills) {
    const existing = findBySkillId(skill.id);

    if (!existing) {
      // Create new skill
      createSkill({
        skill_id: skill.id,
        name: skill.name,
        description: skill.description,
        version: skill.version,
        author: skill.author,
        source: "builtin",
        triggers: JSON.stringify(skill.triggers || []),
        system_prompt: skill.system_prompt,
        tools: JSON.stringify(skill.tools || []),
        config_schema: skill.config_schema
          ? JSON.stringify(skill.config_schema)
          : null,
        config: skill.default_config
          ? JSON.stringify(skill.default_config)
          : null,
        is_builtin: 1,
      });
    } else if (existing.is_builtin) {
      // Update existing built-in skill
      updateSkill(existing.id, {
        name: skill.name,
        description: skill.description,
        version: skill.version,
        triggers: JSON.stringify(skill.triggers || []),
        system_prompt: skill.system_prompt,
        tools: JSON.stringify(skill.tools || []),
      });
    }
  }

  logger.info("Synced built-in skills", { count: builtinSkills.length });
}

/**
 * Create a new skill
 */
export function createSkill(
  skill: Partial<Skill> & { skill_id: string; name: string },
): Skill {
  const stmt = db.prepare(`
    INSERT INTO skills (
      skill_id, name, description, version, author, source, source_url,
      triggers, system_prompt, tools, config_schema, config, is_builtin
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    skill.skill_id,
    skill.name,
    skill.description || null,
    skill.version || "1.0.0",
    skill.author || null,
    skill.source || "local",
    skill.source_url || null,
    toJsonString(skill.triggers),
    skill.system_prompt || null,
    toJsonString(skill.tools),
    toJsonString(skill.config_schema),
    toJsonString(skill.config),
    skill.is_builtin ? 1 : 0,
  );

  logger.info("Created skill", { skillId: skill.skill_id, name: skill.name });
  return findById(result.lastInsertRowid as number)!;
}

/**
 * Find skill by ID
 */
export function findById(id: number): Skill | null {
  const stmt = db.prepare("SELECT * FROM skills WHERE id = ?");
  return stmt.get(id) as Skill | null;
}

/**
 * Find skill by skill_id
 */
export function findBySkillId(skillId: string): Skill | null {
  const stmt = db.prepare("SELECT * FROM skills WHERE skill_id = ?");
  return stmt.get(skillId) as Skill | null;
}

/**
 * Get all skills
 */
export function getAllSkills(): Skill[] {
  const stmt = db.prepare("SELECT * FROM skills ORDER BY name");
  return stmt.all() as Skill[];
}

/**
 * Get active skills
 */
export function getActiveSkills(): Skill[] {
  const stmt = db.prepare(
    "SELECT * FROM skills WHERE is_active = 1 ORDER BY name",
  );
  return stmt.all() as Skill[];
}

/**
 * Update skill
 */
export function updateSkill(
  id: number,
  updates: Partial<Omit<Skill, "id" | "created_at">>,
): void {
  const fields: string[] = ["updated_at = CURRENT_TIMESTAMP"];
  const values: any[] = [];

  if (updates.name !== undefined) {
    fields.push("name = ?");
    values.push(updates.name);
  }
  if (updates.description !== undefined) {
    fields.push("description = ?");
    values.push(updates.description);
  }
  if (updates.version !== undefined) {
    fields.push("version = ?");
    values.push(updates.version);
  }
  if (updates.triggers !== undefined) {
    fields.push("triggers = ?");
    values.push(
      typeof updates.triggers === "string"
        ? updates.triggers
        : JSON.stringify(updates.triggers),
    );
  }
  if (updates.system_prompt !== undefined) {
    fields.push("system_prompt = ?");
    values.push(updates.system_prompt);
  }
  if (updates.tools !== undefined) {
    fields.push("tools = ?");
    values.push(
      typeof updates.tools === "string"
        ? updates.tools
        : JSON.stringify(updates.tools),
    );
  }
  if (updates.config !== undefined) {
    fields.push("config = ?");
    values.push(
      typeof updates.config === "string"
        ? updates.config
        : JSON.stringify(updates.config),
    );
  }
  if (updates.is_active !== undefined) {
    fields.push("is_active = ?");
    values.push(updates.is_active ? 1 : 0);
  }

  const stmt = db.prepare(`
    UPDATE skills 
    SET ${fields.join(", ")}
    WHERE id = ?
  `);

  stmt.run(...values, id);
}

/**
 * Delete skill
 */
export function deleteSkill(id: number): void {
  const skill = findById(id);
  if (skill) {
    skillToolsCache.delete(skill.skill_id);
  }

  const stmt = db.prepare("DELETE FROM skills WHERE id = ?");
  stmt.run(id);
}

/**
 * Get skill tools as AI SDK tools
 */
export function getSkillTools(skillId: string): Record<string, Tool> {
  // Return from cache if available
  if (skillToolsCache.has(skillId)) {
    return skillToolsCache.get(skillId)!;
  }

  const skill = findBySkillId(skillId);
  if (!skill || !skill.tools) {
    return {};
  }

  try {
    const toolsDef = parseJsonValue<SkillToolDefinition[]>(skill.tools, []);
    if (!Array.isArray(toolsDef)) {
      logger.warn("Skill tools payload is not an array", { skillId });
      return {};
    }
    const tools: Record<string, Tool> = {};

    for (const toolDef of toolsDef) {
      // Parse the execute path to get function name
      // Format: "index.ts:functionName" or just "functionName"
      const executePath = toolDef.execute || toolDef.name;
      const functionName = executePath.includes(":")
        ? executePath.split(":")[1]
        : executePath;

      // Create tool that dynamically executes the skill function
      tools[toolDef.name] = tool<any, any>({
        description: toolDef.description,
        inputSchema: convertJsonSchemaToZod(toolDef.parameters),
        execute: async (args: Record<string, any>) => {
          logger.info("Executing skill tool", {
            skill: skillId,
            tool: toolDef.name,
            function: functionName,
            args,
          });

          // Record usage
          recordUsage(skillId);

          // Execute the actual skill function
          const result = await executeSkillFunction(
            skillId,
            functionName,
            args,
          );

          // Return formatted result
          if (typeof result === "object") {
            return JSON.stringify(result, null, 2);
          }
          return String(result);
        },
      });
    }

    skillToolsCache.set(skillId, tools);
    return tools;
  } catch (error) {
    logger.error("Failed to parse skill tools", { skillId, error });
    return {};
  }
}

/**
 * Get all tools from all active skills
 */
export function getAllActiveSkillTools(): Record<string, Tool> {
  const activeSkills = getActiveSkills();
  const allTools: Record<string, Tool> = {};

  for (const skill of activeSkills) {
    const skillTools = getSkillTools(skill.skill_id);
    for (const [name, tool] of Object.entries(skillTools)) {
      // Prefix with skill ID to avoid conflicts
      allTools[`${skill.skill_id}_${name}`] = tool;
    }
  }

  return allTools;
}

/**
 * Check if a query matches skill triggers
 */
export function matchSkillTriggers(query: string): Skill[] {
  const activeSkills = getActiveSkills();
  const matching: Skill[] = [];

  for (const skill of activeSkills) {
    if (skill.triggers) {
      const triggers = parseStringArray(skill.triggers);
      for (const trigger of triggers) {
        if (query.toLowerCase().includes(trigger.toLowerCase())) {
          matching.push(skill);
          break;
        }
      }
    }
  }

  return matching;
}

/**
 * Record skill usage
 */
export function recordUsage(skillId: string): void {
  const stmt = db.prepare(`
    UPDATE skills 
    SET use_count = use_count + 1, last_used_at = CURRENT_TIMESTAMP
    WHERE skill_id = ?
  `);
  stmt.run(skillId);
}

/**
 * Convert JSON schema to Zod
 */
function convertJsonSchemaToZod(schema: Record<string, any>): z.ZodTypeAny {
  if (!schema || schema.type !== "object") {
    return z.object({});
  }

  const shape: Record<string, z.ZodTypeAny> = {};

  if (schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      const propSchema = prop as any;
      let zodType: z.ZodTypeAny;

      switch (propSchema.type) {
        case "string":
          zodType = z.string();
          break;
        case "number":
          zodType = z.number();
          break;
        case "integer":
          zodType = z.number().int();
          break;
        case "boolean":
          zodType = z.boolean();
          break;
        case "array":
          zodType = z.array(z.any());
          break;
        case "object":
          zodType = convertJsonSchemaToZod(propSchema);
          break;
        default:
          zodType = z.any();
      }

      if (propSchema.description) {
        zodType = zodType.describe(propSchema.description);
      }

      shape[key] = zodType;
    }
  }

  let zodSchema = z.object(shape);

  if (schema.required && Array.isArray(schema.required)) {
    const optionalShape: Record<string, z.ZodTypeAny> = {};
    for (const [key, val] of Object.entries(shape)) {
      if (!schema.required.includes(key)) {
        optionalShape[key] = val.optional();
      } else {
        optionalShape[key] = val;
      }
    }
    zodSchema = z.object(optionalShape);
  }

  return zodSchema;
}

/**
 * Import skill from GitHub
 */
export async function importFromGitHub(url: string): Promise<Skill | null> {
  try {
    // Parse GitHub URL
    const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!match) {
      throw new Error("Invalid GitHub URL");
    }

    const [, owner, repo] = match;
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/skill.json`;

    const response = await fetch(rawUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch skill: ${response.statusText}`);
    }

    const skillData = await response.json();

    const indexSource =
      (await fetchGitHubTextFile(owner, repo, "index.ts")) ||
      (await fetchGitHubTextFile(owner, repo, "index.js")) ||
      "";
    const readmeSource =
      (await fetchGitHubTextFile(owner, repo, "README.md")) || "";

    const security = scanSkillSecurity({
      skillId: `${owner}_${repo}`,
      name: String(skillData.name || `${owner}/${repo}`),
      description:
        typeof skillData.description === "string"
          ? skillData.description
          : null,
      systemPrompt:
        typeof skillData.system_prompt === "string"
          ? skillData.system_prompt
          : null,
      tools: skillData.tools,
      indexSource,
      readmeSource,
      repositoryUrl: url,
    });

    if (!security.allowed) {
      logger.error("Blocked GitHub skill import due to security scan", {
        url,
        issues: security.issues,
      });
      return null;
    }

    if (security.issues.length > 0) {
      logger.warn("GitHub skill import has security warnings", {
        url,
        issues: security.issues,
      });
    }

    return createSkill({
      skill_id: `${owner}_${repo}`,
      name: skillData.name,
      description: skillData.description,
      version: skillData.version || "1.0.0",
      author: skillData.author || owner,
      source: "github",
      source_url: url,
      triggers: skillData.triggers,
      system_prompt: skillData.system_prompt,
      tools: skillData.tools,
      config_schema: skillData.config_schema,
      config: skillData.default_config,
    });
  } catch (error) {
    logger.error("Failed to import skill from GitHub", { url, error });
    return null;
  }
}

/**
 * Get skill info including loaded state
 */
export function getSkillInfo(skillId: string): {
  skill: Skill | null;
  loaded: boolean;
  toolCount: number;
} {
  const skill = findBySkillId(skillId);
  if (!skill) {
    return { skill: null, loaded: false, toolCount: 0 };
  }

  const loaded = skillModulesCache.has(skillId);
  let toolCount = 0;

  if (skill.tools) {
    try {
      const tools = JSON.parse(skill.tools);
      toolCount = Array.isArray(tools) ? tools.length : 0;
    } catch {}
  }

  return { skill, loaded, toolCount };
}

/**
 * Preload all active skill modules
 */
export async function preloadActiveSkills(): Promise<void> {
  const activeSkills = getActiveSkills();

  for (const skill of activeSkills) {
    try {
      await loadSkillModule(skill.skill_id);
    } catch (error) {
      logger.warn("Failed to preload skill", {
        skillId: skill.skill_id,
        error,
      });
    }
  }

  logger.info("Preloaded active skills", { count: activeSkills.length });
}

/**
 * Clear skill caches (useful for development)
 */
export function clearSkillCaches(): void {
  skillToolsCache.clear();
  skillModulesCache.clear();
  logger.info("Cleared skill caches");
}

/**
 * Get skill system stats
 */
export function getSkillStats(): {
  total: number;
  active: number;
  builtin: number;
  loaded: number;
  totalUsage: number;
} {
  const allSkills = getAllSkills();
  const activeSkills = allSkills.filter((s) => s.is_active);
  const builtinSkills = allSkills.filter((s) => s.is_builtin);
  const totalUsage = allSkills.reduce((sum, s) => sum + s.use_count, 0);

  return {
    total: allSkills.length,
    active: activeSkills.length,
    builtin: builtinSkills.length,
    loaded: skillModulesCache.size,
    totalUsage,
  };
}

/**
 * List available skills with their tools
 */
export function listSkillsWithTools(): Array<{
  id: string;
  name: string;
  description: string;
  active: boolean;
  tools: string[];
  triggers: string[];
}> {
  const skills = getAllSkills();

  return skills.map((skill) => {
    let tools: string[] = [];
    let triggers: string[] = [];

    if (skill.tools) {
      const toolsDef = parseJsonValue<SkillToolDefinition[]>(skill.tools, []);
      if (Array.isArray(toolsDef)) {
        tools = toolsDef
          .map((t) => (t && typeof t.name === "string" ? t.name : ""))
          .filter(Boolean);
      }
    }
    if (skill.triggers) {
      triggers = parseStringArray(skill.triggers);
    }

    return {
      id: skill.skill_id,
      name: skill.name,
      description: skill.description || "",
      active: skill.is_active === 1,
      tools,
      triggers,
    };
  });
}
