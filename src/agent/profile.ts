export type ChatModePreference = "chat" | "work";

export interface PersonalizationAnswers {
  userPreferredName?: string;
  userPronouns?: string;
  agentName?: string;

  toneDefault: "direct" | "friendly" | "formal" | "playful";
  verbosityDefault: "short" | "balanced" | "detailed";

  whenUncertain: "ask" | "assume_and_note";
  confirmations: "always" | "risky_only" | "catastrophic_only";
  decisionStyle: "recommend_one" | "offer_three" | "ask_first";
  technicalDepth: "explain" | "just_do" | "ask_which";
  proactivity: "suggest_next" | "only_answer";
  primaryGoals: "devops" | "coding" | "business_ops" | "learning" | "mixed";
  stressHandling: "calm_empathetic" | "straight_to_fix";

  timezone?: string;
}

export function renderUserSoulSupplement(a: PersonalizationAnswers): string {
  const userNameLine = a.userPreferredName?.trim()
    ? `- Preferred name: ${a.userPreferredName.trim()}`
    : "";
  const pronounsLine = a.userPronouns?.trim()
    ? `- Pronouns: ${a.userPronouns.trim()}`
    : "";
  const agentName = (a.agentName?.trim() || "Overseer").trim();

  return `# Per-User Soul Supplement

This section is tenant-scoped. Follow it in addition to the base SOUL.md.

## Identity
- Your name: ${agentName}
${userNameLine ? `${userNameLine}\n` : ""}${pronounsLine ? `${pronounsLine}\n` : ""}

## Communication Preferences
- Tone: ${a.toneDefault}
- Verbosity: ${a.verbosityDefault}
- Technical depth: ${a.technicalDepth.replaceAll("_", " ")}
- Decision style: ${a.decisionStyle.replaceAll("_", " ")}
- Proactivity: ${a.proactivity === "suggest_next" ? "suggest next steps" : "only answer what is asked"}
- Stress handling: ${a.stressHandling === "calm_empathetic" ? "calm + empathetic when user seems stressed" : "straight to fix"}

## Uncertainty / Clarifications
- When uncertain: ${a.whenUncertain === "ask" ? "ask clarifying questions" : "make best assumption, clearly note it"}

## Safety / Confirmations
- Confirmations: ${
    a.confirmations === "always"
      ? "always ask before destructive actions"
      : a.confirmations === "risky_only"
        ? "ask before risky/destructive actions"
        : "only ask before catastrophic actions"
  }

## Focus
- Primary goals: ${a.primaryGoals.replaceAll("_", " ")}
${a.timezone?.trim() ? `- Timezone: ${a.timezone.trim()}` : ""}
`;
}

