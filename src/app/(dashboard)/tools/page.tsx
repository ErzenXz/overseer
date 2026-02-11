import { toolCategories, toolDescriptions } from "@/agent";
import { toolExecutionsModel } from "@/database";

export default function ToolsPage() {
  const toolStats = toolExecutionsModel.getStats();
  const statsMap = new Map(toolStats.map((s) => [s.tool_name, s]));

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-white font-[var(--font-mono)]">Tools</h1>
        <p className="text-[var(--color-text-secondary)] mt-1">Available tools for your AI agent</p>
      </div>

      <div className="space-y-8">
        {Object.entries(toolCategories).map(([category, tools]) => (
          <div key={category}>
            <h2 className="text-lg font-semibold text-white capitalize mb-4">{category} Tools</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {tools.map((toolName) => {
                const stats = statsMap.get(toolName);
                return (
                  <div
                    key={toolName}
                    className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-4"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-medium text-white">{toolName}</h3>
                      {stats && (
                        <span className="text-xs px-2 py-0.5 bg-[var(--color-surface-overlay)] text-[var(--color-text-secondary)] rounded">
                          {stats.count} uses
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-[var(--color-text-secondary)]">
                      {toolDescriptions[toolName] || "No description"}
                    </p>
                    {stats && (
                      <div className="flex items-center gap-4 mt-3 text-xs text-[var(--color-text-muted)]">
                        <span>Success rate: {stats.success_rate}%</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
