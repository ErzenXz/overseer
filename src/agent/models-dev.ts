/**
 * Models.dev Integration for Overseer
 * Fetches dynamic model information from models.dev API
 */

import { createLogger } from "../lib/logger";

const logger = createLogger("models-dev");

const MODELS_DEV_API = "https://models.dev/api.json";
const MODELS_DEV_TIMEOUT_MS = 8000;

export interface ModelsDevModel {
  id: string;
  name: string;
  provider: string;
  npm?: string;
  attachment?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  structured_output?: boolean;
  temperature?: boolean;
  knowledge?: string;
  release_date?: string;
  last_updated?: string;
  open_weights?: boolean;
  cost?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache_read?: number;
    cache_write?: number;
    input_audio?: number;
    output_audio?: number;
  };
  limit?: {
    context?: number;
    input?: number;
    output?: number;
  };
  modalities?: {
    input?: string[];
    output?: string[];
  };
  status?: string;
  interleaved?: boolean | { field?: string };
}

export interface ModelsDevProvider {
  id: string;
  name: string;
  npm?: string;
  env?: string[];
  doc?: string;
  api?: string;
}

interface ModelsDevCache {
  models: ModelsDevModel[];
  providers: ModelsDevProvider[];
  lastFetch: number;
}

let cache: ModelsDevCache | null = null;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Fetch all models from models.dev
 */
export async function fetchModelsDevData(): Promise<ModelsDevCache> {
  // Return cached data if valid
  if (cache && Date.now() - cache.lastFetch < CACHE_TTL) {
    return cache;
  }

  try {
    logger.info("Fetching models from models.dev API...");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MODELS_DEV_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(MODELS_DEV_API, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    // Transform the data into our format
    const models: ModelsDevModel[] = [];
    const providers: ModelsDevProvider[] = [];

    // Process providers and models from the API response
    for (const [providerId, providerData] of Object.entries(data)) {
      const provider = providerData as any;

      providers.push({
        id: providerId,
        name: provider.name,
        npm: provider.npm,
        env: provider.env,
        doc: provider.doc,
        api: provider.api,
      });

      // Process models for this provider
      if (provider.models) {
        for (const [modelId, modelData] of Object.entries(provider.models)) {
          const model = modelData as any;
          models.push({
            id: modelId,
            name: model.name || modelId,
            provider: providerId,
            npm: provider.npm,
            attachment: model.attachment,
            reasoning: model.reasoning,
            tool_call: model.tool_call,
            structured_output: model.structured_output,
            temperature: model.temperature,
            knowledge: model.knowledge,
            release_date: model.release_date,
            last_updated: model.last_updated,
            open_weights: model.open_weights,
            cost: model.cost,
            limit: model.limit,
            modalities: model.modalities,
            status: model.status,
            interleaved: model.interleaved,
          });
        }
      }
    }

    cache = {
      models,
      providers,
      lastFetch: Date.now(),
    };

    logger.info(
      `Loaded ${models.length} models from ${providers.length} providers`,
    );
    return cache;
  } catch (error) {
    logger.error("Failed to fetch models.dev data", {
      error:
        error instanceof Error && error.name === "AbortError"
          ? `Request timed out after ${MODELS_DEV_TIMEOUT_MS}ms`
          : error instanceof Error
            ? error.message
            : String(error),
    });

    // Return stale cache if available, otherwise empty
    if (cache) {
      logger.warn("Using stale cache");
      return cache;
    }

    return {
      models: [],
      providers: [],
      lastFetch: 0,
    };
  }
}

/**
 * Get all available models
 */
export async function getAllModels(): Promise<ModelsDevModel[]> {
  const data = await fetchModelsDevData();
  return data.models;
}

/**
 * Get models by provider
 */
export async function getModelsByProvider(
  providerId: string,
): Promise<ModelsDevModel[]> {
  const data = await fetchModelsDevData();
  return data.models.filter((m) => m.provider === providerId);
}

/**
 * Get all providers
 */
export async function getAllProviders(): Promise<ModelsDevProvider[]> {
  const data = await fetchModelsDevData();
  return data.providers;
}

/**
 * Get a specific model by ID
 */
export async function getModelById(
  modelId: string,
): Promise<ModelsDevModel | null> {
  const data = await fetchModelsDevData();
  return data.models.find((m) => m.id === modelId) || null;
}

/**
 * Get models that support tool calling
 */
export async function getToolCallingModels(): Promise<ModelsDevModel[]> {
  const data = await fetchModelsDevData();
  return data.models.filter((m) => m.tool_call === true);
}

/**
 * Calculate estimated cost for a request
 */
export function calculateCost(
  model: ModelsDevModel,
  inputTokens: number,
  outputTokens: number,
): number {
  if (!model.cost) return 0;

  const inputCost = (model.cost.input || 0) * (inputTokens / 1_000_000);
  const outputCost = (model.cost.output || 0) * (outputTokens / 1_000_000);

  return inputCost + outputCost;
}

/**
 * Check if a model supports a specific modality
 */
export function modelSupportsModality(
  model: ModelsDevModel,
  modality: string,
  type: "input" | "output" = "input",
): boolean {
  if (!model.modalities) return false;

  const modalities =
    type === "input" ? model.modalities.input : model.modalities.output;
  return modalities?.includes(modality) || false;
}

/**
 * Get recommended models for agent usage (tool calling + good context)
 */
export async function getRecommendedAgentModels(): Promise<ModelsDevModel[]> {
  const data = await fetchModelsDevData();

  return data.models
    .filter((m) => {
      // Must support tool calling
      if (!m.tool_call) return false;

      // Prefer models with good context limits
      const contextLimit = m.limit?.context || 0;
      if (contextLimit < 8000) return false;

      // Prefer non-deprecated models
      if (m.status === "deprecated") return false;

      return true;
    })
    .sort((a, b) => {
      // Sort by context limit (higher is better)
      const aLimit = a.limit?.context || 0;
      const bLimit = b.limit?.context || 0;
      return bLimit - aLimit;
    });
}
