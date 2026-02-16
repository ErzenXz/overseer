function truncateMiddle(input: string, maxLen: number): string {
  const s = String(input || "");
  if (s.length <= maxLen) return s;
  const head = Math.max(1, Math.floor(maxLen * 0.7));
  const tail = Math.max(1, maxLen - head - 3);
  return `${s.slice(0, head)}...${s.slice(s.length - tail)}`;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function formatToolReceiptText(
  receipts: Array<{ name: string; args: unknown; result: unknown }>,
): string | null {
  if (!receipts || receipts.length === 0) return null;

  const maxItems = 6;
  const items = receipts.slice(0, maxItems);
  const lines: string[] = ["Tool receipt"];

  for (const r of items) {
    const name = r?.name || "unknown";

    let argsSummary = "";
    if (name === "executeShellCommand" || name === "executeShellCommandConfirmed") {
      const cmd =
        r?.args && typeof r.args === "object" && r.args !== null && "command" in (r.args as any)
          ? String((r.args as any).command || "")
          : safeJson(r.args);
      argsSummary = truncateMiddle(cmd, 120);
    } else {
      argsSummary = truncateMiddle(safeJson(r.args), 120);
    }

    let resultSummary = "";
    if (r?.result && typeof r.result === "object" && r.result !== null) {
      const ok =
        "success" in (r.result as any) ? Boolean((r.result as any).success) : undefined;
      const out =
        "output" in (r.result as any) ? String((r.result as any).output || "") : "";
      const err =
        "error" in (r.result as any) ? String((r.result as any).error || "") : "";

      if (ok === true) {
        resultSummary = out ? `ok: ${truncateMiddle(out.replaceAll("\n", " "), 140)}` : "ok";
      } else if (ok === false) {
        resultSummary = err ? `error: ${truncateMiddle(err.replaceAll("\n", " "), 140)}` : "error";
      } else {
        resultSummary = truncateMiddle(safeJson(r.result), 140);
      }
    } else {
      resultSummary = truncateMiddle(safeJson(r.result), 140);
    }

    lines.push(`- ${name}: ${argsSummary} -> ${resultSummary}`);
  }

  if (receipts.length > maxItems) {
    lines.push(`- …and ${receipts.length - maxItems} more`);
  }

  return lines.join("\n");
}

