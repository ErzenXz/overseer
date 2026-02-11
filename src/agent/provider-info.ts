// Provider information - client-safe (no server dependencies)
// Vercel AI SDK v6 compatible provider configurations

export type ProviderName =
  | "openai"
  | "anthropic"
  | "google"
  | "azure"
  | "groq"
  | "ollama"
  | "openai-compatible"
  | "cohere"
  | "mistral"
  | "xai"
  | "perplexity"
  | "fireworks"
  | "togetherai"
  | "deepinfra"
  | "deepseek"
  | "amazon-bedrock";

export const PROVIDER_INFO: Record<
  ProviderName,
  {
    displayName: string;
    requiresKey: boolean;
    models: string[];
    description: string;
    npm: string;
    supportsThinking: boolean; // Extended thinking support
  }
> = {
  openai: {
    displayName: "OpenAI",
    requiresKey: true,
    models: [
      "gpt-4.1",
      "gpt-4.1-mini",
      "gpt-4.1-nano",
      "o4-mini",
      "o3",
      "gpt-4o",
      "gpt-4o-mini",
      "o1",
      "o1-mini",
      "o3-mini",
      "gpt-4-turbo",
      "gpt-4",
      "gpt-3.5-turbo",
    ],
    description: "OpenAI GPT models with o1/o3 reasoning",
    npm: "@ai-sdk/openai",
    supportsThinking: false, // o1/o3 have built-in reasoning
  },
  anthropic: {
    displayName: "Anthropic Claude",
    requiresKey: true,
    models: [
      "claude-4-opus-20250514",
      "claude-4-sonnet-20250514",
      "claude-3-5-sonnet-latest",
      "claude-3-5-sonnet-20241022",
      "claude-3-opus-latest",
      "claude-3-haiku-latest",
      "claude-3-5-haiku-20241022",
    ],
    description: "Claude models with extended thinking support",
    npm: "@ai-sdk/anthropic",
    supportsThinking: true, // Claude 3.5 Sonnet/Haiku support extended thinking
  },
  google: {
    displayName: "Google AI",
    requiresKey: true,
    models: [
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-1.5-pro",
      "gemini-1.5-flash",
      "gemini-pro",
    ],
    description: "Google Gemini models",
    npm: "@ai-sdk/google",
    supportsThinking: false,
  },
  azure: {
    displayName: "Azure OpenAI",
    requiresKey: true,
    models: ["gpt-4o", "gpt-4", "gpt-35-turbo"],
    description: "Azure OpenAI Service",
    npm: "@ai-sdk/azure",
    supportsThinking: false,
  },
  groq: {
    displayName: "Groq",
    requiresKey: true,
    models: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "llama-3.1-70b-versatile",
      "mixtral-8x7b-32768",
      "gemma2-9b-it",
    ],
    description: "Ultra-fast inference with Groq",
    npm: "@ai-sdk/groq",
    supportsThinking: false,
  },
  ollama: {
    displayName: "Ollama (Local)",
    requiresKey: false,
    models: [
      "llama3.2",
      "llama3.1",
      "mistral",
      "mixtral",
      "codellama",
      "qwen2.5",
      "deepseek-coder",
      "phi3",
    ],
    description: "Run models locally with Ollama",
    npm: "@ai-sdk/openai",
    supportsThinking: false,
  },
  "openai-compatible": {
    displayName: "OpenAI-Compatible",
    requiresKey: true,
    models: ["custom-model"],
    description: "Any OpenAI-compatible API (vLLM, TGI, etc.)",
    npm: "@ai-sdk/openai",
    supportsThinking: false,
  },
  cohere: {
    displayName: "Cohere",
    requiresKey: true,
    models: ["command-r-plus", "command-r", "command"],
    description: "Cohere Command and R series models",
    npm: "@ai-sdk/cohere",
    supportsThinking: false,
  },
  mistral: {
    displayName: "Mistral",
    requiresKey: true,
    models: ["mistral-large-latest", "mistral-small-latest", "ministral-8b-latest"],
    description: "Mistral chat and instruction models",
    npm: "@ai-sdk/mistral",
    supportsThinking: false,
  },
  xai: {
    displayName: "xAI (Grok)",
    requiresKey: true,
    models: ["grok-3", "grok-2-latest", "grok-2-vision-latest"],
    description: "xAI Grok models",
    npm: "@ai-sdk/xai",
    supportsThinking: false,
  },
  perplexity: {
    displayName: "Perplexity",
    requiresKey: true,
    models: ["sonar-pro", "sonar-reasoning", "sonar-deep-research"],
    description: "Perplexity Sonar models",
    npm: "@ai-sdk/perplexity",
    supportsThinking: false,
  },
  fireworks: {
    displayName: "Fireworks",
    requiresKey: true,
    models: [
      "accounts/fireworks/models/llama-v3p3-70b-instruct",
      "accounts/fireworks/models/mixtral-8x7b-instruct",
      "accounts/fireworks/models/deepseek-v3",
    ],
    description: "Fireworks hosted models",
    npm: "@ai-sdk/fireworks",
    supportsThinking: false,
  },
  togetherai: {
    displayName: "Together AI",
    requiresKey: true,
    models: [
      "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
      "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
      "Qwen/Qwen2.5-Coder-32B-Instruct",
    ],
    description: "Together AI hosted models",
    npm: "@ai-sdk/togetherai",
    supportsThinking: false,
  },
  deepinfra: {
    displayName: "DeepInfra",
    requiresKey: true,
    models: [
      "meta-llama/Meta-Llama-3.1-70B-Instruct",
      "meta-llama/Meta-Llama-3.1-8B-Instruct",
      "deepseek-ai/DeepSeek-V3",
    ],
    description: "DeepInfra hosted models",
    npm: "@ai-sdk/deepinfra",
    supportsThinking: false,
  },
  deepseek: {
    displayName: "DeepSeek",
    requiresKey: true,
    models: ["deepseek-chat", "deepseek-reasoner"],
    description: "DeepSeek chat and reasoning models",
    npm: "@ai-sdk/deepseek",
    supportsThinking: false,
  },
  "amazon-bedrock": {
    displayName: "Amazon Bedrock",
    requiresKey: true,
    models: [
      "anthropic.claude-3-5-sonnet-20240620-v1:0",
      "anthropic.claude-3-haiku-20240307-v1:0",
      "meta.llama3-70b-instruct-v1:0",
    ],
    description: "Amazon Bedrock hosted models",
    npm: "@ai-sdk/amazon-bedrock",
    supportsThinking: false,
  },
};

/**
 * Models that support extended thinking
 */
export const THINKING_MODELS = [
  "claude-4-opus-20250514",
  "claude-4-sonnet-20250514",
  "claude-3-5-sonnet-latest",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-haiku-latest",
  "claude-3-5-haiku-20241022",
];

/**
 * Check if a model supports extended thinking
 */
export function modelSupportsThinking(modelId: string): boolean {
  return THINKING_MODELS.some((m) => modelId.includes(m)) ||
         modelId.includes("claude-3.5-sonnet") ||
         modelId.includes("claude-3.5-haiku") ||
         modelId.includes("claude-4");
}

/**
 * Get all available providers as array
 */
export function getAllProviders(): Array<{
  id: ProviderName;
  displayName: string;
  requiresKey: boolean;
  models: string[];
  description: string;
  npm: string;
  supportsThinking: boolean;
}> {
  return Object.entries(PROVIDER_INFO).map(([id, info]) => ({
    id: id as ProviderName,
    ...info,
  }));
}
