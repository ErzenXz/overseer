// Provider information - client-safe (no server dependencies)
// Vercel AI SDK v6 compatible provider configurations
// Model capabilities sourced from models.dev (Feb 2026)

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

export type Modality = "text" | "image" | "audio" | "video" | "pdf";

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  maxOutput: number;
  supportsTools: boolean;
  supportsThinking: boolean;
  supportsMultimodal: boolean;
  supportsStreaming: boolean;
  supportsStructuredOutput: boolean;
  reasoning: boolean;
  costTier: "free" | "low" | "medium" | "high" | "premium";
  /** Input modalities accepted */
  inputModalities: Modality[];
  /** Output modalities produced */
  outputModalities: Modality[];
  /** Cost per million input tokens (USD) */
  costPerMillionInput?: number;
  /** Cost per million output tokens (USD) */
  costPerMillionOutput?: number;
  /** Cache read cost per million tokens (USD) */
  cacheCostRead?: number;
  /** Cache write cost per million tokens (USD) */
  cacheCostWrite?: number;
  /** Knowledge cutoff date */
  knowledgeCutoff?: string;
  /** Whether temperature can be set (reasoning models often disallow it) */
  allowsTemperature: boolean;
}

export interface ProviderInfo {
  displayName: string;
  requiresKey: boolean;
  models: ModelInfo[];
  description: string;
  npm: string;
  supportsThinking: boolean;
  supportsMultimodal: boolean;
}

// ---------------------------------------------------------------------------
// Helper to reduce repetition
// ---------------------------------------------------------------------------

function m(partial: Omit<ModelInfo, "supportsStreaming" | "inputModalities" | "outputModalities" | "allowsTemperature" | "supportsStructuredOutput"> & {
  supportsStreaming?: boolean;
  inputModalities?: Modality[];
  outputModalities?: Modality[];
  allowsTemperature?: boolean;
  supportsStructuredOutput?: boolean;
}): ModelInfo {
  return {
    supportsStreaming: true,
    inputModalities: partial.supportsMultimodal ? ["text", "image"] : ["text"],
    outputModalities: ["text"],
    allowsTemperature: !partial.reasoning,
    supportsStructuredOutput: partial.supportsTools,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

export const PROVIDER_INFO: Record<ProviderName, ProviderInfo> = {

  // =========================================================================
  // OpenAI
  // =========================================================================
  openai: {
    displayName: "OpenAI",
    requiresKey: true,
    description: "OpenAI GPT & o-series reasoning models",
    npm: "@ai-sdk/openai",
    supportsThinking: true,
    supportsMultimodal: true,
    models: [
      // --- Flagship ---
      m({
        id: "gpt-4.1",
        name: "GPT-4.1",
        contextWindow: 1_047_576,
        maxOutput: 32_768,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: true,
        reasoning: false,
        costTier: "high",
        inputModalities: ["text", "image"],
        costPerMillionInput: 2.0,
        costPerMillionOutput: 8.0,
        cacheCostRead: 0.5,
        cacheCostWrite: 2.0,
        knowledgeCutoff: "Jun 2025",
      }),
      m({
        id: "gpt-4.1-mini",
        name: "GPT-4.1 Mini",
        contextWindow: 1_047_576,
        maxOutput: 32_768,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: true,
        reasoning: false,
        costTier: "medium",
        inputModalities: ["text", "image"],
        costPerMillionInput: 0.4,
        costPerMillionOutput: 1.6,
        cacheCostRead: 0.1,
        cacheCostWrite: 0.4,
        knowledgeCutoff: "Jun 2025",
      }),
      m({
        id: "gpt-4.1-nano",
        name: "GPT-4.1 Nano",
        contextWindow: 1_047_576,
        maxOutput: 32_768,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: true,
        reasoning: false,
        costTier: "low",
        inputModalities: ["text", "image"],
        costPerMillionInput: 0.1,
        costPerMillionOutput: 0.4,
        cacheCostRead: 0.025,
        cacheCostWrite: 0.1,
        knowledgeCutoff: "Jun 2025",
      }),

      // --- Reasoning ---
      m({
        id: "o3-pro",
        name: "o3-pro",
        contextWindow: 200_000,
        maxOutput: 100_000,
        supportsTools: true,
        supportsThinking: true,
        supportsMultimodal: true,
        reasoning: true,
        costTier: "premium",
        inputModalities: ["text", "image"],
        costPerMillionInput: 20.0,
        costPerMillionOutput: 80.0,
        knowledgeCutoff: "Jun 2025",
      }),
      m({
        id: "o3",
        name: "o3",
        contextWindow: 200_000,
        maxOutput: 100_000,
        supportsTools: true,
        supportsThinking: true,
        supportsMultimodal: true,
        reasoning: true,
        costTier: "premium",
        inputModalities: ["text", "image"],
        costPerMillionInput: 2.0,
        costPerMillionOutput: 8.0,
        knowledgeCutoff: "Jun 2025",
      }),
      m({
        id: "o4-mini",
        name: "o4-mini",
        contextWindow: 200_000,
        maxOutput: 100_000,
        supportsTools: true,
        supportsThinking: true,
        supportsMultimodal: true,
        reasoning: true,
        costTier: "medium",
        inputModalities: ["text", "image"],
        costPerMillionInput: 1.1,
        costPerMillionOutput: 4.4,
        knowledgeCutoff: "Jun 2025",
      }),
      m({
        id: "o3-mini",
        name: "o3-mini",
        contextWindow: 200_000,
        maxOutput: 100_000,
        supportsTools: true,
        supportsThinking: true,
        supportsMultimodal: false,
        reasoning: true,
        costTier: "medium",
        inputModalities: ["text"],
        costPerMillionInput: 1.1,
        costPerMillionOutput: 4.4,
        knowledgeCutoff: "Mar 2025",
      }),

      // --- Legacy (still widely used) ---
      m({
        id: "gpt-4o",
        name: "GPT-4o",
        contextWindow: 128_000,
        maxOutput: 16_384,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: true,
        reasoning: false,
        costTier: "high",
        inputModalities: ["text", "image", "audio"],
        outputModalities: ["text", "audio"],
        costPerMillionInput: 2.5,
        costPerMillionOutput: 10.0,
        knowledgeCutoff: "Oct 2023",
      }),
      m({
        id: "gpt-4o-mini",
        name: "GPT-4o Mini",
        contextWindow: 128_000,
        maxOutput: 16_384,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: true,
        reasoning: false,
        costTier: "low",
        inputModalities: ["text", "image"],
        costPerMillionInput: 0.15,
        costPerMillionOutput: 0.6,
        knowledgeCutoff: "Oct 2023",
      }),
    ],
  },

  // =========================================================================
  // Anthropic
  // =========================================================================
  anthropic: {
    displayName: "Anthropic Claude",
    requiresKey: true,
    description: "Claude models with extended thinking & PDF support",
    npm: "@ai-sdk/anthropic",
    supportsThinking: true,
    supportsMultimodal: true,
    models: [
      m({
        id: "claude-opus-4-20250514",
        name: "Claude Opus 4",
        contextWindow: 200_000,
        maxOutput: 32_000,
        supportsTools: true,
        supportsThinking: true,
        supportsMultimodal: true,
        reasoning: false,
        costTier: "premium",
        inputModalities: ["text", "image", "pdf"],
        costPerMillionInput: 15.0,
        costPerMillionOutput: 75.0,
        cacheCostRead: 1.5,
        cacheCostWrite: 18.75,
        knowledgeCutoff: "Mar 2025",
      }),
      m({
        id: "claude-sonnet-4-20250514",
        name: "Claude Sonnet 4",
        contextWindow: 200_000,
        maxOutput: 16_000,
        supportsTools: true,
        supportsThinking: true,
        supportsMultimodal: true,
        reasoning: false,
        costTier: "high",
        inputModalities: ["text", "image", "pdf"],
        costPerMillionInput: 3.0,
        costPerMillionOutput: 15.0,
        cacheCostRead: 0.3,
        cacheCostWrite: 3.75,
        knowledgeCutoff: "Mar 2025",
      }),
      m({
        id: "claude-haiku-4-20250514",
        name: "Claude Haiku 4",
        contextWindow: 200_000,
        maxOutput: 8_192,
        supportsTools: true,
        supportsThinking: true,
        supportsMultimodal: true,
        reasoning: false,
        costTier: "low",
        inputModalities: ["text", "image", "pdf"],
        costPerMillionInput: 0.8,
        costPerMillionOutput: 4.0,
        cacheCostRead: 0.08,
        cacheCostWrite: 1.0,
        knowledgeCutoff: "Mar 2025",
      }),
      m({
        id: "claude-3-5-sonnet-latest",
        name: "Claude 3.5 Sonnet",
        contextWindow: 200_000,
        maxOutput: 8_192,
        supportsTools: true,
        supportsThinking: true,
        supportsMultimodal: true,
        reasoning: false,
        costTier: "medium",
        inputModalities: ["text", "image", "pdf"],
        costPerMillionInput: 3.0,
        costPerMillionOutput: 15.0,
        cacheCostRead: 0.3,
        cacheCostWrite: 3.75,
        knowledgeCutoff: "Apr 2024",
      }),
      m({
        id: "claude-3-5-haiku-latest",
        name: "Claude 3.5 Haiku",
        contextWindow: 200_000,
        maxOutput: 8_192,
        supportsTools: true,
        supportsThinking: true,
        supportsMultimodal: true,
        reasoning: false,
        costTier: "low",
        inputModalities: ["text", "image", "pdf"],
        costPerMillionInput: 0.8,
        costPerMillionOutput: 4.0,
        cacheCostRead: 0.08,
        cacheCostWrite: 1.0,
        knowledgeCutoff: "Jul 2024",
      }),
    ],
  },

  // =========================================================================
  // Google
  // =========================================================================
  google: {
    displayName: "Google AI",
    requiresKey: true,
    description: "Gemini models with native thinking & multimodal",
    npm: "@ai-sdk/google",
    supportsThinking: true,
    supportsMultimodal: true,
    models: [
      m({
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        contextWindow: 1_048_576,
        maxOutput: 65_536,
        supportsTools: true,
        supportsThinking: true,
        supportsMultimodal: true,
        reasoning: true,
        costTier: "high",
        inputModalities: ["text", "image", "audio", "video", "pdf"],
        outputModalities: ["text"],
        costPerMillionInput: 1.25,
        costPerMillionOutput: 10.0,
        cacheCostRead: 0.315,
        cacheCostWrite: 1.25,
        knowledgeCutoff: "Jan 2025",
      }),
      m({
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        contextWindow: 1_048_576,
        maxOutput: 65_536,
        supportsTools: true,
        supportsThinking: true,
        supportsMultimodal: true,
        reasoning: true,
        costTier: "low",
        inputModalities: ["text", "image", "audio", "video", "pdf"],
        outputModalities: ["text"],
        costPerMillionInput: 0.15,
        costPerMillionOutput: 0.6,
        cacheCostRead: 0.0375,
        cacheCostWrite: 0.15,
        knowledgeCutoff: "Jan 2025",
      }),
      m({
        id: "gemini-2.5-flash-lite-preview-06-17",
        name: "Gemini 2.5 Flash Lite",
        contextWindow: 1_048_576,
        maxOutput: 65_536,
        supportsTools: true,
        supportsThinking: true,
        supportsMultimodal: true,
        reasoning: true,
        costTier: "low",
        inputModalities: ["text", "image", "audio", "video", "pdf"],
        costPerMillionInput: 0.075,
        costPerMillionOutput: 0.3,
        knowledgeCutoff: "Jan 2025",
      }),
      m({
        id: "gemini-2.0-flash",
        name: "Gemini 2.0 Flash",
        contextWindow: 1_048_576,
        maxOutput: 8_192,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: true,
        reasoning: false,
        costTier: "low",
        inputModalities: ["text", "image", "audio", "video", "pdf"],
        outputModalities: ["text", "image"],
        costPerMillionInput: 0.1,
        costPerMillionOutput: 0.4,
        knowledgeCutoff: "Aug 2024",
      }),
      m({
        id: "gemini-1.5-pro",
        name: "Gemini 1.5 Pro",
        contextWindow: 2_097_152,
        maxOutput: 8_192,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: true,
        reasoning: false,
        costTier: "medium",
        inputModalities: ["text", "image", "audio", "video", "pdf"],
        costPerMillionInput: 1.25,
        costPerMillionOutput: 5.0,
        knowledgeCutoff: "Nov 2023",
      }),
    ],
  },

  // =========================================================================
  // Azure OpenAI
  // =========================================================================
  azure: {
    displayName: "Azure OpenAI",
    requiresKey: true,
    description: "Azure-hosted OpenAI models",
    npm: "@ai-sdk/azure",
    supportsThinking: true,
    supportsMultimodal: true,
    models: [
      m({
        id: "gpt-4o",
        name: "GPT-4o (Azure)",
        contextWindow: 128_000,
        maxOutput: 16_384,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: true,
        reasoning: false,
        costTier: "high",
        inputModalities: ["text", "image"],
      }),
      m({
        id: "gpt-4o-mini",
        name: "GPT-4o Mini (Azure)",
        contextWindow: 128_000,
        maxOutput: 16_384,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: true,
        reasoning: false,
        costTier: "low",
        inputModalities: ["text", "image"],
      }),
      m({
        id: "o3-mini",
        name: "o3-mini (Azure)",
        contextWindow: 200_000,
        maxOutput: 100_000,
        supportsTools: true,
        supportsThinking: true,
        supportsMultimodal: false,
        reasoning: true,
        costTier: "medium",
      }),
    ],
  },

  // =========================================================================
  // Groq
  // =========================================================================
  groq: {
    displayName: "Groq",
    requiresKey: true,
    description: "Ultra-fast inference on open models",
    npm: "@ai-sdk/groq",
    supportsThinking: false,
    supportsMultimodal: true,
    models: [
      m({
        id: "llama-4-scout-17b-16e-instruct",
        name: "Llama 4 Scout 17B",
        contextWindow: 131_072,
        maxOutput: 8_192,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: true,
        reasoning: false,
        costTier: "free",
        inputModalities: ["text", "image"],
        costPerMillionInput: 0.11,
        costPerMillionOutput: 0.34,
      }),
      m({
        id: "llama-4-maverick-17b-128e-instruct",
        name: "Llama 4 Maverick 17B",
        contextWindow: 131_072,
        maxOutput: 8_192,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: true,
        reasoning: false,
        costTier: "low",
        inputModalities: ["text", "image"],
        costPerMillionInput: 0.5,
        costPerMillionOutput: 0.77,
      }),
      m({
        id: "qwen-qwq-32b",
        name: "Qwen QwQ 32B",
        contextWindow: 131_072,
        maxOutput: 32_768,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: true,
        costTier: "free",
        costPerMillionInput: 0.29,
        costPerMillionOutput: 0.39,
      }),
      m({
        id: "llama-3.3-70b-versatile",
        name: "Llama 3.3 70B",
        contextWindow: 128_000,
        maxOutput: 32_768,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: false,
        costTier: "free",
        costPerMillionInput: 0.59,
        costPerMillionOutput: 0.79,
      }),
      m({
        id: "llama-3.1-8b-instant",
        name: "Llama 3.1 8B",
        contextWindow: 128_000,
        maxOutput: 8_192,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: false,
        costTier: "free",
        costPerMillionInput: 0.05,
        costPerMillionOutput: 0.08,
      }),
      m({
        id: "gemma2-9b-it",
        name: "Gemma 2 9B",
        contextWindow: 8_192,
        maxOutput: 4_096,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: false,
        costTier: "free",
        costPerMillionInput: 0.2,
        costPerMillionOutput: 0.2,
      }),
    ],
  },

  // =========================================================================
  // Ollama (Local)
  // =========================================================================
  ollama: {
    displayName: "Ollama (Local)",
    requiresKey: false,
    description: "Run models locally with Ollama",
    npm: "@ai-sdk/openai",
    supportsThinking: false,
    supportsMultimodal: true,
    models: [
      m({
        id: "llama3.2",
        name: "Llama 3.2",
        contextWindow: 128_000,
        maxOutput: 4_096,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: false,
        costTier: "free",
      }),
      m({
        id: "llama3.1",
        name: "Llama 3.1",
        contextWindow: 128_000,
        maxOutput: 4_096,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: false,
        costTier: "free",
      }),
      m({
        id: "qwen2.5-coder",
        name: "Qwen 2.5 Coder",
        contextWindow: 128_000,
        maxOutput: 8_192,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: false,
        costTier: "free",
      }),
      m({
        id: "mistral",
        name: "Mistral 7B",
        contextWindow: 32_768,
        maxOutput: 4_096,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: false,
        costTier: "free",
      }),
      m({
        id: "deepseek-coder-v2",
        name: "DeepSeek Coder V2",
        contextWindow: 128_000,
        maxOutput: 8_192,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: false,
        costTier: "free",
      }),
      m({
        id: "phi3",
        name: "Phi-3",
        contextWindow: 128_000,
        maxOutput: 4_096,
        supportsTools: false,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: false,
        costTier: "free",
      }),
    ],
  },

  // =========================================================================
  // OpenAI-Compatible
  // =========================================================================
  "openai-compatible": {
    displayName: "OpenAI-Compatible",
    requiresKey: true,
    description: "Any OpenAI-compatible API (vLLM, TGI, LiteLLM, etc.)",
    npm: "@ai-sdk/openai",
    supportsThinking: false,
    supportsMultimodal: false,
    models: [
      m({
        id: "custom-model",
        name: "Custom Model",
        contextWindow: 128_000,
        maxOutput: 4_096,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: false,
        costTier: "medium",
      }),
    ],
  },

  // =========================================================================
  // Cohere
  // =========================================================================
  cohere: {
    displayName: "Cohere",
    requiresKey: true,
    description: "Cohere Command A series for RAG & enterprise",
    npm: "@ai-sdk/cohere",
    supportsThinking: false,
    supportsMultimodal: false,
    models: [
      m({
        id: "command-a-03-2025",
        name: "Command A",
        contextWindow: 256_000,
        maxOutput: 8_192,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: false,
        costTier: "medium",
        costPerMillionInput: 2.5,
        costPerMillionOutput: 10.0,
      }),
      m({
        id: "command-r-plus",
        name: "Command R+",
        contextWindow: 128_000,
        maxOutput: 4_096,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: false,
        costTier: "medium",
        costPerMillionInput: 2.5,
        costPerMillionOutput: 10.0,
      }),
      m({
        id: "command-r",
        name: "Command R",
        contextWindow: 128_000,
        maxOutput: 4_096,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: false,
        costTier: "low",
        costPerMillionInput: 0.15,
        costPerMillionOutput: 0.6,
      }),
    ],
  },

  // =========================================================================
  // Mistral
  // =========================================================================
  mistral: {
    displayName: "Mistral",
    requiresKey: true,
    description: "Mistral chat, code & reasoning models",
    npm: "@ai-sdk/mistral",
    supportsThinking: true,
    supportsMultimodal: true,
    models: [
      m({
        id: "mistral-large-latest",
        name: "Mistral Large",
        contextWindow: 131_072,
        maxOutput: 8_192,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: true,
        reasoning: false,
        costTier: "high",
        inputModalities: ["text", "image"],
        costPerMillionInput: 2.0,
        costPerMillionOutput: 6.0,
        knowledgeCutoff: "Nov 2024",
      }),
      m({
        id: "magistral-medium-latest",
        name: "Magistral Medium",
        contextWindow: 40_000,
        maxOutput: 40_000,
        supportsTools: false,
        supportsThinking: true,
        supportsMultimodal: false,
        supportsStructuredOutput: false,
        reasoning: true,
        costTier: "medium",
        costPerMillionInput: 2.0,
        costPerMillionOutput: 5.0,
        knowledgeCutoff: "Nov 2024",
      }),
      m({
        id: "magistral-small-latest",
        name: "Magistral Small",
        contextWindow: 40_000,
        maxOutput: 40_000,
        supportsTools: false,
        supportsThinking: true,
        supportsMultimodal: false,
        supportsStructuredOutput: false,
        reasoning: true,
        costTier: "low",
        costPerMillionInput: 0.5,
        costPerMillionOutput: 1.5,
        knowledgeCutoff: "Nov 2024",
      }),
      m({
        id: "devstral-small-latest",
        name: "Devstral Small",
        contextWindow: 131_072,
        maxOutput: 8_192,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: false,
        costTier: "low",
        costPerMillionInput: 0.25,
        costPerMillionOutput: 0.75,
      }),
      m({
        id: "mistral-small-latest",
        name: "Mistral Small",
        contextWindow: 128_000,
        maxOutput: 8_192,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: true,
        reasoning: false,
        costTier: "low",
        inputModalities: ["text", "image"],
        costPerMillionInput: 0.1,
        costPerMillionOutput: 0.3,
        knowledgeCutoff: "Nov 2024",
      }),
      m({
        id: "codestral-latest",
        name: "Codestral",
        contextWindow: 262_144,
        maxOutput: 8_192,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: false,
        costTier: "low",
        costPerMillionInput: 0.3,
        costPerMillionOutput: 0.9,
      }),
    ],
  },

  // =========================================================================
  // xAI (Grok)
  // =========================================================================
  xai: {
    displayName: "xAI (Grok)",
    requiresKey: true,
    description: "Grok models with massive context & reasoning",
    npm: "@ai-sdk/xai",
    supportsThinking: true,
    supportsMultimodal: true,
    models: [
      m({
        id: "grok-4",
        name: "Grok 4",
        contextWindow: 131_072,
        maxOutput: 16_384,
        supportsTools: true,
        supportsThinking: true,
        supportsMultimodal: true,
        reasoning: true,
        costTier: "premium",
        inputModalities: ["text", "image"],
        costPerMillionInput: 3.0,
        costPerMillionOutput: 15.0,
      }),
      m({
        id: "grok-3",
        name: "Grok 3",
        contextWindow: 131_072,
        maxOutput: 16_384,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: true,
        reasoning: false,
        costTier: "high",
        inputModalities: ["text", "image"],
        costPerMillionInput: 3.0,
        costPerMillionOutput: 15.0,
      }),
      m({
        id: "grok-3-mini",
        name: "Grok 3 Mini",
        contextWindow: 131_072,
        maxOutput: 16_384,
        supportsTools: true,
        supportsThinking: true,
        supportsMultimodal: false,
        reasoning: true,
        costTier: "medium",
        costPerMillionInput: 0.3,
        costPerMillionOutput: 0.5,
      }),
      m({
        id: "grok-3-fast",
        name: "Grok 3 Fast",
        contextWindow: 131_072,
        maxOutput: 16_384,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: false,
        costTier: "medium",
        costPerMillionInput: 5.0,
        costPerMillionOutput: 25.0,
      }),
    ],
  },

  // =========================================================================
  // Perplexity
  // =========================================================================
  perplexity: {
    displayName: "Perplexity",
    requiresKey: true,
    description: "Perplexity Sonar models with live web search",
    npm: "@ai-sdk/perplexity",
    supportsThinking: false,
    supportsMultimodal: false,
    models: [
      m({
        id: "sonar-pro",
        name: "Sonar Pro",
        contextWindow: 200_000,
        maxOutput: 8_192,
        supportsTools: false,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: false,
        costTier: "medium",
        costPerMillionInput: 3.0,
        costPerMillionOutput: 15.0,
      }),
      m({
        id: "sonar-reasoning-pro",
        name: "Sonar Reasoning Pro",
        contextWindow: 200_000,
        maxOutput: 8_192,
        supportsTools: false,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: true,
        costTier: "high",
        costPerMillionInput: 2.0,
        costPerMillionOutput: 8.0,
      }),
      m({
        id: "sonar",
        name: "Sonar",
        contextWindow: 128_000,
        maxOutput: 8_192,
        supportsTools: false,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: false,
        costTier: "low",
        costPerMillionInput: 1.0,
        costPerMillionOutput: 1.0,
      }),
      m({
        id: "sonar-deep-research",
        name: "Sonar Deep Research",
        contextWindow: 128_000,
        maxOutput: 8_192,
        supportsTools: false,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: true,
        costTier: "high",
        costPerMillionInput: 2.0,
        costPerMillionOutput: 8.0,
      }),
    ],
  },

  // =========================================================================
  // Fireworks
  // =========================================================================
  fireworks: {
    displayName: "Fireworks",
    requiresKey: true,
    description: "Fireworks-hosted open & proprietary models",
    npm: "@ai-sdk/fireworks",
    supportsThinking: false,
    supportsMultimodal: false,
    models: [
      m({
        id: "accounts/fireworks/models/deepseek-v3",
        name: "DeepSeek V3",
        contextWindow: 131_072,
        maxOutput: 8_192,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: false,
        costTier: "low",
        costPerMillionInput: 0.9,
        costPerMillionOutput: 0.9,
      }),
      m({
        id: "accounts/fireworks/models/llama-v3p3-70b-instruct",
        name: "Llama 3.3 70B",
        contextWindow: 131_072,
        maxOutput: 16_384,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: false,
        costTier: "low",
        costPerMillionInput: 0.9,
        costPerMillionOutput: 0.9,
      }),
      m({
        id: "accounts/fireworks/models/qwen2p5-coder-32b-instruct",
        name: "Qwen 2.5 Coder 32B",
        contextWindow: 32_768,
        maxOutput: 8_192,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: false,
        costTier: "low",
        costPerMillionInput: 0.9,
        costPerMillionOutput: 0.9,
      }),
    ],
  },

  // =========================================================================
  // Together AI
  // =========================================================================
  togetherai: {
    displayName: "Together AI",
    requiresKey: true,
    description: "Together AI hosted open models",
    npm: "@ai-sdk/togetherai",
    supportsThinking: false,
    supportsMultimodal: false,
    models: [
      m({
        id: "deepseek-ai/DeepSeek-V3",
        name: "DeepSeek V3",
        contextWindow: 131_072,
        maxOutput: 8_192,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: false,
        costTier: "low",
        costPerMillionInput: 0.9,
        costPerMillionOutput: 0.9,
      }),
      m({
        id: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        name: "Llama 3.3 70B Turbo",
        contextWindow: 128_000,
        maxOutput: 4_096,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: false,
        costTier: "low",
        costPerMillionInput: 0.88,
        costPerMillionOutput: 0.88,
      }),
      m({
        id: "Qwen/Qwen2.5-Coder-32B-Instruct",
        name: "Qwen 2.5 Coder 32B",
        contextWindow: 32_768,
        maxOutput: 8_192,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: false,
        costTier: "low",
        costPerMillionInput: 0.9,
        costPerMillionOutput: 0.9,
      }),
      m({
        id: "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
        name: "Llama 3.1 8B Turbo",
        contextWindow: 128_000,
        maxOutput: 4_096,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: false,
        costTier: "free",
        costPerMillionInput: 0.18,
        costPerMillionOutput: 0.18,
      }),
    ],
  },

  // =========================================================================
  // DeepInfra
  // =========================================================================
  deepinfra: {
    displayName: "DeepInfra",
    requiresKey: true,
    description: "DeepInfra hosted open models",
    npm: "@ai-sdk/deepinfra",
    supportsThinking: false,
    supportsMultimodal: false,
    models: [
      m({
        id: "deepseek-ai/DeepSeek-V3-0324",
        name: "DeepSeek V3",
        contextWindow: 131_072,
        maxOutput: 8_192,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: false,
        costTier: "low",
        costPerMillionInput: 0.5,
        costPerMillionOutput: 1.4,
      }),
      m({
        id: "meta-llama/Llama-3.3-70B-Instruct",
        name: "Llama 3.3 70B",
        contextWindow: 128_000,
        maxOutput: 4_096,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: false,
        costTier: "low",
        costPerMillionInput: 0.35,
        costPerMillionOutput: 0.4,
      }),
      m({
        id: "meta-llama/Meta-Llama-3.1-8B-Instruct",
        name: "Llama 3.1 8B",
        contextWindow: 128_000,
        maxOutput: 4_096,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: false,
        costTier: "free",
        costPerMillionInput: 0.06,
        costPerMillionOutput: 0.06,
      }),
      m({
        id: "Qwen/Qwen2.5-Coder-32B-Instruct",
        name: "Qwen 2.5 Coder 32B",
        contextWindow: 32_768,
        maxOutput: 8_192,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: false,
        costTier: "low",
        costPerMillionInput: 0.2,
        costPerMillionOutput: 0.2,
      }),
    ],
  },

  // =========================================================================
  // DeepSeek
  // =========================================================================
  deepseek: {
    displayName: "DeepSeek",
    requiresKey: true,
    description: "DeepSeek chat & reasoning models",
    npm: "@ai-sdk/deepseek",
    supportsThinking: true,
    supportsMultimodal: false,
    models: [
      m({
        id: "deepseek-chat",
        name: "DeepSeek Chat (V3)",
        contextWindow: 65_536,
        maxOutput: 8_192,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: false,
        reasoning: false,
        costTier: "low",
        costPerMillionInput: 0.27,
        costPerMillionOutput: 1.1,
        cacheCostRead: 0.07,
        cacheCostWrite: 0.27,
        knowledgeCutoff: "Jul 2025",
      }),
      m({
        id: "deepseek-reasoner",
        name: "DeepSeek Reasoner (R1)",
        contextWindow: 65_536,
        maxOutput: 8_192,
        supportsTools: true,
        supportsThinking: true,
        supportsMultimodal: false,
        reasoning: true,
        costTier: "low",
        costPerMillionInput: 0.55,
        costPerMillionOutput: 2.19,
        cacheCostRead: 0.14,
        cacheCostWrite: 0.55,
        knowledgeCutoff: "Jul 2025",
      }),
    ],
  },

  // =========================================================================
  // Amazon Bedrock
  // =========================================================================
  "amazon-bedrock": {
    displayName: "Amazon Bedrock",
    requiresKey: true,
    description: "AWS Bedrock hosted models (Claude, Llama, Nova, etc.)",
    npm: "@ai-sdk/amazon-bedrock",
    supportsThinking: true,
    supportsMultimodal: true,
    models: [
      m({
        id: "anthropic.claude-sonnet-4-20250514-v1:0",
        name: "Claude Sonnet 4 (Bedrock)",
        contextWindow: 200_000,
        maxOutput: 16_000,
        supportsTools: true,
        supportsThinking: true,
        supportsMultimodal: true,
        reasoning: false,
        costTier: "high",
        inputModalities: ["text", "image", "pdf"],
        costPerMillionInput: 3.0,
        costPerMillionOutput: 15.0,
      }),
      m({
        id: "anthropic.claude-3-5-sonnet-20241022-v2:0",
        name: "Claude 3.5 Sonnet v2 (Bedrock)",
        contextWindow: 200_000,
        maxOutput: 8_192,
        supportsTools: true,
        supportsThinking: true,
        supportsMultimodal: true,
        reasoning: false,
        costTier: "medium",
        inputModalities: ["text", "image", "pdf"],
        costPerMillionInput: 3.0,
        costPerMillionOutput: 15.0,
      }),
      m({
        id: "anthropic.claude-3-5-haiku-20241022-v1:0",
        name: "Claude 3.5 Haiku (Bedrock)",
        contextWindow: 200_000,
        maxOutput: 8_192,
        supportsTools: true,
        supportsThinking: true,
        supportsMultimodal: true,
        reasoning: false,
        costTier: "low",
        inputModalities: ["text", "image", "pdf"],
        costPerMillionInput: 0.8,
        costPerMillionOutput: 4.0,
      }),
      m({
        id: "amazon.nova-pro-v1:0",
        name: "Amazon Nova Pro (Bedrock)",
        contextWindow: 300_000,
        maxOutput: 5_120,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: true,
        reasoning: false,
        costTier: "low",
        inputModalities: ["text", "image", "video"],
        costPerMillionInput: 0.8,
        costPerMillionOutput: 3.2,
      }),
      m({
        id: "amazon.nova-lite-v1:0",
        name: "Amazon Nova Lite (Bedrock)",
        contextWindow: 300_000,
        maxOutput: 5_120,
        supportsTools: true,
        supportsThinking: false,
        supportsMultimodal: true,
        reasoning: false,
        costTier: "free",
        inputModalities: ["text", "image", "video"],
        costPerMillionInput: 0.06,
        costPerMillionOutput: 0.24,
      }),
    ],
  },
};

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/**
 * Check if a model supports extended thinking or reasoning
 */
export function modelSupportsThinking(modelId: string): boolean {
  for (const provider of Object.values(PROVIDER_INFO)) {
    const model = provider.models.find((mod) => mod.id === modelId);
    if (model) {
      return model.supportsThinking || model.reasoning;
    }
  }
  // Fallback heuristics for models not in the registry
  return (
    modelId.includes("claude-opus-4") ||
    modelId.includes("claude-sonnet-4") ||
    modelId.includes("claude-haiku-4") ||
    modelId.includes("claude-3-5-sonnet") ||
    modelId.includes("claude-3-5-haiku") ||
    modelId.includes("o3") ||
    modelId.includes("o4") ||
    modelId.includes("deepseek-reasoner") ||
    modelId.includes("grok-3-mini") ||
    modelId.includes("grok-4") ||
    modelId.includes("gemini-2.5") ||
    modelId.includes("magistral") ||
    modelId.includes("qwq")
  );
}

/**
 * Check if a model is a reasoning model that disallows temperature
 */
export function isReasoningModel(modelId: string): boolean {
  for (const provider of Object.values(PROVIDER_INFO)) {
    const model = provider.models.find((mod) => mod.id === modelId);
    if (model) return model.reasoning;
  }
  return (
    modelId.includes("o3") ||
    modelId.includes("o4") ||
    modelId.includes("deepseek-reasoner") ||
    modelId.includes("grok-3-mini") ||
    modelId.includes("grok-4") ||
    modelId.includes("magistral") ||
    modelId.includes("qwq")
  );
}

/**
 * Get detailed model info for a specific model within a provider
 */
export function getModelInfo(
  providerName: ProviderName,
  modelId: string,
): ModelInfo | undefined {
  const provider = PROVIDER_INFO[providerName];
  if (!provider) return undefined;
  return provider.models.find((mod) => mod.id === modelId);
}

/**
 * Find model info across all providers
 */
export function findModelInfo(modelId: string): { provider: ProviderName; model: ModelInfo } | undefined {
  for (const [providerName, provider] of Object.entries(PROVIDER_INFO)) {
    const model = provider.models.find((mod) => mod.id === modelId);
    if (model) return { provider: providerName as ProviderName, model };
  }
  return undefined;
}

/**
 * Get the default (first) model ID for a provider
 */
export function getDefaultModelForProvider(providerName: ProviderName): string {
  const provider = PROVIDER_INFO[providerName];
  if (!provider || provider.models.length === 0) {
    return "unknown";
  }
  return provider.models[0].id;
}

/**
 * Get all available providers as array
 */
export function getAllProviders(): Array<{ id: ProviderName } & ProviderInfo> {
  return Object.entries(PROVIDER_INFO).map(([id, info]) => ({
    id: id as ProviderName,
    ...info,
  }));
}
