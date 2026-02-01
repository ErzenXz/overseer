import { interfacesModel } from "@/database";
import { InterfacesList } from "./InterfacesList";
import { AddInterfaceButton } from "./AddInterfaceButton";

export default function InterfacesPage() {
  const interfaces = interfacesModel.findAll();

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Chat Interfaces</h1>
          <p className="text-zinc-400 mt-1">Configure Telegram, Discord, and other chat connections</p>
        </div>
        <AddInterfaceButton />
      </div>

      {interfaces.length === 0 ? (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-12 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-zinc-800 flex items-center justify-center">
            <svg className="w-8 h-8 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-white mb-2">No interfaces configured</h3>
          <p className="text-zinc-400 mb-6">Add a chat interface to start talking to your AI agent</p>
          <AddInterfaceButton variant="primary" />
        </div>
      ) : (
        <InterfacesList interfaces={interfaces} />
      )}

      {/* Setup Instructions */}
      <div className="mt-8 space-y-6">
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Telegram Setup</h2>
          <ol className="space-y-3 text-sm text-zinc-400">
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs">1</span>
              <span>Open Telegram and search for <strong className="text-zinc-300">@BotFather</strong></span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs">2</span>
              <span>Send <code className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-300">/newbot</code> and follow the prompts</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs">3</span>
              <span>Copy the bot token and paste it here</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs">4</span>
              <span>The bot will start automatically when the interface is active</span>
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}
