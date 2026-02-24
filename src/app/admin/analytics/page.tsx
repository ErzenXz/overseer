"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";

interface DailyData {
  day: string;
  cost: number;
  requests: number;
  tokens: number;
}

interface ModelData {
  model: string;
  cost: number;
  requests: number;
  tokens: number;
}

interface UserData {
  userId: string;
  totalCost: number;
  monthlyCost: number;
  totalRequests: number;
}

interface AnalyticsData {
  dailyData: DailyData[];
  modelData: ModelData[];
  topUsers: UserData[];
  convStats: { total: number; tokens: number; messages: number };
  memoryStats: { total: number; byCategory: Record<string, number>; avgImportance: number };
  subAgentStats: { total: number; by_type: Record<string, number>; completed: number; error: number; working: number };
  contextStats: { totalSummaries: number };
  systemHealth: { api: string; database: string; uptime: number; memoryUsage: { heapUsed: number; heapTotal: number; rss: number } };
}

export default function AnalyticsPage() {
  const [timeRange, setTimeRange] = useState<"7" | "30" | "90">("30");

  const { data: rawData, isLoading: loading, error: queryError, refetch } = trpc.analytics.get.useQuery(
    { days: Number(timeRange) },
    { staleTime: 60 * 1000 }
  );

  const data = useMemo((): AnalyticsData | null => {
    if (!rawData) return null;
    return {
      dailyData: rawData.dailyData.map((d) => ({
        day: String(d.day ?? ""),
        cost: Number(d.cost ?? 0),
        requests: Number(d.requests ?? 0),
        tokens: Number(d.tokens ?? 0),
      })),
      modelData: rawData.modelData.map((m) => ({
        model: String(m.model ?? ""),
        cost: Number(m.cost ?? 0),
        requests: Number(m.requests ?? 0),
        tokens: Number(m.tokens ?? 0),
      })),
      topUsers: rawData.topUsers.map((u: any) => ({
        userId: String(u.userId ?? ""),
        totalCost: Number(u.totalCost ?? 0),
        monthlyCost: Number(u.monthlyCost ?? 0),
        totalRequests: Number(u.totalRequests ?? 0),
      })),
      convStats: {
        total: Number(rawData.convStats?.total ?? 0),
        tokens: Number(rawData.convStats?.tokens ?? 0),
        messages: Number(rawData.convStats?.messages ?? 0),
      },
      memoryStats: {
        total: Number(rawData.memoryStats?.total ?? 0),
        byCategory: (rawData.memoryStats?.byCategory ?? {}) as Record<string, number>,
        avgImportance: Number(rawData.memoryStats?.avgImportance ?? 0),
      },
      subAgentStats: {
        total: Number(rawData.subAgentStats?.total ?? 0),
        by_type: (rawData.subAgentStats?.by_type ?? {}) as Record<string, number>,
        completed: Number(rawData.subAgentStats?.completed ?? 0),
        error: Number(rawData.subAgentStats?.error ?? 0),
        working: Number(rawData.subAgentStats?.working ?? 0),
      },
      contextStats: rawData.contextStats ?? { totalSummaries: 0 },
      systemHealth: rawData.systemHealth,
    };
  }, [rawData]);

  const error = queryError?.message ?? null;
  const loadData = () => refetch();

  const dailyData = data?.dailyData ?? [];
  const modelData = data?.modelData ?? [];
  const userData = data?.topUsers ?? [];

  const totals = useMemo(() => {
    return dailyData.reduce(
      (acc, d) => ({
        cost: acc.cost + d.cost,
        requests: acc.requests + d.requests,
        tokens: acc.tokens + d.tokens,
      }),
      { cost: 0, requests: 0, tokens: 0 },
    );
  }, [dailyData]);

  const avgDailyCost = totals.cost / Math.max(dailyData.length, 1);

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <p className="text-red-400 text-lg font-medium">Failed to load analytics</p>
          <p className="text-[var(--color-text-secondary)] text-sm mt-1">{error}</p>
          <button onClick={loadData} className="mt-4 px-4 py-2 bg-[var(--color-accent)] text-white rounded-lg text-sm">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Comprehensive insights into your AI agent usage and costs
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center justify-center w-9 h-9 rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground shadow-sm transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            title="Refresh"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={loading ? "animate-spin" : "text-muted-foreground"}>
              <path d="M13.65 2.35A7.95 7.95 0 008 0C3.58 0 .01 3.58.01 8S3.58 16 8 16c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 018 14 6 6 0 1114 8h-3l4 4 4-4h-3a8 8 0 00-2.35-5.65z" fill="currentColor" transform="scale(0.9) translate(1,1)" />
            </svg>
          </button>
          <div className="flex items-center gap-1 bg-muted/30 border border-border/50 rounded-lg p-1 shadow-sm">
            {(["7", "30", "90"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setTimeRange(d)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-all duration-200 ${
                  timeRange === d
                    ? "bg-background text-foreground shadow-sm ring-1 ring-border/50"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                {d}D
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && !data ? (
        <div className="space-y-6">
          {/* Skeleton loaders */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-6 shadow-sm animate-pulse">
                <div className="h-4 bg-muted/50 rounded w-20 mb-4" />
                <div className="h-8 bg-muted/50 rounded w-24" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 rounded-xl border border-border bg-card shadow-sm p-6 h-80 animate-pulse flex flex-col justify-between">
              <div className="h-5 bg-muted/50 rounded w-32" />
              <div className="h-full mt-6 bg-muted/30 rounded" />
            </div>
            <div className="rounded-xl border border-border bg-card shadow-sm p-6 h-80 animate-pulse flex flex-col justify-between">
              <div className="h-5 bg-muted/50 rounded w-32" />
              <div className="flex-1 mt-6 rounded-full bg-muted/30 mx-8 my-4" />
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <KpiCard
              title="Total Cost"
              value={`$${totals.cost.toFixed(2)}`}
              icon={<DollarIcon />}
              accent="green"
            />
            <KpiCard
              title="Total Requests"
              value={totals.requests.toLocaleString()}
              icon={<RequestIcon />}
              accent="blue"
            />
            <KpiCard
              title="Total Tokens"
              value={formatNumber(totals.tokens)}
              icon={<TokenIcon />}
              accent="purple"
            />
            <KpiCard
              title="Avg Daily Cost"
              value={`$${avgDailyCost.toFixed(3)}`}
              subValue={`${dailyData.length} days tracked`}
              icon={<AvgIcon />}
              accent="amber"
            />
          </div>

          {/* Main Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Cost Trend Chart */}
            <div className="lg:col-span-2 rounded-xl border border-border bg-card shadow-sm p-6 flex flex-col hover:border-primary/50 transition-colors duration-200">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-base font-semibold tracking-tight text-foreground">Cost Trend</h2>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest bg-muted/50 px-2 py-1 rounded border border-border/50">
                  {dailyData.length} days
                </span>
              </div>
              <div className="h-64 mt-auto">
                <AreaChart data={dailyData} dataKey="cost" color="hsl(var(--primary))" label="$" />
              </div>
            </div>

            {/* Model Distribution */}
            <div className="rounded-xl border border-border bg-card shadow-sm p-6 flex flex-col hover:border-primary/50 transition-colors duration-200">
              <h2 className="text-base font-semibold tracking-tight text-foreground mb-6">Cost by Model</h2>
              <div className="flex-1 flex items-center justify-center min-h-[16rem]">
                <DonutChart data={modelData.slice(0, 6)} />
              </div>
            </div>
          </div>

          {/* Usage Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-xl border border-border bg-card shadow-sm p-6 flex flex-col hover:border-primary/50 transition-colors duration-200">
              <h2 className="text-base font-semibold tracking-tight text-foreground mb-6">Requests per Day</h2>
              <div className="h-44 mt-auto">
                <BarChart data={dailyData} dataKey="requests" color="hsl(var(--chart-1))" />
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card shadow-sm p-6 flex flex-col hover:border-primary/50 transition-colors duration-200">
              <h2 className="text-base font-semibold tracking-tight text-foreground mb-6">Token Usage</h2>
              <div className="h-44 mt-auto">
                <AreaChart data={dailyData} dataKey="tokens" color="hsl(var(--chart-2))" label="" />
              </div>
            </div>
          </div>

          {/* Detailed Tables Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top Users */}
            <div className="rounded-xl border border-border bg-card shadow-sm p-6 flex flex-col hover:border-primary/50 transition-colors duration-200">
              <h2 className="text-base font-semibold tracking-tight text-foreground mb-6">Top Users by Cost</h2>
              {userData.length === 0 ? (
                <EmptyState text="No user data yet" />
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto pr-2 custom-scrollbar">
                  {userData.slice(0, 10).map((user, i) => (
                    <div
                      key={user.userId}
                      className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 border border-border/50 group hover:bg-muted/40 transition-colors"
                    >
                      <span className="w-6 h-6 flex items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0 ring-1 ring-primary/20">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{user.userId}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {user.totalRequests.toLocaleString()} requests
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold text-foreground">${user.totalCost.toFixed(4)}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          ${user.monthlyCost.toFixed(4)}/mo
                        </p>
                      </div>
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden shrink-0">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${(user.totalCost / Math.max(userData[0]?.totalCost || 1, 1)) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Model Details */}
            <div className="rounded-xl border border-border bg-card shadow-sm p-6 flex flex-col hover:border-primary/50 transition-colors duration-200">
              <h2 className="text-base font-semibold tracking-tight text-foreground mb-6">Model Breakdown</h2>
              {modelData.length === 0 ? (
                <EmptyState text="No model data yet" />
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto pr-2 custom-scrollbar">
                  {modelData.slice(0, 10).map((model, i) => {
                    const costPerMillion = (model.cost / Math.max(model.tokens, 1)) * 1_000_000;
                    return (
                      <div
                        key={model.model}
                        className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 border border-border/50 hover:bg-muted/40 transition-colors"
                      >
                        <span className="w-6 h-6 flex items-center justify-center rounded-full bg-chart-1/10 text-chart-1 text-xs font-bold shrink-0 ring-1 ring-chart-1/20">
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{model.model}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                            <span>{model.requests.toLocaleString()} req</span>
                            <span className="w-1 h-1 rounded-full bg-border" />
                            <span>{formatNumber(model.tokens)} tok</span>
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-semibold text-foreground">${model.cost.toFixed(4)}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            ${costPerMillion.toFixed(2)}/1M
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Agent, Memory & System Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <StatsCard
              title="Sub-Agents"
              icon={<AgentIcon />}
              accentClass="bg-chart-1/10 text-chart-1 ring-1 ring-chart-1/20"
              items={[
                { label: "Total spawned", value: data?.subAgentStats?.total ?? 0 },
                { label: "Completed", value: data?.subAgentStats?.completed ?? 0 },
                { label: "Errors", value: data?.subAgentStats?.error ?? 0 },
                { label: "Working", value: data?.subAgentStats?.working ?? 0 },
              ]}
            />
            <StatsCard
              title="Memory"
              icon={<MemoryIcon />}
              accentClass="bg-purple-500/20 text-purple-400"
              items={[
                { label: "Total entries", value: data?.memoryStats?.total ?? 0 },
                { label: "Avg importance", value: (data?.memoryStats?.avgImportance ?? 0).toFixed(1) },
                ...Object.entries(data?.memoryStats?.byCategory ?? {}).map(([cat, count]) => ({
                  label: cat.charAt(0).toUpperCase() + cat.slice(1),
                  value: count as number,
                })),
              ]}
            />
            <StatsCard
              title="System"
              icon={<SystemIcon />}
              accentClass="bg-green-500/20 text-green-400"
              items={[
                { label: "API Status", value: "Healthy", status: "good" as const },
                { label: "Database", value: "Connected", status: "good" as const },
                { label: "Conversations", value: data?.convStats?.total ?? 0 },
                { label: "Total messages", value: data?.convStats?.messages ?? 0 },
                { label: "Uptime", value: data?.systemHealth?.uptime ? formatUptime(data.systemHealth.uptime) : "N/A" },
                { label: "Heap used", value: data?.systemHealth?.memoryUsage?.heapUsed ? formatBytes(data.systemHealth.memoryUsage.heapUsed) : "N/A" },
              ]}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────

function KpiCard({
  title,
  value,
  icon,
  accent,
  subValue,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  accent: string;
  subValue?: string;
}) {
  const accentColors: Record<string, string> = {
    green: "text-success bg-success/10 ring-1 ring-success/20",
    blue: "text-chart-1 bg-chart-1/10 ring-1 ring-chart-1/20",
    purple: "text-chart-2 bg-chart-2/10 ring-1 ring-chart-2/20",
    amber: "text-warning bg-warning/10 ring-1 ring-warning/20",
  };

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm hover:border-primary/50 transition-colors duration-200 flex flex-col">
      <div className="flex items-center gap-3 mb-4">
        <span className={cn("w-10 h-10 flex items-center justify-center rounded-lg shrink-0", accentColors[accent] ?? "text-foreground bg-muted")}>
          {icon}
        </span>
        <h3 className="text-sm font-semibold tracking-tight text-foreground line-clamp-1">{title}</h3>
      </div>
      <div className="mt-auto">
        <p className="text-3xl font-bold tracking-tight text-foreground tabular-nums">{value}</p>
        {subValue && <p className="text-[11px] font-medium text-muted-foreground mt-1.5 uppercase tracking-wider">{subValue}</p>}
      </div>
    </div>
  );
}

function AreaChart({
  data,
  dataKey,
  color,
  label,
}: {
  data: DailyData[];
  dataKey: keyof DailyData;
  color: string;
  label: string;
}) {
  if (data.length === 0) return <EmptyState text="No data for this period" />;

  const values = data.map((d) => Number(d[dataKey]));
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;

  const W = 400;
  const H = 160;
  const PAD = { top: 20, right: 10, bottom: 28, left: 50 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const points = values.map((v, i) => ({
    x: PAD.left + (i / Math.max(data.length - 1, 1)) * chartW,
    y: PAD.top + chartH - ((v - min) / range) * chartH,
    v,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${PAD.top + chartH} L ${PAD.left} ${PAD.top + chartH} Z`;

  // Y-axis grid lines (4 steps)
  const gridSteps = 4;
  const gridLines = Array.from({ length: gridSteps + 1 }, (_, i) => {
    const val = min + (range / gridSteps) * i;
    const y = PAD.top + chartH - (i / gridSteps) * chartH;
    return { y, label: label === "$" ? `$${val.toFixed(val < 1 ? 3 : 1)}` : formatNumber(val) };
  });

  return (
    <div className="w-full h-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={`area-grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {gridLines.map((g, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={g.y} x2={W - PAD.right} y2={g.y} stroke="var(--color-border)" strokeWidth="0.5" strokeDasharray="4 4" />
            <text x={PAD.left - 6} y={g.y + 3} textAnchor="end" fontSize="8" fill="var(--color-text-secondary)" fontFamily="system-ui">{g.label}</text>
          </g>
        ))}

        {/* Area + Line */}
        <path d={areaPath} fill={`url(#area-grad-${dataKey})`} />
        <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

        {/* Data points */}
        {points.filter((_, i) => data.length <= 15 || i % Math.ceil(data.length / 10) === 0).map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3" fill={color} stroke="var(--color-surface-raised)" strokeWidth="1.5" />
        ))}

        {/* X-axis labels */}
        {data.length > 0 && (
          <>
            <text x={PAD.left} y={H - 4} fontSize="8" fill="var(--color-text-secondary)" fontFamily="system-ui">{data[0]?.day?.slice(5)}</text>
            {data.length > 2 && (
              <text x={PAD.left + chartW / 2} y={H - 4} textAnchor="middle" fontSize="8" fill="var(--color-text-secondary)" fontFamily="system-ui">{data[Math.floor(data.length / 2)]?.day?.slice(5)}</text>
            )}
            <text x={W - PAD.right} y={H - 4} textAnchor="end" fontSize="8" fill="var(--color-text-secondary)" fontFamily="system-ui">{data[data.length - 1]?.day?.slice(5)}</text>
          </>
        )}
      </svg>
    </div>
  );
}

function BarChart({
  data,
  dataKey,
  color,
}: {
  data: DailyData[];
  dataKey: keyof DailyData;
  color: string;
}) {
  if (data.length === 0) return <EmptyState text="No data for this period" />;

  const values = data.map((d) => Number(d[dataKey]));
  const max = Math.max(...values, 1);

  const W = 400;
  const H = 140;
  const PAD = { top: 12, right: 10, bottom: 24, left: 40 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;
  const gap = 2;
  const barW = Math.max((chartW - gap * (data.length - 1)) / data.length, 2);

  // Y grid
  const gridSteps = 3;
  const gridLines = Array.from({ length: gridSteps + 1 }, (_, i) => {
    const val = (max / gridSteps) * i;
    const y = PAD.top + chartH - (i / gridSteps) * chartH;
    return { y, label: formatNumber(val) };
  });

  return (
    <div className="w-full h-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        {/* Grid */}
        {gridLines.map((g, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={g.y} x2={W - PAD.right} y2={g.y} stroke="var(--color-border)" strokeWidth="0.5" strokeDasharray="4 4" />
            <text x={PAD.left - 4} y={g.y + 3} textAnchor="end" fontSize="8" fill="var(--color-text-secondary)" fontFamily="system-ui">{g.label}</text>
          </g>
        ))}

        {/* Bars */}
        {values.map((v, i) => {
          const barH = (v / max) * chartH;
          const x = PAD.left + i * (barW + gap);
          const y = PAD.top + chartH - barH;
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={barH} fill={color} rx="1" opacity="0.85" />
              <rect x={x} y={y} width={barW} height={Math.min(barH, 3)} fill={color} rx="1" />
            </g>
          );
        })}

        {/* X labels */}
        {data.length > 0 && (
          <>
            <text x={PAD.left} y={H - 4} fontSize="8" fill="var(--color-text-secondary)" fontFamily="system-ui">{data[0]?.day?.slice(5)}</text>
            <text x={W - PAD.right} y={H - 4} textAnchor="end" fontSize="8" fill="var(--color-text-secondary)" fontFamily="system-ui">{data[data.length - 1]?.day?.slice(5)}</text>
          </>
        )}
      </svg>
    </div>
  );
}

function DonutChart({ data }: { data: ModelData[] }) {
  if (data.length === 0) return <EmptyState text="No model data" />;

  const COLORS = ["#22c55e", "#3b82f6", "#a855f7", "#f59e0b", "#ef4444", "#ec4899"];
  const total = data.reduce((s, d) => s + d.cost, 0);
  if (total === 0) return <EmptyState text="No cost data" />;

  const cx = 60, cy = 60, outerR = 50, innerR = 30;
  let angle = -90;

  const arcs = data.map((d, i) => {
    const pct = d.cost / total;
    const sweep = pct * 360;
    const start = angle;
    angle += sweep;
    const end = angle;

    const startRad = (start * Math.PI) / 180;
    const endRad = (end * Math.PI) / 180;
    const largeArc = sweep > 180 ? 1 : 0;

    const x1 = cx + outerR * Math.cos(startRad);
    const y1 = cy + outerR * Math.sin(startRad);
    const x2 = cx + outerR * Math.cos(endRad);
    const y2 = cy + outerR * Math.sin(endRad);
    const x3 = cx + innerR * Math.cos(endRad);
    const y3 = cy + innerR * Math.sin(endRad);
    const x4 = cx + innerR * Math.cos(startRad);
    const y4 = cy + innerR * Math.sin(startRad);

    const path = `M ${x1} ${y1} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4} Z`;
    return { path, color: COLORS[i % COLORS.length], model: d.model, cost: d.cost, pct };
  });

  return (
    <div className="flex items-center gap-4 w-full">
      <div className="relative shrink-0">
        <svg viewBox="0 0 120 120" className="w-32 h-32">
          {arcs.map((a, i) => (
            <path key={i} d={a.path} fill={a.color} stroke="var(--color-surface-raised)" strokeWidth="1" />
          ))}
          <text x={cx} y={cy - 4} textAnchor="middle" fontSize="12" fontWeight="bold" fill="white" fontFamily="system-ui">
            ${total.toFixed(2)}
          </text>
          <text x={cx} y={cy + 10} textAnchor="middle" fontSize="7" fill="var(--color-text-secondary)" fontFamily="system-ui">
            total
          </text>
        </svg>
      </div>
      <div className="space-y-1.5 flex-1 min-w-0">
        {arcs.map((a, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: a.color }} />
            <span className="text-xs text-white truncate flex-1">{a.model.split("/").pop()}</span>
            <span className="text-xs text-[var(--color-text-secondary)] shrink-0">{(a.pct * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatsCard({
  title,
  icon,
  accentClass,
  items,
}: {
  title: string;
  icon: React.ReactNode;
  accentClass: string;
  items: Array<{ label: string; value: string | number; status?: "good" | "warning" | "bad" }>;
}) {
  const statusColors = { good: "bg-success", warning: "bg-warning", bad: "bg-destructive" };

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm p-6 hover:border-primary/50 transition-colors duration-200">
      <div className="flex items-center gap-3 mb-6">
        <span className={cn("w-9 h-9 flex items-center justify-center rounded-lg", accentClass)}>
          {icon}
        </span>
        <h3 className="text-base font-semibold tracking-tight text-foreground">{title}</h3>
      </div>
      <div className="space-y-3">
        {items.map((item, i) => (
          <div key={i} className="flex items-center justify-between p-2 rounded-md bg-muted/20 border border-border/50">
            <span className="text-xs font-medium text-foreground">{item.label}</span>
            <div className="flex items-center gap-2">
              {item.status && <span className={cn("w-1.5 h-1.5 rounded-full", statusColors[item.status])} />}
              <span className="text-xs font-mono text-muted-foreground bg-background px-1.5 py-0.5 rounded border border-border/50">{item.value}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-sm gap-2">
      <svg className="w-8 h-8 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" /></svg>
      {text}
    </div>
  );
}

// ─── Icons (inline SVG) ───────────────────────────────────────────────

function DollarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M10 2v16m4-12.5c0-1.38-1.79-2.5-4-2.5S6 4.12 6 5.5 7.79 8 10 8s4 1.12 4 2.5-1.79 2.5-4 2.5-4-1.12-4-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function RequestIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M4 10h12M10 4v12M7 7l3-3 3 3M7 13l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TokenIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="3" y="3" width="14" height="14" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 8h6M7 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function AvgIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 6v8M7 10h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function AgentIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M9 2L2 6v6l7 4 7-4V6L9 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="9" cy="9" r="2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function MemoryIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M9 2C5.13 2 2 5.13 2 9s3.13 7 7 7 7-3.13 7-7-3.13-7-7-7z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 6v3l2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="2" y="3" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 16h6M9 13v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString();
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + " GB";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(1) + " KB";
  return bytes + " B";
}
