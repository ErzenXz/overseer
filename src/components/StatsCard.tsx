interface StatsCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  color: "indigo" | "green" | "purple" | "orange" | "red" | "blue";
  subtitle?: string;
}

const colorClasses = {
  indigo: "from-indigo-500/20 to-indigo-500/5 border-indigo-500/20",
  green: "from-green-500/20 to-green-500/5 border-green-500/20",
  purple: "from-purple-500/20 to-purple-500/5 border-purple-500/20",
  orange: "from-orange-500/20 to-orange-500/5 border-orange-500/20",
  red: "from-red-500/20 to-red-500/5 border-red-500/20",
  blue: "from-blue-500/20 to-blue-500/5 border-blue-500/20",
};

const iconColorClasses = {
  indigo: "text-indigo-400 bg-indigo-500/10",
  green: "text-green-400 bg-green-500/10",
  purple: "text-purple-400 bg-purple-500/10",
  orange: "text-orange-400 bg-orange-500/10",
  red: "text-red-400 bg-red-500/10",
  blue: "text-blue-400 bg-blue-500/10",
};

export function StatsCard({ title, value, icon, color, subtitle }: StatsCardProps) {
  return (
    <div
      className={`bg-gradient-to-br ${colorClasses[color]} border rounded-xl p-6`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-400">{title}</p>
          <p className="text-2xl font-bold text-white mt-1">{value}</p>
          {subtitle && (
            <p className="text-xs text-zinc-500 mt-1">{subtitle}</p>
          )}
        </div>
        <div className={`p-2 rounded-lg ${iconColorClasses[color]}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}
