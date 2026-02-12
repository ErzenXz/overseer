/**
 * AI Provider System for Overseer
 * Supports multiple providers via Vercel AI SDK v6
 */

import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createCohere } from "@ai-sdk/cohere";
import { createMistral } from "@ai-sdk/mistral";
import { createXai } from "@ai-sdk/xai";
import { createPerplexity } from "@ai-sdk/perplexity";
import { createFireworks } from "@ai-sdk/fireworks";
import { createTogetherAI } from "@ai-sdk/togetherai";
import { createDeepInfra } from "@ai-sdk/deepinfra";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import type { LanguageModel } from "ai";
import { providersModel } from "../database/index";
import { decrypt } from "../lib/crypto";
import { createLogger } from "../lib/logger";
import { getDynamicProviderCatalog } from "./dynamic-provider-catalog";
import {
  PROVIDER_INFO,
  type ProviderName,
  type ModelInfo,
  getModelInfo,
  findModelInfo,
  isReasoningModel,
  modelSupportsThinking,
} from "./provider-info";

const logger = createLogger("providers");

export {
  PROVIDER_INFO,
  type ProviderName,
  type ModelInfo,
  getModelInfo,
  findModelInfo,
  isReasoningModel,
  modelSupportsThinking,
} from "./provider-info";

interface ProviderConfig {
  name: string;
  apiKey?: string;
  baseUrl?: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  providerNpm?: string;
}

interface ActiveModelEntry {
  providerId: number;
  providerName: string;
  modelId: string;
  model: LanguageModel;
  priority: number;
}

function normalizeProviderRuntimeName(
  name: string,
  providerNpm?: string,
): string {
  if (providerNpm === "@ai-sdk/openai") return "openai";
  if (providerNpm === "@ai-sdk/anthropic") return "anthropic";
  if (providerNpm === "@ai-sdk/google") return "google";
  if (providerNpm === "@ai-sdk/azure") return "azure";
  if (providerNpm === "@ai-sdk/groq") return "groq";
  if (providerNpm === "@ai-sdk/cohere") return "cohere";
  if (providerNpm === "@ai-sdk/mistral") return "mistral";
  if (providerNpm === "@ai-sdk/xai") return "xai";
  if (providerNpm === "@ai-sdk/perplexity") return "perplexity";
  if (providerNpm === "@ai-sdk/fireworks") return "fireworks";
  if (providerNpm === "@ai-sdk/togetherai") return "togetherai";
  if (providerNpm === "@ai-sdk/deepinfra") return "deepinfra";
  if (providerNpm === "@ai-sdk/deepseek") return "deepseek";
  if (providerNpm === "@ai-sdk/amazon-bedrock") return "amazon-bedrock";
  if (providerNpm === "@ai-sdk/openai-compatible") return "openai-compatible";

  if (name in PROVIDER_INFO) return name;
  return "openai-compatible";
}

function parseProviderConfig(provider: {
  config?: string | null;
}): Record<string, unknown> {
  if (!provider.config) return {};
  try {
    const parsed = JSON.parse(provider.config);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Create a language model instance from provider config
 * Uses Vercel AI SDK v6 patterns
 */
export function createModel(config: ProviderConfig): LanguageModel {
  const runtimeName = normalizeProviderRuntimeName(
    config.name,
    config.providerNpm,
  );

  switch (runtimeName) {
    case "openai": {
      const openai = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return openai(config.model);
    }

    case "anthropic": {
      const anthropic = createAnthropic({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return anthropic(config.model);
    }

    case "google": {
      const google = createGoogleGenerativeAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return google(config.model);
    }

    case "azure": {
      // Azure uses environment variables primarily
      const azure = createOpenAI({
        apiKey: config.apiKey || process.env.AZURE_API_KEY,
        baseURL: config.baseUrl || process.env.AZURE_BASE_URL,
      });
      return azure(config.model);
    }

    case "groq": {
      const groq = createGroq({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return groq(config.model) as unknown as LanguageModel;
    }

    case "ollama": {
      const ollama = createOpenAI({
        apiKey: "ollama",
        baseURL: config.baseUrl || "http://localhost:11434/v1",
      });
      return ollama(config.model);
    }

    case "openai-compatible": {
      const compatible = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return compatible(config.model);
    }

    case "cohere": {
      const cohere = createCohere({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return cohere(config.model) as unknown as LanguageModel;
    }

    case "mistral": {
      const mistral = createMistral({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return mistral(config.model) as unknown as LanguageModel;
    }

    case "xai": {
      const xai = createXai({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return xai(config.model) as unknown as LanguageModel;
    }

    case "perplexity": {
      const perplexity = createPerplexity({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return perplexity(config.model) as unknown as LanguageModel;
    }

    case "fireworks": {
      const fireworks = createFireworks({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return fireworks(config.model) as unknown as LanguageModel;
    }

    case "togetherai": {
      const togetherai = createTogetherAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return togetherai(config.model) as unknown as LanguageModel;
    }

    case "deepinfra": {
      const deepinfra = createDeepInfra({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return deepinfra(config.model) as unknown as LanguageModel;
    }

    case "deepseek": {
      const deepseek = createDeepSeek({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return deepseek(config.model) as unknown as LanguageModel;
    }

    case "amazon-bedrock": {
      const bedrock = createAmazonBedrock({
        accessKeyId: config.apiKey,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
      });
      return bedrock(config.model) as unknown as LanguageModel;
    }

    default:
      if (!config.baseUrl) {
        throw new Error(
          `Unknown provider '${config.name}'. For custom providers, set a base URL and API key.`,
        );
      }

      const compatible = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });

      return compatible(config.model);
  }
}

/**
 * Detect provider from environment variables
 * Falls back to env vars if no database provider is configured
 */
function detectProviderFromEnv(): ProviderConfig | null {
  const providers: Array<{
    key: string;
    name: ProviderName;
    model: string;
    baseUrl?: string;
  }> = [
    {
      key: "OPENAI_API_KEY",
      name: "openai",
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    },
    {
      key: "ANTHROPIC_API_KEY",
      name: "anthropic",
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
    },
    {
      key: "GOOGLE_API_KEY",
      name: "google",
      model: process.env.GOOGLE_MODEL || "gemini-2.5-flash",
    },
    {
      key: "GOOGLE_GENERATIVE_AI_API_KEY",
      name: "google",
      model: process.env.GOOGLE_MODEL || "gemini-2.5-flash",
    },
    {
      key: "GROQ_API_KEY",
      name: "groq",
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    },
    {
      key: "AZURE_API_KEY",
      name: "azure",
      model: process.env.AZURE_MODEL || "gpt-4o",
      baseUrl: process.env.AZURE_BASE_URL,
    },
    {
      key: "COHERE_API_KEY",
      name: "cohere",
      model: process.env.COHERE_MODEL || "command-a-03-2025",
    },
    {
      key: "MISTRAL_API_KEY",
      name: "mistral",
      model: process.env.MISTRAL_MODEL || "mistral-large-latest",
    },
    {
      key: "XAI_API_KEY",
      name: "xai",
      model: process.env.XAI_MODEL || "grok-3-mini",
    },
    {
      key: "PERPLEXITY_API_KEY",
      name: "perplexity",
      model: process.env.PERPLEXITY_MODEL || "sonar-pro",
    },
    {
      key: "FIREWORKS_API_KEY",
      name: "fireworks",
      model:
        process.env.FIREWORKS_MODEL || "accounts/fireworks/models/deepseek-v3",
    },
    {
      key: "TOGETHER_API_KEY",
      name: "togetherai",
      model: process.env.TOGETHER_MODEL || "deepseek-ai/DeepSeek-V3",
    },
    {
      key: "DEEPINFRA_API_KEY",
      name: "deepinfra",
      model: process.env.DEEPINFRA_MODEL || "deepseek-ai/DeepSeek-V3-0324",
    },
    {
      key: "DEEPSEEK_API_KEY",
      name: "deepseek",
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    },
    {
      key: "AWS_ACCESS_KEY_ID",
      name: "amazon-bedrock",
      model:
        process.env.BEDROCK_MODEL || "anthropic.claude-sonnet-4-20250514-v1:0",
    },
  ];

  for (const provider of providers) {
    const apiKey = process.env[provider.key];
    if (apiKey) {
      return {
        name: provider.name,
        apiKey,
        model: provider.model,
        baseUrl: provider.baseUrl,
      };
    }
  }

  // Check for Ollama
  if (process.env.OLLAMA_BASE_URL || process.env.ENABLE_OLLAMA === "true") {
    return {
      name: "ollama",
      model: process.env.OLLAMA_MODEL || "llama3.2",
      baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
    };
  }

  return null;
}

/**
 * Get the configured default model from database
 * Falls back to environment variables if no database provider is set
 */
export function getDefaultModel(): LanguageModel | null {
  const provider = providersModel.findDefault();

  if (!provider) {
    logger.warn("No default provider configured in database");

    // Try environment fallback
    const envProvider = detectProviderFromEnv();
    if (envProvider) {
      logger.info("Using provider from environment", {
        provider: envProvider.name,
      });
      try {
        return createModel(envProvider);
      } catch (error) {
        logger.error("Failed to create model from env", { error });
      }
    }

    return null;
  }

  try {
    const providerConfig = parseProviderConfig(provider);

    const apiKey = provider.api_key_encrypted
      ? decrypt(provider.api_key_encrypted)
      : undefined;

    return createModel({
      name: provider.name,
      apiKey,
      baseUrl: provider.base_url || undefined,
      model: provider.model,
      maxTokens: provider.max_tokens,
      temperature: provider.temperature,
      providerNpm:
        typeof providerConfig.provider_npm === "string"
          ? providerConfig.provider_npm
          : undefined,
    });
  } catch (error) {
    logger.error("Failed to create default model", {
      error: error instanceof Error ? error.message : String(error),
      provider: provider.name,
    });
    return null;
  }
}

/**
 * Get a model by provider ID
 */
export function getModelById(providerId: number): LanguageModel | null {
  const provider = providersModel.findById(providerId);
  if (!provider) {
    logger.warn("Provider not found", { providerId });
    return null;
  }

  try {
    const providerConfig = parseProviderConfig(provider);

    const apiKey = provider.api_key_encrypted
      ? decrypt(provider.api_key_encrypted)
      : undefined;

    return createModel({
      name: provider.name,
      apiKey,
      baseUrl: provider.base_url || undefined,
      model: provider.model,
      maxTokens: provider.max_tokens,
      temperature: provider.temperature,
      providerNpm:
        typeof providerConfig.provider_npm === "string"
          ? providerConfig.provider_npm
          : undefined,
    });
  } catch (error) {
    logger.error("Failed to create model", {
      error: error instanceof Error ? error.message : String(error),
      providerId,
    });
    return null;
  }
}

/**
 * Get all active models (for fallback)
 */
export function getActiveModels(): {
  providerId: number;
  model: LanguageModel;
}[] {
  const providers = providersModel.findActive();
  const models: { providerId: number; model: LanguageModel }[] = [];

  for (const provider of providers) {
    try {
      const providerConfig = parseProviderConfig(provider);

      const apiKey = provider.api_key_encrypted
        ? decrypt(provider.api_key_encrypted)
        : undefined;

      const model = createModel({
        name: provider.name,
        apiKey,
        baseUrl: provider.base_url || undefined,
        model: provider.model,
        maxTokens: provider.max_tokens,
        temperature: provider.temperature,
        providerNpm:
          typeof providerConfig.provider_npm === "string"
            ? providerConfig.provider_npm
            : undefined,
      });

      models.push({ providerId: provider.id, model });
    } catch (error) {
      logger.warn("Skipping provider due to error", {
        providerId: provider.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return models;
}

/**
 * Get active model entries with metadata for deterministic fallback chains.
 */
export function getActiveModelEntries(maxModels = 5): ActiveModelEntry[] {
  const providers = providersModel.findActive();
  const entries: ActiveModelEntry[] = [];

  for (const provider of providers) {
    try {
      const providerConfig = parseProviderConfig(provider);
      const apiKey = provider.api_key_encrypted
        ? decrypt(provider.api_key_encrypted)
        : undefined;

      const model = createModel({
        name: provider.name,
        apiKey,
        baseUrl: provider.base_url || undefined,
        model: provider.model,
        maxTokens: provider.max_tokens,
        temperature: provider.temperature,
        providerNpm:
          typeof providerConfig.provider_npm === "string"
            ? providerConfig.provider_npm
            : undefined,
      });

      entries.push({
        providerId: provider.id,
        providerName: provider.name,
        modelId: provider.model,
        model,
        priority: provider.priority ?? 0,
      });
    } catch (error) {
      logger.warn("Skipping provider in fallback chain due to error", {
        providerId: provider.id,
        providerName: provider.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return entries
    .sort((a, b) => b.priority - a.priority)
    .slice(0, Math.max(1, Math.min(maxModels, 5)));
}

/**
 * Build a deterministic fallback chain up to 5 models.
 */
export function buildFallbackModelChain(
  preferredModel: LanguageModel | null,
  maxModels = 5,
): LanguageModel[] {
  const chain: LanguageModel[] = [];
  const seen = new Set<string>();

  const pushModel = (model: LanguageModel | null) => {
    if (!model) return;
    const modelId =
      (model as { modelId?: string }).modelId ?? `unknown:${Math.random()}`;
    if (seen.has(modelId)) return;
    seen.add(modelId);
    chain.push(model);
  };

  pushModel(preferredModel);

  for (const entry of getActiveModelEntries(maxModels)) {
    if (chain.length >= maxModels) break;
    pushModel(entry.model);
  }

  return chain.slice(0, Math.max(1, Math.min(maxModels, 5)));
}

export async function getProviderNpmForDynamicProvider(
  providerName: string,
): Promise<string | undefined> {
  const catalog = await getDynamicProviderCatalog();
  const provider = catalog.find((p) => p.id === providerName);
  return provider?.npm;
}

/**
 * Test if a provider configuration works
 */
export async function testProvider(config: ProviderConfig): Promise<{
  success: boolean;
  error?: string;
  latencyMs?: number;
}> {
  try {
    const model = createModel(config);
    const startTime = Date.now();

    const { generateText } = await import("ai");
    await generateText({
      model,
      prompt: "Say 'OK' and nothing else.",
    });

    return {
      success: true,
      latencyMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get all provider info
 */
export function getAllProvidersInfo() {
  return Object.entries(PROVIDER_INFO).map(([id, info]) => ({
    id,
    ...info,
  }));
}

/**
 * Get provider info
 */
export function getProviderInfo(providerName: ProviderName) {
  return PROVIDER_INFO[providerName];
}

/**
 * Check if provider is supported
 */
export function isProviderSupported(name: string): name is ProviderName {
  return name in PROVIDER_INFO;
}
