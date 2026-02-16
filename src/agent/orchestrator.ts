/**
 * Orchestrator (Plan Mode)
 *
 * Implements: plan -> execute via sub-agents -> evaluate -> synthesize.
 * Persists runs into the agent_tasks queue for dashboard visibility.
 */

import { generateText, type LanguageModel, type Tool } from "ai";
import { createLogger } from "@/lib/logger";
import { agentTasksModel } from "@/database";
import { getToolContext } from "@/lib/tool-context";
import {
  createSubAgent,
  executeTask,
} from "@/agent/subagents/manager";

const logger = createLogger("agent-orchestrator");

export interface OrchestrationOptions {
  parentSessionId: string;
  tools: Record<string, Tool>;
  model: LanguageModel;
  context?: string;
  steering?: string;
  ownerUserId?: number;
  conversationId?: number;
}

export interface OrchestrationPlanStep {
  id: string;
  title: string;
  description: string;
  can_parallelize: boolean;
  expected_artifacts?: string[];
  verification?: string[];
}

export interface OrchestrationPlan {
  goal: string;
  constraints: string[];
  risk_level: "low" | "medium" | "high";
  steps: OrchestrationPlanStep[];
}

export interface OrchestrationResult {
  success: boolean;
  text: string;
  plan?: OrchestrationPlan;
  taskId?: number;
}

function toolsForSubagent(all: Record<string, Tool>): Record<string, Tool> {
  // Subagent is a clone of the main agent: same toolset.
  return all;
}

function parsePlanJson(text: string): OrchestrationPlan {
  const raw = text.trim();
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? raw;
  const match = candidate.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Planner did not output a JSON object");
  return JSON.parse(match[0]) as OrchestrationPlan;
}

export async function runPlanModeOrchestration(
  prompt: string,
  options: OrchestrationOptions,
): Promise<OrchestrationResult> {
  const ownerUserId = options.ownerUserId ?? (() => {
    const ctx = getToolContext();
    if (ctx?.actor?.kind === "web") {
      const n = parseInt(ctx.actor.id, 10);
      if (Number.isFinite(n)) return n;
    }
    return 1;
  })();

  const parentTask = agentTasksModel.create({
    owner_user_id: ownerUserId,
    conversation_id: options.conversationId ?? null,
    title: "Orchestration",
    input: prompt,
    status: "running",
    priority: 5,
    artifacts: {
      parentSessionId: options.parentSessionId,
    },
  });

  try {
    // 1) Planner sub-agent
    const plannerPrompt = `You are creating an execution plan for the main assistant.

Return ONLY JSON matching this schema:
{
  "goal": string,
  "constraints": string[],
  "risk_level": "low"|"medium"|"high",
  "steps": [
    {
      "id": string,
      "title": string,
      "description": string,
      "can_parallelize": boolean,
      "expected_artifacts": string[],
      "verification": string[]
    }
  ]
}

Task:
${prompt}

Context:
${options.context || "None"}
`;
    // Planner runs on the main model directly (no subagent types).
    const planResult = await generateText({
      model: options.model,
      system: "You are a planning assistant. Return ONLY valid JSON.",
      prompt: plannerPrompt,
      maxRetries: 2,
    });

    const plan = parsePlanJson(planResult.text);

    agentTasksModel.update(parentTask.id, {
      artifacts: { plan },
    });

    // 2) Execute steps (sub-agents)
    const stepOutputs: Array<{ step: OrchestrationPlanStep; ok: boolean; output: string }> = [];

    for (const step of plan.steps || []) {
      const stepTask = agentTasksModel.create({
        owner_user_id: ownerUserId,
        conversation_id: options.conversationId ?? null,
        parent_task_id: parentTask.id,
        title: step.title || `Step ${step.id}`,
        input: step.description || step.title,
        status: "running",
        priority: step.can_parallelize ? 6 : 5,
        artifacts: { planStep: step },
      });

      const sub = createSubAgent({
        parent_session_id: options.parentSessionId,
        owner_user_id: ownerUserId,
        assigned_task: `Step: ${step.title}\n\n${step.description}\n\nExpected artifacts:\n${(step.expected_artifacts || []).join("\n")}\n\nVerification:\n${(step.verification || []).join("\n")}`.trim(),
        metadata: {
          kind: "executor",
          stepId: step.id,
          taskId: stepTask.id,
        },
      });

      agentTasksModel.update(stepTask.id, {
        assigned_sub_agent_id: sub.sub_agent_id,
        started_at: new Date().toISOString(),
      });

      const exec = await executeTask(
        sub.sub_agent_id,
        options.model,
        toolsForSubagent(options.tools),
        { toolContext: getToolContext(), timeout: 300_000 },
      );

      stepOutputs.push({ step, ok: exec.success, output: exec.result || exec.error || "" });

      agentTasksModel.update(stepTask.id, {
        status: exec.success ? "completed" : "failed",
        finished_at: new Date().toISOString(),
        result_full: exec.result || null,
        result_summary: exec.success ? "Completed" : "Failed",
        error: exec.success ? null : exec.error || "Step failed",
      });

      if (!exec.success) {
        // Stop on first failure for now; later we can allow partial completion.
        break;
      }
    }

    const allOk = stepOutputs.every((s) => s.ok);

    // 3) Evaluator sub-agent (verification)
    // Evaluator runs on the main model directly (no subagent types).
    const evalResult = await generateText({
      model: options.model,
      system:
        "You are a verification assistant. Provide a crisp pass/fail report and list any failing checks.",
      prompt: `Verify the following work. If you can, suggest the best checks to run (tests/build/lint) and whether results indicate success.\n\nPlan:\n${JSON.stringify(plan, null, 2)}\n\nStep outputs:\n${stepOutputs.map((s) => `## ${s.step.title}\nOK: ${s.ok}\n${s.output}`).join("\n\n")}`,
      maxRetries: 2,
    });

    // 4) Synthesize final answer (main model, no tools)
    const synthesisPrompt = `You are Overseer. Produce the final response to the user.

User request:
${prompt}

Execution plan:
${JSON.stringify(plan, null, 2)}

Step results:
${stepOutputs.map((s) => `- ${s.step.title}: ${s.ok ? "OK" : "FAILED"}`).join("\n")}

Evaluator report:
${evalResult.text}

Write like a competent human assistant.

Rules:
- For greetings/small talk, respond naturally (e.g., greet back and ask how you can help). Do NOT mention plans, sub-agents, tasks, or verification.
- Only summarize execution if real work was performed (e.g., files changed, commands run, services restarted).
- If something failed, say what failed and what you recommend next.
- Keep it concise and high-signal; use bullets only if they help.
`;

    const synthesis = await generateText({
      model: options.model,
      system:
        "You are Overseer, a competent human-like assistant operating this VPS. Be direct and high-signal.",
      prompt: synthesisPrompt,
      maxRetries: 1,
    });

    agentTasksModel.update(parentTask.id, {
      status: allOk ? "completed" : "failed",
      finished_at: new Date().toISOString(),
      result_summary: allOk ? "Completed" : "Failed",
      result_full: synthesis.text,
      error: allOk ? null : "One or more steps failed",
      artifacts: {
        plan,
        stepOutputs,
        evaluator: { ok: true, text: evalResult.text },
      },
    });

    return {
      success: allOk,
      text: synthesis.text,
      plan,
      taskId: parentTask.id,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Orchestration failed", { error: msg });
    agentTasksModel.update(parentTask.id, {
      status: "failed",
      finished_at: new Date().toISOString(),
      error: msg,
    });
    return { success: false, text: `Orchestration failed: ${msg}`, taskId: parentTask.id };
  }
}
