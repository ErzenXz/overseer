/**
 * AI Provider System for MyBot
 * Supports multiple providers via Vercel AI SDK v6
 */

import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { providersModel } from "../database/index";
import { decrypt } from "../lib/crypto";
import { createLogger } from "../lib/logger";

const logger = createLogger("providers");

export type ProviderName = 
  | "openai" 
  | "anthropic" 
  | "google" 
  | "azure"
  | "groq"
  | "ollama"
  | "openai-compatible";

// Provider registry
export const PROVIDER_INFO: Record<ProviderName, {
  displayName: string;
  requiresKey: boolean;
  models: string[];
  description: string;
  npm: string;
}> = {
  openai: {
    displayName: "OpenAI",
    requiresKey: true,
    models: [
      "gpt-4o",
      "gpt-4o-mini",
      "o1",
      "o1-mini",
      "o3-mini",
      "gpt-4-turbo",
      "gpt-4",
      "gpt-3.5-turbo"
    ],
    description: "OpenAI GPT models",
    npm: "@ai-sdk/openai",
  },
  anthropic: {
    displayName: "Anthropic Claude",
    requiresKey: true,
    models: [
      "claude-3-5-sonnet-latest",
      "claude-3-opus-latest",
      "claude-3-sonnet-latest",
      "claude-3-haiku-latest"
    ],
    description: "Anthropic Claude models",
    npm: "@ai-sdk/anthropic",
  },
  google: {
    displayName: "Google AI",
    requiresKey: true,
    models: [
      "gemini-2.0-flash",
      "gemini-1.5-pro",
      "gemini-1.5-flash",
      "gemini-pro"
    ],
    description: "Google Gemini models",
    npm: "@ai-sdk/google",
  },
  azure: {
    displayName: "Azure OpenAI",
    requiresKey: true,
    models: [
      "gpt-4o",
      "gpt-4",
      "gpt-35-turbo"
    ],
    description: "Azure OpenAI Service",
    npm: "@ai-sdk/azure",
  },
  groq: {
    displayName: "Groq",
    requiresKey: true,
    models: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "mixtral-8x7b-32768",
      "gemma-7b-it"
    ],
    description: "Ultra-fast inference with Groq",
    npm: "@ai-sdk/groq",
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
      "phi3"
    ],
    description: "Run models locally with Ollama",
    npm: "@ai-sdk/openai",
  },
  "openai-compatible": {
    displayName: "OpenAI-Compatible",
    requiresKey: true,
    models: [
      "custom-model"
    ],
    description: "Any OpenAI-compatible API (vLLM, TGI, etc.)",
    npm: "@ai-sdk/openai",
  },
};

interface ProviderConfig {
  name: ProviderName;
  apiKey?: string;
  baseUrl?: string;
  model: string;
}

/**
 * Create a language model instance
 */
export function createModel(config: ProviderConfig): LanguageModel {
  switch (config.name) {
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
      const groq = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl || "https://api.groq.com/openai/v1",
      });
      return groq(config.model);
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

    default:
      throw new Error(`Unknown provider: ${config.name}`);
  }
}

/**
 * Get default model from database or environment
 */
export function getDefaultModel(): LanguageModel | null {
  const provider = providersModel.findDefault();
  
  if (!provider) {
    logger.warn("No default provider configured");
    
    // Try environment fallback
    const envProvider = detectProviderFromEnv();
    if (envProvider) {
      logger.info("Using provider from environment", { provider: envProvider.provider });
      try {
        return createModel(envProvider);
      } catch (error) {
        logger.error("Failed to create model from env", { error });
      }
    }
    
    return null;
  }

  try {
    const apiKey = provider.api_key_encrypted
      ? decrypt(provider.api_key_encrypted)
      : undefined;

    return createModel({
      name: provider.name as ProviderName,
      apiKey,
      baseUrl: provider.base_url || undefined,
      model: provider.model,
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
 * Get model by provider ID
 */
export function getModelById(providerId: number): LanguageModel | null {
  const provider = providersModel.findById(providerId);
  if (!provider) {
    logger.warn("Provider not found", { providerId });
    return null;
  }

  try {
    const apiKey = provider.api_key_encrypted
      ? decrypt(provider.api_key_encrypted)
      : undefined;

    return createModel({
      name: provider.name as ProviderName,
      apiKey,
      baseUrl: provider.base_url || undefined,
      model: provider.model,
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
 * Get all active models for fallback
 */
export function getActiveModels(): { providerId: number; model: LanguageModel }[] {
  const providers = providersModel.findActive();
  const models: { providerId: number; model: LanguageModel }[] = [];

  for (const provider of providers) {
    try {
      const apiKey = provider.api_key_encrypted
        ? decrypt(provider.api_key_encrypted)
        : undefined;

      const model = createModel({
        name: provider.name as ProviderName,
        apiKey,
        baseUrl: provider.base_url || undefined,
        model: provider.model,
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
 * Test provider configuration
 */
export async function testProvider(
  providerName: ProviderName,
  modelId: string,
  apiKey?: string,
  baseUrl?: string
): Promise<{
  success: boolean;
  error?: string;
  latencyMs?: number;
}> {
  try {
    const model = createModel({ name: providerName, model: modelId, apiKey, baseUrl });
    const startTime = Date.now();

    const { generateText } = await import("ai");
    await generateText({
      model,
      prompt: "Say 'OK' and nothing else.",
      maxTokens: 10,
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
 * Detect provider from environment variables
 */
function detectProviderFromEnv(): ProviderConfig | null {
  const providers: Array<{ key: string; name: ProviderName; model: string; baseUrl?: string }> = [
    { key: "OPENAI_API_KEY", name: "openai", model: process.env.OPENAI_MODEL || "gpt-4o-mini" },
    { key: "ANTHROPIC_API_KEY", name: "anthropic", model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest" },
    { key: "GOOGLE_API_KEY", name: "google", model: process.env.GOOGLE_MODEL || "gemini-1.5-flash" },
    { key: "GOOGLE_GENERATIVE_AI_API_KEY", name: "google", model: process.env.GOOGLE_MODEL || "gemini-1.5-flash" },
    { key: "GROQ_API_KEY", name: "groq", model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile" },
    { key: "AZURE_API_KEY", name: "azure", model: process.env.AZURE_MODEL || "gpt-4o", baseUrl: process.env.AZURE_BASE_URL },
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
