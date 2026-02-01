"use client";

import { useState, useEffect } from "react";

interface Provider {
  id: number;
  name: string;
  displayName: string;
  model: string;
  isDefault: boolean;
}

interface ChatHeaderProps {
  conversationId: number | null;
  onNewChat: () => void;
  selectedProviderId: number | null;
  onProviderChange: (providerId: number | null) => void;
}

export function ChatHeader({
  conversationId,
  onNewChat,
  selectedProviderId,
  onProviderChange,
}: ChatHeaderProps) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  useEffect(() => {
    fetchProviders();
  }, []);

  const fetchProviders = async () => {
    try {
      const response = await fetch("/api/chat");
      if (response.ok) {
        const data = await response.json();
        setProviders(data.providers || []);
        
        // Set default provider if none selected
        if (selectedProviderId === null && data.providers?.length > 0) {
          const defaultProvider = data.providers.find((p: Provider) => p.isDefault);
          if (defaultProvider) {
            onProviderChange(defaultProvider.id);
          }
        }
      }
    } catch (error) {
      console.error("Failed to fetch providers:", error);
    }
  };

  const selectedProvider = providers.find((p) => p.id === selectedProviderId);

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-sm">
      {/* Left side - Title */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </div>
        <div>
          <h1 className="text-sm font-semibold text-white">Chat</h1>
          <p className="text-xs text-zinc-500">
            {conversationId ? `Conversation #${conversationId}` : "New conversation"}
          </p>
        </div>
      </div>

      {/* Right side - Actions */}
      <div className="flex items-center gap-2">
        {/* Model selector */}
        <div className="relative">
          <button
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <span className="text-zinc-300">
              {selectedProvider
                ? `${selectedProvider.displayName} (${selectedProvider.model})`
                : "Select model"}
            </span>
            <svg
              className={`w-4 h-4 text-zinc-400 transition-transform ${isDropdownOpen ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Dropdown */}
          {isDropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setIsDropdownOpen(false)}
              />
              <div className="absolute right-0 mt-2 w-64 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-20">
                <div className="py-1">
                  {providers.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-zinc-400">
                      No providers configured
                    </div>
                  ) : (
                    providers.map((provider) => (
                      <button
                        key={provider.id}
                        onClick={() => {
                          onProviderChange(provider.id);
                          setIsDropdownOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-zinc-700 transition-colors ${
                          selectedProviderId === provider.id ? "bg-zinc-700/50" : ""
                        }`}
                      >
                        <div className="flex-1">
                          <div className="text-sm text-white">{provider.displayName}</div>
                          <div className="text-xs text-zinc-400">{provider.model}</div>
                        </div>
                        {provider.isDefault && (
                          <span className="text-xs text-indigo-400">Default</span>
                        )}
                        {selectedProviderId === provider.id && (
                          <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* New chat button */}
        <button
          onClick={onNewChat}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Chat
        </button>
      </div>
    </div>
  );
}
