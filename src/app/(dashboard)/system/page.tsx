"use client";

import { useState } from "react";
import { StatsCard } from "@/components/StatsCard";
import { settingsModel } from "@/database/models/system";

export default function SystemSettingsPage() {
  const allSettings = settingsModel.getAll();
  
  // Group settings by category
  const settingsByCategory: Record<string, typeof allSettings> = {
    agent: allSettings.filter(s => s.key.startsWith("agent.")),
    tools: allSettings.filter(s => s.key.startsWith("tools.")),
    ui: allSettings.filter(s => s.key.startsWith("ui.")),
    security: allSettings.filter(s => s.key.startsWith("security.")),
    quota: allSettings.filter(s => s.key.startsWith("quota.")),
  };

  const [editingSetting, setEditingSetting] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const handleEdit = (key: string, currentValue: string) => {
    setEditingSetting(key);
    setEditValue(currentValue);
  };

  const handleSave = () => {
    // In production, this would save to database
    console.log("Saving", editingSetting, editValue);
    setEditingSetting(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">System Settings</h1>
          <p className="text-zinc-400 mt-1">Configure global system behavior and limits</p>
        </div>
        <div className="flex gap-3">
          <button className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-medium rounded-lg transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Reset to Defaults
          </button>
          <button className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Save All Changes
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatsCard
          title="Total Settings"
          value={allSettings.length}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          }
          color="indigo"
        />
        <StatsCard
          title="Agent Settings"
          value={settingsByCategory.agent.length}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          }
          color="green"
        />
        <StatsCard
          title="Tool Settings"
          value={settingsByCategory.tools.length}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
          }
          color="purple"
        />
        <StatsCard
          title="Security Settings"
          value={settingsByCategory.security.length || 0}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          }
          color="red"
        />
      </div>

      {/* Agent Settings */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-6">
        <h2 className="text-lg font-semibold text-white mb-4">Agent Configuration</h2>
        <div className="space-y-4">
          {settingsByCategory.agent.map((setting) => (
            <div key={setting.key} className="flex items-center justify-between p-4 bg-zinc-800/30 rounded-lg">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-sm font-medium text-white">{setting.key}</h3>
                </div>
                {setting.description && (
                  <p className="text-xs text-zinc-500">{setting.description}</p>
                )}
              </div>
              {editingSetting === setting.key ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="px-3 py-1 bg-zinc-900 border border-zinc-700 rounded text-white text-sm focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    onClick={handleSave}
                    className="px-3 py-1 text-xs text-green-400 bg-green-500/10 hover:bg-green-500/20 rounded transition-colors"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingSetting(null)}
                    className="px-3 py-1 text-xs text-zinc-400 hover:text-white rounded transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <code className="text-sm text-indigo-400 px-3 py-1 bg-indigo-500/10 rounded">
                    {setting.value}
                  </code>
                  <button
                    onClick={() => handleEdit(setting.key, setting.value)}
                    className="px-3 py-1 text-xs text-zinc-400 hover:text-white hover:bg-zinc-700 rounded transition-colors"
                  >
                    Edit
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Tool Settings */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-6">
        <h2 className="text-lg font-semibold text-white mb-4">Tool Configuration</h2>
        <div className="space-y-4">
          {settingsByCategory.tools.map((setting) => (
            <div key={setting.key} className="flex items-center justify-between p-4 bg-zinc-800/30 rounded-lg">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-sm font-medium text-white">{setting.key}</h3>
                </div>
                {setting.description && (
                  <p className="text-xs text-zinc-500">{setting.description}</p>
                )}
              </div>
              {editingSetting === setting.key ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="px-3 py-1 bg-zinc-900 border border-zinc-700 rounded text-white text-sm focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    onClick={handleSave}
                    className="px-3 py-1 text-xs text-green-400 bg-green-500/10 hover:bg-green-500/20 rounded transition-colors"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingSetting(null)}
                    className="px-3 py-1 text-xs text-zinc-400 hover:text-white rounded transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <code className="text-sm text-purple-400 px-3 py-1 bg-purple-500/10 rounded">
                    {setting.value}
                  </code>
                  <button
                    onClick={() => handleEdit(setting.key, setting.value)}
                    className="px-3 py-1 text-xs text-zinc-400 hover:text-white hover:bg-zinc-700 rounded transition-colors"
                  >
                    Edit
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Quota & Rate Limits */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-6">
        <h2 className="text-lg font-semibold text-white mb-4">Quota & Rate Limits</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {["free", "pro", "enterprise"].map((tier) => (
            <div key={tier} className="p-4 bg-zinc-800/30 rounded-lg border-l-4 border-indigo-500">
              <h3 className="font-medium text-white capitalize mb-3">{tier} Tier</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Messages/day</span>
                  <span className="text-white font-medium">
                    {tier === "free" ? "100" : tier === "pro" ? "1,000" : "Unlimited"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Tokens/day</span>
                  <span className="text-white font-medium">
                    {tier === "free" ? "50K" : tier === "pro" ? "500K" : "Unlimited"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Sessions</span>
                  <span className="text-white font-medium">
                    {tier === "free" ? "5" : tier === "pro" ? "50" : "Unlimited"}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Dangerous Operations */}
      <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6">
        <div className="flex items-start gap-3 mb-4">
          <svg className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <h3 className="text-sm font-medium text-red-400 mb-1">Dangerous Operations</h3>
            <p className="text-sm text-zinc-400">
              These operations can significantly impact system behavior. Use with caution.
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <button className="px-4 py-2 text-sm text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-lg transition-colors">
            Clear All Caches
          </button>
          <button className="px-4 py-2 text-sm text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-lg transition-colors">
            Reset Database
          </button>
          <button className="px-4 py-2 text-sm text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-lg transition-colors">
            Revoke All Sessions
          </button>
        </div>
      </div>
    </div>
  );
}
