import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { getToolContext } from "../../src/lib/tool-context";
import { resolveInSandbox } from "../../src/lib/userfs";
async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjs;
}
async function loadMammoth() {
  const mammoth = await import("mammoth");
  return mammoth;
}
function requireSandboxPath(userPath) {
  const ctx = getToolContext();
  if (!ctx?.sandboxRoot || ctx.allowSystem) {
    throw new Error("Sandbox root is required for document extraction");
  }
  const sandboxRoot = ctx.sandboxRoot;
  const absPath = resolveInSandbox(sandboxRoot, userPath);
  return { sandboxRoot, absPath };
}
async function extractPdfText(params) {
  try {
    const p = String(params.path || "").trim();
    if (!p) return { success: false, error: "path is required" };
    if (extname(p).toLowerCase() !== ".pdf") {
      return { success: false, error: "Only .pdf files are supported" };
    }
    const { absPath } = requireSandboxPath(p);
    const pdfjs = await loadPdfJs();
    const data = new Uint8Array(await readFile(absPath));
    const loadingTask = pdfjs.getDocument({ data });
    const doc = await loadingTask.promise;
    const pageCount = doc.numPages || 0;
    const limit = Math.max(0, Math.floor(params.max_pages ?? 0));
    const end = limit > 0 ? Math.min(pageCount, limit) : pageCount;
    let out = "";
    for (let i = 1; i <= end; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const strings = (content.items || []).map((it) => typeof it.str === "string" ? it.str : "").filter(Boolean);
      out += `

# Page ${i}
` + strings.join(" ");
    }
    if (out.length > 2e5) {
      out = out.slice(0, 2e5) + "\n\n...(truncated)";
    }
    return { success: true, pages: end, text: out.trim() };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
async function extractDocxText(params) {
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
    return { success: true, text: text.length > 2e5 ? text.slice(0, 2e5) + "\n\n...(truncated)" : text };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
export {
  extractDocxText,
  extractPdfText
};
