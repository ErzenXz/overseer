import { loadSoul, isUsingCustomSoul, getDefaultSoul } from "@/agent";
import { SoulEditor } from "./SoulEditor";

export default function SoulPage() {
  const soul = loadSoul();
  const isCustom = isUsingCustomSoul();
  const defaultSoul = getDefaultSoul();

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Soul Document</h1>
        <p className="text-zinc-400 mt-1">
          Define your AI agent's personality, values, and behavior
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <SoulEditor initialContent={soul} isCustom={isCustom} defaultSoul={defaultSoul} />
        </div>

        <div className="space-y-6">
          {/* Info Card */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">About SOUL.md</h2>
            <div className="space-y-3 text-sm text-zinc-400">
              <p>
                The SOUL.md document defines your AI agent's core identity, values, and behavior guidelines.
              </p>
              <p>
                This document is included in every conversation as part of the system prompt, ensuring consistent personality across all interactions.
              </p>
              <a
                href="https://soul.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300"
              >
                Learn more about SOUL.md
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          </div>

          {/* Sections Guide */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Recommended Sections</h2>
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-2">
                <span className="text-indigo-400">•</span>
                <div>
                  <span className="text-zinc-300">Identity</span>
                  <p className="text-zinc-500">Who is the agent?</p>
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-400">•</span>
                <div>
                  <span className="text-zinc-300">Core Values</span>
                  <p className="text-zinc-500">What principles guide behavior?</p>
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-400">•</span>
                <div>
                  <span className="text-zinc-300">Capabilities</span>
                  <p className="text-zinc-500">What can the agent do?</p>
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-400">•</span>
                <div>
                  <span className="text-zinc-300">Boundaries</span>
                  <p className="text-zinc-500">What should it avoid?</p>
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-400">•</span>
                <div>
                  <span className="text-zinc-300">Communication Style</span>
                  <p className="text-zinc-500">How should it respond?</p>
                </div>
              </li>
            </ul>
          </div>

          {/* Status */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Status</h2>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Source</span>
                <span className={isCustom ? "text-green-400" : "text-zinc-300"}>
                  {isCustom ? "Custom" : "Default"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Characters</span>
                <span className="text-zinc-300">{soul.length.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Lines</span>
                <span className="text-zinc-300">{soul.split("\n").length}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
