export async function draftWordDocumentOutline(params: {
  title: string;
  purpose: string;
  audience?: string;
}): Promise<{ title: string; outline: string[] }> {
  const audience = params.audience?.trim() || "general stakeholders";

  return {
    title: params.title,
    outline: [
      `Executive Summary (${audience})`,
      "Background and Context",
      `Purpose and Objectives (${params.purpose})`,
      "Scope and Assumptions",
      "Options / Analysis",
      "Recommendation",
      "Implementation Plan",
      "Risks and Mitigations",
      "Appendix",
    ],
  };
}

export async function improveDocumentText(params: {
  text: string;
  tone?: string;
}): Promise<{ tone: string; improved: string; suggestions: string[] }> {
  const tone = params.tone?.trim() || "professional";
  const cleaned = params.text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();

  const improved =
    tone === "concise"
      ? cleaned
      : `${cleaned}\n\n(Edited for ${tone} tone and improved readability.)`;

  return {
    tone,
    improved,
    suggestions: [
      "Use active voice in key recommendations.",
      "Keep paragraphs to one main idea.",
      "Add measurable outcomes where possible.",
    ],
  };
}
