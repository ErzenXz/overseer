import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/database";
import { saveUserSoulSupplement, getDefaultModel } from "@/agent";
import { generateText } from "ai";
import type { PersonalizationAnswers } from "@/agent/profile";
import { renderUserSoulSupplement } from "@/agent/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function upsertMemory(input: {
  ownerUserId: number;
  key: string;
  value: string;
  category: "preference" | "fact" | "project" | "context" | "custom";
  importance?: number;
  source?: string;
  scope?: "private" | "shared";
}) {
  const scope = input.scope ?? "private";
  const importance = input.importance ?? 7;
  const source = input.source ?? "onboarding";

  const existing = db
    .prepare(
      "SELECT id FROM memory WHERE owner_user_id = ? AND key = ? AND scope = ? LIMIT 1",
    )
    .get(input.ownerUserId, input.key, scope) as { id: number } | undefined;

  if (existing?.id) {
    db.prepare(
      `UPDATE memory
       SET value = ?, category = ?, importance = ?, source = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(input.value, input.category, importance, source, existing.id);
    return;
  }

  db.prepare(
    `INSERT INTO memory (owner_user_id, scope, key, value, category, importance, source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.ownerUserId,
    scope,
    input.key,
    input.value,
    input.category,
    importance,
    source,
  );
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const answers = body?.answers as Partial<PersonalizationAnswers> | undefined;
    const refine = body?.refine !== false;

    if (!answers || typeof answers !== "object") {
      return NextResponse.json({ error: "answers are required" }, { status: 400 });
    }

    // Basic validation: ensure required fields exist.
    const required: Array<keyof PersonalizationAnswers> = [
      "toneDefault",
      "verbosityDefault",
      "whenUncertain",
      "confirmations",
      "decisionStyle",
      "technicalDepth",
      "proactivity",
      "primaryGoals",
      "stressHandling",
    ];
    for (const key of required) {
      if (!(key in answers)) {
        return NextResponse.json(
          { error: `Missing required answer: ${String(key)}` },
          { status: 400 },
        );
      }
    }

    const normalized = answers as PersonalizationAnswers;

    // Store as long-term memory so the agent sees it in system prompt.
    const ownerUserId = user.id;
    upsertMemory({
      ownerUserId,
      key: "user.preferred_name",
      value: normalized.userPreferredName?.trim() || user.username,
      category: "fact",
    });
    if (normalized.userPronouns?.trim()) {
      upsertMemory({
        ownerUserId,
        key: "user.pronouns",
        value: normalized.userPronouns.trim(),
        category: "fact",
      });
    }
    upsertMemory({
      ownerUserId,
      key: "agent.name",
      value: normalized.agentName?.trim() || "Overseer",
      category: "preference",
    });
    upsertMemory({
      ownerUserId,
      key: "style.tone_default",
      value: normalized.toneDefault,
      category: "preference",
    });
    upsertMemory({
      ownerUserId,
      key: "style.verbosity_default",
      value: normalized.verbosityDefault,
      category: "preference",
    });
    upsertMemory({
      ownerUserId,
      key: "style.when_uncertain",
      value: normalized.whenUncertain,
      category: "preference",
    });
    upsertMemory({
      ownerUserId,
      key: "safety.confirmations",
      value: normalized.confirmations,
      category: "preference",
    });
    upsertMemory({
      ownerUserId,
      key: "style.decision_style",
      value: normalized.decisionStyle,
      category: "preference",
    });
    upsertMemory({
      ownerUserId,
      key: "style.technical_depth",
      value: normalized.technicalDepth,
      category: "preference",
    });
    upsertMemory({
      ownerUserId,
      key: "style.proactivity",
      value: normalized.proactivity,
      category: "preference",
    });
    upsertMemory({
      ownerUserId,
      key: "focus.primary_goals",
      value: normalized.primaryGoals,
      category: "project",
      importance: 6,
    });
    upsertMemory({
      ownerUserId,
      key: "style.stress_handling",
      value: normalized.stressHandling,
      category: "preference",
      importance: 6,
    });
    if (normalized.timezone?.trim()) {
      upsertMemory({
        ownerUserId,
        key: "user.timezone",
        value: normalized.timezone.trim(),
        category: "fact",
        importance: 5,
      });
    }

    // Render a deterministic supplement (then optionally refine with LLM).
    let supplement = renderUserSoulSupplement(normalized);

    if (refine) {
      const model = getDefaultModel();
      if (model) {
        try {
          const refinePrompt = `Rewrite this per-user soul supplement to be crisp and high-signal.

Rules:
- Keep meaning identical; do not invent new facts.
- Remove redundancy.
- Keep it short (under ~200 lines).
- Output Markdown only.

Supplement:
${supplement}`;

          const refined = await generateText({
            model,
            prompt: refinePrompt,
            maxRetries: 1,
            maxOutputTokens: 1400,
          });
          if (refined.text?.trim()) {
            supplement = refined.text.trim();
          }
        } catch {
          // keep deterministic template
        }
      }
    }

    saveUserSoulSupplement(ownerUserId, supplement);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to bootstrap profile" },
      { status: 500 },
    );
  }
}

