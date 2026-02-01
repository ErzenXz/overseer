import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { providersModel } from "../database/index";
import { decrypt } from "../lib/crypto";
import { createLogger } from "../lib/logger";
import type { LanguageModel } from "ai";

// Re-export client-safe provider info
export { PROVIDER_INFO, type ProviderName } from "./provider-info";
import type { ProviderName } from "./provider-info";

const logger = createLogger("providers");

interface ProviderConfig {
  name: ProviderName;
  apiKey?: string;
  baseUrl?: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Create a language model instance from provider config
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

    case "ollama": {
      // Ollama uses OpenAI-compatible API
      const ollama = createOpenAI({
        apiKey: "ollama", // Ollama doesn't need a real API key
        baseURL: config.baseUrl || "http://localhost:11434/v1",
      });
      return ollama(config.model);
    }

    default:
      throw new Error(`Unknown provider: ${config.name}`);
  }
}

/**
 * Get the configured default model from database
 */
export function getDefaultModel(): LanguageModel | null {
  const provider = providersModel.findDefault();
  if (!provider) {
    logger.warn("No default provider configured");
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
      maxTokens: provider.max_tokens,
      temperature: provider.temperature,
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
    const apiKey = provider.api_key_encrypted
      ? decrypt(provider.api_key_encrypted)
      : undefined;

    return createModel({
      name: provider.name as ProviderName,
      apiKey,
      baseUrl: provider.base_url || undefined,
      model: provider.model,
      maxTokens: provider.max_tokens,
      temperature: provider.temperature,
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
        maxTokens: provider.max_tokens,
        temperature: provider.temperature,
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

    // Use the AI SDK to make a simple test call
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
