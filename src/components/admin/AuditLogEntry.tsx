import { cn } from "@/lib/utils";
import { InfoIcon, AlertTriangleIcon, AlertCircleIcon, BugIcon, ChevronRightIcon, EyeIcon } from "lucide-react";

interface AuditLogEntryProps {
 log: {
  id: number;
  level: string;
  category: string;
  message: string;
  metadata: string | null;
  created_at: string;
 };
 onView?: () => void;
}

const levelStyles: Record<string, { bg: string, text: string, border: string, icon: React.ReactNode }> = {
 debug: {
  bg: "bg-muted",
  text: "text-muted-foreground",
  border: "border-border/50",
  icon: <BugIcon className="w-4 h-4" />
 },
 info: {
  bg: "bg-info/10",
  text: "text-info",
  border: "border-info/20",
  icon: <InfoIcon className="w-4 h-4" />
 },
 warn: {
  bg: "bg-amber-500/10",
  text: "text-amber-500",
  border: "border-amber-500/20",
  icon: <AlertTriangleIcon className="w-4 h-4" />
 },
 error: {
  bg: "bg-destructive/10",
  text: "text-destructive",
  border: "border-destructive/20",
  icon: <AlertCircleIcon className="w-4 h-4" />
 },
};

export function AuditLogEntry({ log, onView }: AuditLogEntryProps) {
 const formatTime = (timestamp: string) => {
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
   month: 'short',
   day: 'numeric',
   hour: '2-digit',
   minute: '2-digit',
   second: '2-digit'
  });
 };

 const metadata = log.metadata ? JSON.parse(log.metadata) : null;
 const style = levelStyles[log.level] || levelStyles.info;

 return (
  <div className="flex items-start gap-4 p-4 sm:px-6 hover:bg-muted/30 transition-colors group">
   <div className={cn("flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ring-1 shadow-sm mt-0.5", style.bg, style.text, style.border)}>
    {style.icon}
   </div>

   <div className="flex-1 min-w-0">
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 mb-1.5">
     <div className="flex items-center gap-2">
      <span className={cn("text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider border shadow-sm", style.bg, style.text, style.border)}>
       {log.level}
      </span>
      <span className="text-[11px] font-medium text-muted-foreground bg-muted/50 px-2 py-0.5 rounded border border-border/50 uppercase tracking-wider">
       {log.category}
      </span>
     </div>
     <span className="text-[11px] font-mono text-muted-foreground flex-shrink-0">
      {formatTime(log.created_at)}
     </span>
    </div>

    <p className="text-sm font-medium text-foreground mb-2 leading-relaxed">{log.message}</p>

    {metadata && (
     <details className="text-xs group/details">
      <summary className="text-muted-foreground cursor-pointer hover:text-foreground inline-flex items-center gap-1.5 transition-colors select-none font-medium outline-none">
       <ChevronRightIcon className="w-3.5 h-3.5 transition-transform group-open/details:rotate-90" />
       View metadata
      </summary>
      <div className="mt-3 pl-5 border-l-2 border-border/50">
       <pre className="p-3 bg-muted/20 border border-border/50 rounded-lg text-muted-foreground overflow-x-auto font-mono text-[11px] leading-relaxed custom-scrollbar shadow-inner">
        {JSON.stringify(metadata, null, 2)}
       </pre>
      </div>
     </details>
    )}
   </div>

   {onView && (
    <button
     onClick={onView}
     className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
     aria-label="View details"
     title="View details"
    >
     <EyeIcon className="w-4 h-4" />
    </button>
   )}
  </div>
 );
}
