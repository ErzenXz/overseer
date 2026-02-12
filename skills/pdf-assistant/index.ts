function normalizeLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function summarizePdfText(params: {
  text: string;
  focus?: string;
}): Promise<{ summary: string; focus?: string; lineCount: number }> {
  const lines = normalizeLines(params.text);
  const focus = params.focus?.trim();

  const selected = focus
    ? lines.filter((line) => line.toLowerCase().includes(focus.toLowerCase()))
    : lines;

  const top = selected.slice(0, 8);
  const summary =
    top.length > 0
      ? top.map((line, index) => `${index + 1}. ${line}`).join("\n")
      : "No matching content found for the requested focus.";

  return {
    summary,
    focus: focus || undefined,
    lineCount: lines.length,
  };
}

export async function extractPdfChecklist(params: {
  text: string;
  max_items?: number;
}): Promise<{ checklist: string[]; totalCandidates: number }> {
  const lines = normalizeLines(params.text);
  const maxItems = Math.max(1, Math.min(30, params.max_items ?? 10));

  const checklistCandidates = lines.filter((line) => {
    const lower = line.toLowerCase();
    return (
      lower.includes("must") ||
      lower.includes("should") ||
      lower.includes("required") ||
      lower.includes("action") ||
      /^\d+[.)]/.test(line) ||
      line.startsWith("-") ||
      line.startsWith("•")
    );
  });

  const checklist = checklistCandidates
    .slice(0, maxItems)
    .map((item) => item.replace(/^[-•\d.)\s]+/, "").trim());

  return {
    checklist,
    totalCandidates: checklistCandidates.length,
  };
}
