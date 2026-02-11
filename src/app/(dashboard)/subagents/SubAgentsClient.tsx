"use client";

import { useEffect, useState } from "react";
import { StatsCard } from "@/components/StatsCard";
import { SubAgentsList } from "./SubAgentsList";

interface HealthData {
  timestamp: string;
  overall: {
    health: number;
    status: string;
    degradedAgents: number;
    openCircuits: number;
  };
  agents: Record<string, any>;
  circuitBreakers: {
    summary: {
      closed: number;
      open: number;
      halfOpen: number;
    };
    states: Array<{
      agentType: string;
      state: string;
      failureRate: number;
    }>;
  };
  resourcePools: {
    summary: {
      totalActive: number;
      totalQueued: number;
      totalCompleted: number;
      totalFailed: number;
    };
    pools: Array<any>;
  };
  degradedAgents: Array<{
    type: string;
    reasons: string[];
  }>;
  recommendations: string[];
}

interface SubAgentStats {
  total: number;
  working: number;
  completed: number;
  error: number;
  by_type: Record<string, number>;
}

interface SubAgentsClientProps {
  stats: SubAgentStats;
  allTypes: string[];
}

const subAgentConfigs: Record<string, { name: string; description: string; tools?: string[] }> = {
  code: {
    name: "Code Agent",
    description: "Specializes in code generation, modification, and review",
    tools: ["readFile", "writeFile", "listDirectory", "executeShellCommand"],
  },
  file: {
    name: "File Agent",
    description: "Specializes in file system operations",
    tools: ["readFile", "writeFile", "listDirectory", "executeShellCommand"],
  },
  git: {
    name: "Git Agent",
    description: "Specializes in version control operations",
    tools: ["executeShellCommand"],
  },
  system: {
    name: "System Agent",
    description: "Specializes in system administration",
    tools: ["executeShellCommand"],
  },
  web: {
    name: "Web Agent",
    description: "Specializes in web operations and API calls",
    tools: ["executeShellCommand"],
  },
  docker: {
    name: "Docker Agent",
    description: "Specializes in container management",
    tools: ["executeShellCommand"],
  },
  db: {
    name: "Database Agent",
    description: "Specializes in database operations",
    tools: ["executeShellCommand", "readFile"],
  },
  security: {
    name: "Security Agent",
    description: "Specializes in security operations",
    tools: ["executeShellCommand", "readFile", "listDirectory"],
  },
  network: {
    name: "Network Agent",
    description: "Specializes in network diagnostics",
    tools: ["executeShellCommand"],
  },
  planner: {
    name: "Planner Agent",
    description: "Specializes in task decomposition and planning",
  },
  evaluator: {
    name: "Evaluator Agent",
    description: "Specializes in quality evaluation and review",
  },
  coordinator: {
    name: "Coordinator Agent",
    description: "Specializes in multi-agent coordination",
  },
};

const getSubAgentConfig = (type: string) => subAgentConfigs[type];

export default function SubAgentsClient({ stats, allTypes }: SubAgentsClientProps) {
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchHealthData = async () => {
    try {
      const response = await fetch("/api/subagents/health");
      if (response.ok) {
        const data = await response.json();
        setHealthData(data);
      }
    } catch (error) {
      console.error("Failed to fetch health data:", error);
    }
  };

  useEffect(() => {
    fetchHealthData();

    if (autoRefresh) {
      const interval = setInterval(fetchHealthData, 10000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const handleResetCircuit = async (agentType?: string) => {
    try {
      const response = await fetch("/api/subagents/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reset-circuit",
          agentType,
        }),
      });

      if (response.ok) {
        await fetchHealthData();
      }
    } catch (error) {
      console.error("Failed to reset circuit:", error);
    }
  };

  const getHealthColor = (health: number) => {
    if (health > 90) return "text-green-400";
    if (health > 70) return "text-yellow-400";
    return "text-red-400";
  };

  const getStatusBadge = (status: string) => {
    const colors = {
      healthy: "bg-green-500/10 text-green-400 border-green-500/20",
      degraded: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
      unhealthy: "bg-red-500/10 text-red-400 border-red-500/20",
    };

    return (
      <span
        className={`px-3 py-1 text-xs font-medium rounded-full border ${
          colors[status as keyof typeof colors] || colors.healthy
        }`}
      >
        {status.toUpperCase()}
      </span>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Sub-Agents</h1>
          <p className="text-zinc-400 mt-1">Specialized agents for specific tasks</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
              className="rounded border-zinc-700 bg-zinc-800 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-zinc-900"
            />
            Auto-refresh
          </label>
          <button
            onClick={() => fetchHealthData()}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium rounded-lg transition-colors border border-zinc-700"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Refresh
          </button>
          <a
            href="/subagents/spawn"
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Spawn Sub-Agent
          </a>
        </div>
      </div>

      {healthData && (
        <div className="bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border border-indigo-500/20 rounded-xl p-6 mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white mb-2">System Health</h2>
              <div className="flex items-center gap-4">
                <div className={`text-4xl font-bold ${getHealthColor(healthData.overall.health)}`}>
                  {healthData.overall.health}%
                </div>
                {getStatusBadge(healthData.overall.status)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm text-zinc-400 mb-2">
                Last updated: {new Date(healthData.timestamp).toLocaleTimeString()}
              </div>
              {healthData.overall.degradedAgents > 0 && (
                <div className="text-yellow-400 text-sm">
                  ⚠ {healthData.overall.degradedAgents} degraded agent(s)
                </div>
              )}
              {healthData.overall.openCircuits > 0 && (
                <div className="text-red-400 text-sm">
                  🔴 {healthData.overall.openCircuits} open circuit(s)
                </div>
              )}
            </div>
          </div>

          {healthData.recommendations.length > 0 && (
            <div className="mt-4 pt-4 border-t border-indigo-500/20">
              <h3 className="text-sm font-medium text-white mb-2">Recommendations</h3>
              <ul className="space-y-1">
                {healthData.recommendations.slice(0, 3).map((rec, index) => (
                  <li key={index} className="text-sm text-zinc-300 flex items-start gap-2">
                    <span className="text-indigo-400">•</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatsCard
          title="Total Sub-Agents"
          value={stats.total}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
          }
          color="indigo"
        />
        <StatsCard
          title="Currently Working"
          value={stats.working}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          }
          color="green"
        />
        <StatsCard
          title="Completed Tasks"
          value={stats.completed}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
          color="blue"
        />
        <StatsCard
          title="Errors"
          value={stats.error}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
          color="red"
        />
      </div>

      {healthData && healthData.circuitBreakers.states.length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Circuit Breakers</h2>
            <div className="flex items-center gap-4 text-sm">
              <span className="text-green-400">
                ● {healthData.circuitBreakers.summary.closed} Closed
              </span>
              <span className="text-yellow-400">
                ◐ {healthData.circuitBreakers.summary.halfOpen} Half-Open
              </span>
              <span className="text-red-400">
                ● {healthData.circuitBreakers.summary.open} Open
              </span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {healthData.circuitBreakers.states.map((state) => {
              const stateColors = {
                CLOSED: "border-green-500/30 bg-green-500/5",
                HALF_OPEN: "border-yellow-500/30 bg-yellow-500/5",
                OPEN: "border-red-500/30 bg-red-500/5",
              };

              return (
                <div
                  key={state.agentType}
                  className={`p-4 rounded-lg border ${
                    stateColors[state.state as keyof typeof stateColors]
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-white capitalize">
                      {state.agentType}
                    </span>
                    <span
                      className={`text-xs px-2 py-1 rounded ${
                        state.state === "OPEN"
                          ? "bg-red-500/20 text-red-400"
                          : state.state === "HALF_OPEN"
                          ? "bg-yellow-500/20 text-yellow-400"
                          : "bg-green-500/20 text-green-400"
                      }`}
                    >
                      {state.state}
                    </span>
                  </div>
                  <div className="text-sm text-zinc-400 mb-3">
                    Failure Rate: {(state.failureRate * 100).toFixed(1)}%
                  </div>
                  {state.state === "OPEN" && (
                    <button
                      onClick={() => handleResetCircuit(state.agentType)}
                      className="w-full px-3 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded transition-colors"
                    >
                      Reset Circuit
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {healthData && healthData.resourcePools.summary.totalActive + healthData.resourcePools.summary.totalQueued > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-8">
          <h2 className="text-lg font-semibold text-white mb-4">Resource Pools</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="text-center p-3 bg-zinc-800/50 rounded-lg">
              <div className="text-2xl font-bold text-green-400">
                {healthData.resourcePools.summary.totalActive}
              </div>
              <div className="text-xs text-zinc-400 mt-1">Active</div>
            </div>
            <div className="text-center p-3 bg-zinc-800/50 rounded-lg">
              <div className="text-2xl font-bold text-yellow-400">
                {healthData.resourcePools.summary.totalQueued}
              </div>
              <div className="text-xs text-zinc-400 mt-1">Queued</div>
            </div>
            <div className="text-center p-3 bg-zinc-800/50 rounded-lg">
              <div className="text-2xl font-bold text-blue-400">
                {healthData.resourcePools.summary.totalCompleted}
              </div>
              <div className="text-xs text-zinc-400 mt-1">Completed</div>
            </div>
            <div className="text-center p-3 bg-zinc-800/50 rounded-lg">
              <div className="text-2xl font-bold text-red-400">
                {healthData.resourcePools.summary.totalFailed}
              </div>
              <div className="text-xs text-zinc-400 mt-1">Failed</div>
            </div>
          </div>
        </div>
      )}

      {Object.keys(stats.by_type).length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-8">
          <h2 className="text-lg font-semibold text-white mb-4">Usage by Agent Type</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {Object.entries(stats.by_type).map(([type, count]) => {
              const config = getSubAgentConfig(type);
              const agentHealth = healthData?.agents[type];
              const successRate = agentHealth?.successRate || 0;

              return (
                <div key={type} className="text-center p-4 bg-zinc-800/50 rounded-lg border border-zinc-700">
                  <div className="text-2xl font-bold text-white">{count}</div>
                  <div className="text-sm text-zinc-400 mt-1">{config?.name || type}</div>
                  {agentHealth && (
                    <div className="text-xs mt-2">
                      <span
                        className={`${
                          successRate > 0.9
                            ? "text-green-400"
                            : successRate > 0.7
                            ? "text-yellow-400"
                            : "text-red-400"
                        }`}
                      >
                        {(successRate * 100).toFixed(0)}% success
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-8">
        <h2 className="text-lg font-semibold text-white mb-4">Available Sub-Agent Types</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {allTypes.map((type) => {
            const config = getSubAgentConfig(type);
            const typeIcons: Record<string, string> = {
              code: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4",
              file: "M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z",
              git: "M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22",
              system: "M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01",
              web: "M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9",
              docker: "M20 11c.304 0 .596.02.883.059A9.003 9.003 0 0012 3C6.477 3 2 7.477 2 13c0 4.991 3.657 9.128 8.438 9.879V19a2 2 0 01-2-2v-4a2 2 0 012-2h8",
              db: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4",
              security: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
              network: "M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z",
              planner: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
              evaluator: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
              coordinator: "M4 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 17a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 17a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3z",
            };

            return (
              <div key={type} className="p-4 bg-zinc-800/50 rounded-lg border border-zinc-700">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d={typeIcons[type] || "M12 6v6m0 0v6m0-6h6m-6 0H6"}
                      />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-medium text-white">{config?.name || type}</h3>
                    <p className="text-xs text-zinc-400 mt-1">{config?.description || ""}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs px-2 py-0.5 bg-zinc-700 text-zinc-300 rounded">{type}</span>
                      {config?.tools && <span className="text-xs text-zinc-500">{config.tools.length} tools</span>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl">
        <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Recent Sub-Agents</h2>
          <a href="/subagents/all" className="text-sm text-indigo-400 hover:text-indigo-300">
            View All
          </a>
        </div>
        <SubAgentsList />
      </div>
    </div>
  );
}
