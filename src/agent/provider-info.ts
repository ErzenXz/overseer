// Provider information - client-safe (no server dependencies)
export type ProviderName = "openai" | "anthropic" | "google" | "ollama";

export const PROVIDER_INFO: Record<
  ProviderName,
  {
    displayName: string;
    requiresKey: boolean;
    models: string[];
    description: string;
  }
> = {
  openai: {
    displayName: "OpenAI",
    requiresKey: true,
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo", "o1", "o1-mini", "o1-preview"],
    description: "GPT-4 and GPT-3.5 models from OpenAI",
  },
  anthropic: {
    displayName: "Anthropic",
    requiresKey: true,
    models: ["claude-sonnet-4-20250514", "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"],
    description: "Claude models from Anthropic",
  },
  google: {
    displayName: "Google AI",
    requiresKey: true,
    models: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash", "gemini-pro"],
    description: "Gemini models from Google",
  },
  ollama: {
    displayName: "Ollama (Local)",
    requiresKey: false,
    models: ["llama3.2", "llama3.1", "mistral", "mixtral", "codellama", "deepseek-coder"],
    description: "Run models locally with Ollama",
  },
};
