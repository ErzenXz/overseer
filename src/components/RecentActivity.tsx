interface ActivityItem {
 id: number;
 type: string;
 title: string;
 description: string;
 timestamp: string;
 status?: "success" | "error" | "pending";
}

interface RecentActivityProps {
 items: ActivityItem[];
}

export function RecentActivity({ items }: RecentActivityProps) {
 if (items.length === 0) {
  return (
   <div className="text-center py-8 text-muted-foreground">
    No recent activity
   </div>
  );
 }

 return (
  <div className="space-y-2">
   {items.map((item) => (
    <div
     key={item.id}
     className="flex items-start gap-3 p-3 bg-muted rounded-lg"
    >
     <div
      className={`w-1.5 h-1.5 rounded-full mt-2 ${
       item.status === "success"
        ? "bg-green-500"
        : item.status === "error"
        ? "bg-red-500"
        : "bg-muted-foreground"
      }`}
     />
     <div className="flex-1 min-w-0">
      <p className="text-sm font-medium text-foreground">{item.title}</p>
      <p className="text-xs text-muted-foreground truncate">{item.description}</p>
     </div>
     <span className="text-xs text-muted-foreground whitespace-nowrap font-mono">
      {item.timestamp}
     </span>
    </div>
   ))}
  </div>
 );
}
