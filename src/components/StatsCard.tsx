interface StatsCardProps {
 title: string;
 value: string | number;
 icon: React.ReactNode;
 color?: "accent" | "success" | "warning" | "danger" | "info";
 subtitle?: string;
}

const colorStyles = {
 accent: "text-primary bg-primary/10 ring-primary/20",
 success: "text-green-500 bg-green-500/10 ring-green-500/20",
 warning: "text-yellow-500 bg-yellow-500/10 ring-yellow-500/20",
 danger: "text-red-500 bg-red-500/10 ring-red-500/20",
 info: "text-blue-500 bg-blue-500/10 ring-blue-500/20",
};

export function StatsCard({ title, value, icon, color = "accent", subtitle }: StatsCardProps) {
 return (
  <div className="card-hover group flex flex-col rounded-xl border border-border bg-card p-6 shadow-sm">
   <div className="flex items-center gap-4">
    <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ring-1 ${colorStyles[color]} transition-colors duration-200`}>
     {icon}
    </div>
    <div className="flex flex-col min-w-0">
     <p className="text-sm font-medium text-muted-foreground truncate">{title}</p>
     <p className="text-3xl font-semibold tracking-tight text-foreground mt-1 tabular-nums">{value}</p>
    </div>
   </div>
   {subtitle && (
    <div className="mt-4 pt-4 border-t border-border/50">
     <p className="text-xs text-muted-foreground">{subtitle}</p>
    </div>
   )}
  </div>
 );
}
