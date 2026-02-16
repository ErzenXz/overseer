/**
 * Skills management tools exposed to the model.
 *
 * This is the missing piece that prevents the model from claiming
 * "I can't install skills in this environment".
 *
 * Guarded by RBAC permissions (skills:install/activate/etc).
 */

import { tool } from "ai";
import { z } from "zod";
import { createLogger } from "@/lib/logger";
import { getToolContext } from "@/lib/tool-context";
import { usersModel } from "@/database/models/users";
import { Permission, requirePermission } from "@/lib/permissions";
import {
  getAllSkills,
  getActiveSkills,
  findBySkillId,
  importFromGitHub,
  syncBuiltinSkills,
  updateSkill,
} from "@/agent/skills/registry";

const logger = createLogger("tools:skills");

function requireWebUserWithPermission(permission: Permission) {
  const ctx = getToolContext();
  if (!ctx?.actor || ctx.actor.kind !== "web") {
    throw new Error("Skills tools are only available for authenticated web users.");
  }

  const userId = Number.parseInt(ctx.actor.id, 10);
  if (!Number.isFinite(userId)) {
    throw new Error("Invalid user context for skills tools.");
  }

  const user = usersModel.findById(userId);
  if (!user) {
    throw new Error("User not found for skills tools.");
  }

  requirePermission(user, permission, {
    resource: "skills",
    metadata: { tool: "skills" },
  });

  return { user, userId };
}

export const listSkills = tool<any, any>({
  description:
    "List available skills (installed in the database). Use this to see what skills exist and whether they are active.",
  inputSchema: z.object({
    active_only: z.boolean().optional().describe("If true, only return active skills."),
  }),
  execute: async ({ active_only }: { active_only?: boolean }) => {
    requireWebUserWithPermission(Permission.SKILLS_VIEW);

    const skills = active_only ? getActiveSkills() : getAllSkills();
    return JSON.stringify(
      skills.map((s) => ({
        id: s.id,
        skill_id: s.skill_id,
        name: s.name,
        version: s.version,
        source: s.source,
        is_active: Boolean(s.is_active),
        is_builtin: Boolean(s.is_builtin),
        owner_user_id: s.owner_user_id,
      })),
      null,
      2,
    );
  },
});

export const syncBuiltinSkillsTool = tool<any, any>({
  description:
    "Sync built-in skills from the local skills/ directory into the database (idempotent upsert).",
  inputSchema: z.object({}),
  execute: async () => {
    requireWebUserWithPermission(Permission.SKILLS_INSTALL);
    syncBuiltinSkills();
    return "Built-in skills synced.";
  },
});

export const installSkillFromGitHub = tool<any, any>({
  description:
    "Install/import a skill from a GitHub repository URL (expects a skill.json at repo root).",
  inputSchema: z.object({
    url: z.string().describe("GitHub repository URL, e.g. https://github.com/owner/repo"),
    activate: z.boolean().optional().describe("If true, activate the skill after install (default: true)."),
  }),
  execute: async ({ url, activate }: { url: string; activate?: boolean }) => {
    const { userId } = requireWebUserWithPermission(Permission.SKILLS_INSTALL);
    const skill = await importFromGitHub(url);
    if (!skill) {
      return JSON.stringify({ success: false, error: "Failed to import skill from GitHub." });
    }

    logger.info("Imported skill from GitHub", { url, skillId: skill.skill_id, userId });

    const shouldActivate = activate !== false;
    if (shouldActivate && !skill.is_active) {
      updateSkill(skill.id, { is_active: 1 });
    }

    return JSON.stringify(
      {
        success: true,
        installed: {
          id: skill.id,
          skill_id: skill.skill_id,
          name: skill.name,
          source: skill.source,
          is_active: shouldActivate ? true : Boolean(skill.is_active),
        },
      },
      null,
      2,
    );
  },
});

export const setSkillActive = tool<any, any>({
  description: "Activate or deactivate an installed skill by skill_id.",
  inputSchema: z.object({
    skill_id: z.string().describe("The skill_id, e.g. 'web-search'"),
    is_active: z.boolean().describe("true to activate, false to deactivate"),
  }),
  execute: async ({ skill_id, is_active }: { skill_id: string; is_active: boolean }) => {
    requireWebUserWithPermission(
      is_active ? Permission.SKILLS_ACTIVATE : Permission.SKILLS_DEACTIVATE,
    );

    const skill = findBySkillId(skill_id);
    if (!skill) {
      return JSON.stringify({ success: false, error: `Skill not found: ${skill_id}` });
    }

    updateSkill(skill.id, { is_active: is_active ? 1 : 0 });
    return JSON.stringify({ success: true, skill_id, is_active });
  },
});

