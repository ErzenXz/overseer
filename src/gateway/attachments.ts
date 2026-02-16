import { extname, resolve } from "path";
import { writeFile, mkdir } from "fs/promises";

function sanitizeFileName(name: string): string {
  const s = String(name || "").trim() || "file";
  return s.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);
}

export type GatewayAttachment =
  | {
      source: "telegram";
      fileId: string;
      fileName?: string | null;
      kind: "photo" | "document";
      caption?: string | null;
    }
  | {
      source: "inline";
      fileName: string;
      mimeType?: string | null;
      base64: string;
    };

async function fetchTelegramFileBytes(input: {
  botToken: string;
  fileId: string;
}): Promise<Uint8Array> {
  const apiBase = `https://api.telegram.org/bot${input.botToken}`;
  const getFileUrl = `${apiBase}/getFile?file_id=${encodeURIComponent(input.fileId)}`;
  const metaRes = await fetch(getFileUrl);
  if (!metaRes.ok) throw new Error(`Telegram getFile failed (${metaRes.status})`);
  const meta = (await metaRes.json()) as any;
  const filePath = meta?.result?.file_path;
  if (!filePath) throw new Error("Telegram getFile returned no file_path");
  const downloadUrl = `https://api.telegram.org/file/bot${input.botToken}/${filePath}`;
  const dl = await fetch(downloadUrl);
  if (!dl.ok) throw new Error(`Telegram file download failed (${dl.status})`);
  return new Uint8Array(await dl.arrayBuffer());
}

export async function saveAttachmentsToSandbox(input: {
  sandboxRoot: string;
  interfaceType: string;
  conversationId: number;
  attachments: GatewayAttachment[];
  // Required for telegram attachments.
  telegramBotToken?: string | null;
}): Promise<{
  saved: Array<{ path: string; fileName: string; extractedTextPath?: string }>;
  promptAppend: string;
}> {
  const saved: Array<{ path: string; fileName: string; extractedTextPath?: string }> = [];
  if (!input.attachments || input.attachments.length === 0) {
    return { saved, promptAppend: "" };
  }

  const dir = resolve(
    input.sandboxRoot,
    input.interfaceType,
    "attachments",
    String(input.conversationId),
  );
  await mkdir(dir, { recursive: true });

  for (const a of input.attachments) {
    if (a.source === "telegram") {
      if (!input.telegramBotToken) {
        throw new Error("Telegram attachment provided but telegramBotToken is missing");
      }
      const name = sanitizeFileName(a.fileName || `${a.kind}-${Date.now()}`);
      const dest = resolve(dir, name);
      const bytes = await fetchTelegramFileBytes({
        botToken: input.telegramBotToken,
        fileId: a.fileId,
      });
      await writeFile(dest, bytes);
      saved.push({ path: dest, fileName: name });
      continue;
    }

    if (a.source === "inline") {
      const name = sanitizeFileName(a.fileName || `file-${Date.now()}`);
      const dest = resolve(dir, name);
      const bytes = Buffer.from(a.base64, "base64");
      await writeFile(dest, bytes);
      saved.push({ path: dest, fileName: name });
      continue;
    }
  }

  // Best-effort extraction for pdf/docx (bounded).
  for (const s of saved) {
    const extracted = await extractTextBestEffort(s.path);
    if (!extracted) continue;
    const capped = extracted.slice(0, 200_000);
    const extractedPath = `${s.path}.extracted.txt`;
    await writeFile(extractedPath, capped);
    s.extractedTextPath = extractedPath;
  }

  const promptLines: string[] = [];
  promptLines.push("");
  promptLines.push("Attachments:");
  for (const s of saved) {
    promptLines.push(`- Saved at: ${s.path}`);
    if (s.extractedTextPath) {
      promptLines.push(`- Extracted text at: ${s.extractedTextPath}`);
    }
  }

  // Include a small snippet to make it usable immediately without opening files.
  for (const s of saved) {
    if (!s.extractedTextPath) continue;
    try {
      const text = await import("fs/promises").then((m) => m.readFile(s.extractedTextPath!, "utf8"));
      const snippet = String(text || "").slice(0, 6000);
      if (snippet.trim()) {
        promptLines.push("");
        promptLines.push(`Extracted snippet from ${s.fileName} (truncated):`);
        promptLines.push(snippet);
      }
    } catch {}
  }

  return { saved, promptAppend: promptLines.join("\n").trimEnd() };
}

async function extractTextBestEffort(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".pdf") {
    try {
      const fs = await import("fs/promises");
      const data = new Uint8Array(await fs.readFile(filePath));
      const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const loadingTask = pdfjs.getDocument({ data });
      const doc = await loadingTask.promise;
      const maxPages = Math.min(20, doc.numPages || 0);
      let out = "";
      for (let i = 1; i <= maxPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const strings = (content.items || [])
          .map((it: any) => (it && typeof it.str === "string" ? it.str : ""))
          .filter(Boolean);
        const pageText = strings.join(" ");
        if (pageText) out += pageText + "\n";
        if (out.length > 120_000) break;
      }
      return out.trim();
    } catch {
      return "";
    }
  }

  if (ext === ".docx") {
    try {
      const mammoth = await import("mammoth");
      const r = await (mammoth as any).extractRawText({ path: filePath });
      return String(r?.value || "").trim();
    } catch {
      return "";
    }
  }

  return "";
}

