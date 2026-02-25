import { toolCategories, toolDescriptions } from "@/agent";
import { toolExecutionsModel } from "@/database";
import { cn } from "@/lib/utils";

export default function ToolsPage() {
 const toolStats = toolExecutionsModel.getStats();
 const statsMap = new Map(toolStats.map((s) => [s.tool_name, s]));

 return (
  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
   <div className="flex flex-col gap-1.5">
    <h1 className="text-2xl font-bold tracking-tight text-foreground">Tools</h1>
    <p className="text-sm text-muted-foreground">Available capabilities for your AI agent</p>
   </div>

   <div className="space-y-10">
    {Object.entries(toolCategories).map(([category, tools]) => (
     <div key={category} className="space-y-4">
      <h2 className="text-sm font-semibold tracking-tight text-foreground uppercase tracking-wider flex items-center gap-2">
       <span className="w-1.5 h-1.5 rounded-full bg-primary/80"></span>
       {category} Tools
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
       {tools.map((toolName) => {
        const stats = statsMap.get(toolName);
        return (
         <div
          key={toolName}
          className="card-hover group relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-sm"
         >
          <div className="flex items-start justify-between mb-3">
           <h3 className="font-mono text-sm font-semibold text-foreground tracking-tight">
            {toolName}
           </h3>
           {stats ? (
            <span className="text-[10px] font-mono px-2 py-0.5 bg-primary/10 text-primary rounded-full font-medium tracking-wider uppercase">
             {stats.count} uses
            </span>
           ) : (
            <span className="text-[10px] font-mono px-2 py-0.5 bg-muted text-muted-foreground border border-border rounded-full font-medium uppercase tracking-wider">
             Unused
            </span>
           )}
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
           {toolDescriptions[toolName] || "No description provided."}
          </p>
          {stats && (
           <div className="mt-4 pt-4 border-t border-border/50 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
            <span className="flex items-center gap-1.5">
             Success Rate
            </span>
            <span className={cn(
             "px-1.5 py-0.5 rounded",
             stats.success_rate >= 90 ? "bg-emerald-500/10 text-emerald-500" : 
             stats.success_rate >= 50 ? "bg-amber-500/10 text-amber-500" : 
             "bg-destructive/10 text-destructive"
            )}>
             {stats.success_rate}%
            </span>
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
