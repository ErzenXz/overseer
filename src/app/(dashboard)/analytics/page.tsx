import { db } from "@/database";
import { getCostTracker } from "@/lib/cost-tracker";

interface DailyCostRow {
  day: string;
  cost: number;
  requests: number;
  tokens: number;
}

export default function AnalyticsPage() {
  const costTracker = getCostTracker();
  const topUsers = costTracker.getTopUsers(20);

  const dailyRows = db
    .prepare(
      `SELECT
         DATE(created_at) as day,
         COALESCE(SUM(cost_usd), 0) as cost,
         COUNT(*) as requests,
         COALESCE(SUM(input_tokens + output_tokens), 0) as tokens
       FROM cost_tracking
       WHERE created_at >= datetime('now', '-30 day')
       GROUP BY DATE(created_at)
       ORDER BY day DESC`
    )
    .all() as DailyCostRow[];

  const modelRows = db
    .prepare(
      `SELECT
         model,
         COALESCE(SUM(cost_usd), 0) as cost,
         COUNT(*) as requests,
         COALESCE(SUM(input_tokens + output_tokens), 0) as tokens
       FROM cost_tracking
       GROUP BY model
       ORDER BY cost DESC
       LIMIT 20`
    )
    .all() as Array<{ model: string; cost: number; requests: number; tokens: number }>;

  const totalCost = topUsers.reduce((acc, item) => acc + item.totalCost, 0);
  const totalMonthly = topUsers.reduce((acc, item) => acc + item.monthlyCost, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl text-white font-(--font-mono)">Advanced Analytics</h1>
          <p className="text-text-secondary mt-1">Cost, usage and model distribution across all users.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-surface-raised border border-border rounded-lg p-4">
          <p className="text-xs text-text-muted">Total Cost</p>
          <p className="text-2xl text-white mt-1">${totalCost.toFixed(2)}</p>
        </div>
        <div className="bg-surface-raised border border-border rounded-lg p-4">
          <p className="text-xs text-text-muted">Current Month Cost</p>
          <p className="text-2xl text-white mt-1">${totalMonthly.toFixed(2)}</p>
        </div>
        <div className="bg-surface-raised border border-border rounded-lg p-4">
          <p className="text-xs text-text-muted">Tracked Users</p>
          <p className="text-2xl text-white mt-1">{topUsers.length}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-surface-raised border border-border rounded-lg p-5">
          <h2 className="text-sm text-white mb-4">Top Users by Cost</h2>
          <div className="space-y-2">
            {topUsers.map((row) => (
              <div key={row.userId} className="flex items-center justify-between p-2 rounded bg-surface-overlay">
                <div>
                  <p className="text-sm text-white">{row.userId}</p>
                  <p className="text-xs text-text-muted">{row.totalRequests} requests</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-white">${row.totalCost.toFixed(4)}</p>
                  <p className="text-xs text-text-muted">month: ${row.monthlyCost.toFixed(4)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-surface-raised border border-border rounded-lg p-5">
          <h2 className="text-sm text-white mb-4">Model Cost Distribution</h2>
          <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
            {modelRows.map((row) => (
              <div key={row.model} className="flex items-center justify-between p-2 rounded bg-surface-overlay">
                <div>
                  <p className="text-sm text-white">{row.model}</p>
                  <p className="text-xs text-text-muted">{row.requests} requests · {row.tokens.toLocaleString()} tokens</p>
                </div>
                <p className="text-sm text-white">${row.cost.toFixed(4)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 bg-surface-raised border border-border rounded-lg p-5">
        <h2 className="text-sm text-white mb-4">Daily Cost Trend (30 days)</h2>
        <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
          {dailyRows.map((row) => (
            <div key={row.day} className="flex items-center justify-between p-2 rounded bg-surface-overlay">
              <div>
                <p className="text-sm text-white">{row.day}</p>
                <p className="text-xs text-text-muted">{row.requests} requests · {row.tokens.toLocaleString()} tokens</p>
              </div>
              <p className="text-sm text-white">${row.cost.toFixed(4)}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
