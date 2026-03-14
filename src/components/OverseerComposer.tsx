"use client";

import { useEffect, useMemo, useState } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { AttachmentUI, Composer } from "@assistant-ui/react-ui";
import { SlashIcon } from "lucide-react";

interface SandboxFileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
}

interface ListedDirResponse {
  success: boolean;
  entries?: SandboxFileEntry[];
}

interface ActiveSkillEntry {
  id: string;
  name: string;
  description: string;
  tools: string[];
  triggers: string[];
}

interface ListedSkillsResponse {
  skills?: ActiveSkillEntry[];
}

async function blobToFile(path: string): Promise<File> {
  const res = await fetch(
    `/api/files?action=download&path=${encodeURIComponent(path)}&disposition=inline`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error("Failed to load file for attachment");

  const blob = await res.blob();
  const fileName = path.split("/").filter(Boolean).pop() || "file";
  return new File([blob], fileName, {
    type: blob.type || "application/octet-stream",
    lastModified: Date.now(),
  });
}

export default function OverseerComposer() {
  const aui = useAui();
  const text = useAuiState((s) => s.composer.text);
  const canAttach = useAuiState(
    (s) => s.composer.isEditing && s.thread.capabilities.attachments,
  );

  const [allFiles, setAllFiles] = useState<string[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [skills, setSkills] = useState<ActiveSkillEntry[]>([]);
  const [isLoadingSkills, setIsLoadingSkills] = useState(false);

  const mentionMatch = text.match(/(?:^|\s)@([^\s]*)$/);
  const mentionQuery = mentionMatch?.[1] ?? null;
  const slashMatch = text.match(/^\/([^\s]*)$/);
  const slashQuery = slashMatch?.[1] ?? null;

  useEffect(() => {
    if (mentionQuery === null || isLoadingFiles || allFiles.length > 0) return;

    const loadAllFiles = async () => {
      setIsLoadingFiles(true);
      try {
        const collected: string[] = [];
        const queue: Array<{ path: string; depth: number }> = [{ path: ".", depth: 0 }];
        const maxDepth = 4;

        while (queue.length > 0) {
          const next = queue.shift();
          if (!next) break;
          const res = await fetch(
            `/api/files?action=list&path=${encodeURIComponent(next.path)}`,
            { cache: "no-store" },
          );
          if (!res.ok) continue;
          const data = (await res.json()) as ListedDirResponse;
          const entries = Array.isArray(data.entries) ? data.entries : [];
          for (const entry of entries) {
            if (entry.type === "file") {
              collected.push(entry.path);
            } else if (entry.type === "directory" && next.depth < maxDepth) {
              queue.push({ path: entry.path, depth: next.depth + 1 });
            }
          }
        }

        setAllFiles(collected.sort((a, b) => a.localeCompare(b)));
      } finally {
        setIsLoadingFiles(false);
      }
    };

    void loadAllFiles();
  }, [mentionQuery, isLoadingFiles, allFiles.length]);

  useEffect(() => {
    if (slashQuery === null || isLoadingSkills || skills.length > 0) return;

    const loadSkills = async () => {
      setIsLoadingSkills(true);
      try {
        const res = await fetch("/api/skills", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as ListedSkillsResponse;
        setSkills(Array.isArray(data.skills) ? data.skills : []);
      } finally {
        setIsLoadingSkills(false);
      }
    };

    void loadSkills();
  }, [slashQuery, isLoadingSkills, skills.length]);

  const filteredFiles = useMemo(() => {
    if (mentionQuery === null) return [];
    return allFiles
      .filter((path) => path.toLowerCase().includes(mentionQuery.toLowerCase()))
      .slice(0, 10);
  }, [allFiles, mentionQuery]);

  const slashCommands = useMemo(() => {
    if (slashQuery === null) return [];

    return [
      {
        label: "/skills",
        insert: "/skills ",
        description: "List active skills available in this workspace",
      },
      {
        label: "/skill",
        insert: "/skill ",
        description: "Target a specific skill explicitly",
      },
      ...skills.map((skill) => ({
        label: `/${skill.id}`,
        insert: `/${skill.id} `,
        description:
          skill.description ||
          (skill.tools.length > 0 ? `Tools: ${skill.tools.join(", ")}` : skill.name),
      })),
    ]
      .filter((command) => command.label.toLowerCase().includes(`/${slashQuery.toLowerCase()}`))
      .slice(0, 10);
  }, [skills, slashQuery]);

  const attachExistingFile = async (path: string) => {
    const file = await blobToFile(path);
    await aui.composer().addAttachment(file);
    aui.composer().setText(
      text.replace(/(?:^|\s)@([^\s]*)$/, (match: string) =>
        match.replace(/@[^\s]*$/, `@${path}`),
      ) + " ",
    );
  };

  const setSlashCommand = (value: string) => {
    aui.composer().setText(value);
  };

  return (
    <Composer.Root className="relative">
      {canAttach && (
        <Composer.Attachments
          components={{
            Attachment: AttachmentUI,
          }}
        />
      )}

      {canAttach && (
        <Composer.AddAttachment />
      )}

      <div className="relative flex-1">
        <Composer.Input autoFocus placeholder="Message Overseer..." />

        {mentionQuery !== null && (
          <div className="absolute left-0 right-0 bottom-full mb-2 rounded-xl border border-border bg-card shadow-2xl max-h-56 overflow-y-auto z-20">
            <div className="px-3 py-2 text-xs text-muted-foreground border-b border-border">
              Attach from Files using @
            </div>

            {isLoadingFiles ? (
              <div className="px-3 py-3 text-sm text-muted-foreground">Loading files...</div>
            ) : filteredFiles.length === 0 ? (
              <div className="px-3 py-3 text-sm text-muted-foreground">No matching files</div>
            ) : (
              <div className="py-1">
                {filteredFiles.map((path) => (
                  <button
                    key={path}
                    type="button"
                    onClick={() => void attachExistingFile(path)}
                    className="w-full text-left px-3 py-2 hover:bg-primary transition-colors"
                  >
                    <div className="text-sm text-foreground truncate">{path.split("/").pop()}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{path}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {slashQuery !== null && mentionQuery === null && (
          <div className="absolute left-0 right-0 bottom-full mb-2 rounded-xl border border-border bg-card shadow-2xl max-h-56 overflow-y-auto z-20">
            <div className="px-3 py-2 text-xs text-muted-foreground border-b border-border">
              Skills commands
            </div>

            {isLoadingSkills ? (
              <div className="px-3 py-3 text-sm text-muted-foreground">Loading skills...</div>
            ) : slashCommands.length === 0 ? (
              <div className="px-3 py-3 text-sm text-muted-foreground">No matching commands</div>
            ) : (
              <div className="py-1">
                {slashCommands.map((command) => (
                  <button
                    key={command.label}
                    type="button"
                    onClick={() => setSlashCommand(command.insert)}
                    className="w-full text-left px-3 py-2 hover:bg-primary transition-colors"
                  >
                    <div className="flex items-center gap-2 text-sm text-foreground truncate">
                      <SlashIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{command.label}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate ml-5">
                      {command.description}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <Composer.Action />
    </Composer.Root>
  );
}
