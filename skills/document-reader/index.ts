import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { getToolContext } from "../../src/lib/tool-context";
import { resolveInSandbox } from "../../src/lib/userfs";

// Lazy imports keep server startup light and avoid issues in environments
// where these deps are not used.
async function loadPdfJs() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjs as any;
}

async function loadMammoth() {
  const mammoth = await import("mammoth");
  return mammoth as any;
}

function requireSandboxPath(userPath: string): { sandboxRoot: string; absPath: string } {
  const ctx = getToolContext();
  if (!ctx?.sandboxRoot || ctx.allowSystem) {
    throw new Error("Sandbox root is required for document extraction");
  }
  const sandboxRoot = ctx.sandboxRoot;
  const absPath = resolveInSandbox(sandboxRoot, userPath);
  return { sandboxRoot, absPath };
}

export async function extractPdfText(params: {
  path: string;
  max_pages?: number;
}): Promise<{ success: boolean; pages?: number; text?: string; error?: string }> {
  try {
    const p = String(params.path || "").trim();
    if (!p) return { success: false, error: "path is required" };
    if (extname(p).toLowerCase() !== ".pdf") {
      return { success: false, error: "Only .pdf files are supported" };
    }

    const { absPath } = requireSandboxPath(p);
    const pdfjs = await loadPdfJs();

    // pdfjs-dist expects a Uint8Array.
    const data = new Uint8Array(await readFile(absPath));
    const loadingTask = pdfjs.getDocument({ data });
    const doc = await loadingTask.promise;

    const pageCount: number = doc.numPages || 0;
    const limit = Math.max(0, Math.floor(params.max_pages ?? 0));
    const end = limit > 0 ? Math.min(pageCount, limit) : pageCount;

    let out = "";
    for (let i = 1; i <= end; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const strings = (content.items || [])
        .map((it: any) => (typeof it.str === "string" ? it.str : ""))
        .filter(Boolean);
      out += `\n\n# Page ${i}\n` + strings.join(" ");
    }

    // Keep the output bounded.
    if (out.length > 200_000) {
      out = out.slice(0, 200_000) + "\n\n...(truncated)";
    }

    return { success: true, pages: end, text: out.trim() };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function extractDocxText(params: {
  path: string;
}): Promise<{ success: boolean; text?: string; error?: string }> {
  try {
    const p = String(params.path || "").trim();
    if (!p) return { success: false, error: "path is required" };
    if (extname(p).toLowerCase() !== ".docx") {
      return { success: false, error: "Only .docx files are supported" };
    }

    const { absPath } = requireSandboxPath(p);
    const mammoth = await loadMammoth();

    const result = await mammoth.extractRawText({ path: absPath });
    const text = String(result?.value || "").trim();
    if (!text) return { success: true, text: "" };

    return { success: true, text: text.length > 200_000 ? text.slice(0, 200_000) + "\n\n...(truncated)" : text };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

