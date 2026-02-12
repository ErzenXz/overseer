import {
  getAllProviders as getModelsDevProviders,
  getModelsByProvider,
} from "./models-dev";
import { PROVIDER_INFO, type Modality, type ModelInfo } from "./provider-info";

export interface DynamicProviderCatalogEntry {
  id: string;
  displayName: string;
  requiresKey: boolean;
  description: string;
  npm: string;
  apiBaseUrl?: string;
  env?: string[];
  supportsThinking: boolean;
  supportsMultimodal: boolean;
  models: ModelInfo[];
  source: "models.dev" | "static";
}

let dynamicCache: {
  fetchedAt: number;
  providers: DynamicProviderCatalogEntry[];
} | null = null;
const DYNAMIC_CACHE_TTL_MS = 10 * 60 * 1000;

function toModality(value: string): Modality | null {
  if (
    value === "text" ||
    value === "image" ||
    value === "audio" ||
    value === "video" ||
    value === "pdf"
  ) {
    return value;
  }
  return null;
}

function inferCostTier(inputCost?: number): ModelInfo["costTier"] {
  if (inputCost === undefined || inputCost === null) return "medium";
  if (inputCost <= 0) return "free";
  if (inputCost <= 0.3) return "low";
  if (inputCost <= 2) return "medium";
  if (inputCost <= 10) return "high";
  return "premium";
}

function normalizeModel(raw: any): ModelInfo {
  const inputModalities = (raw.modalities?.input ?? [])
    .map((m: string) => toModality(m))
    .filter(Boolean) as Modality[];

  const outputModalities = (raw.modalities?.output ?? [])
    .map((m: string) => toModality(m))
    .filter(Boolean) as Modality[];

  const reasoning = Boolean(raw.reasoning);

  return {
    id: String(raw.id),
    name: String(raw.name || raw.id),
    contextWindow: Number(raw.limit?.context ?? 0),
    maxOutput: Number(raw.limit?.output ?? 0),
    supportsTools: Boolean(raw.tool_call),
    supportsThinking: reasoning || Boolean(raw.interleaved),
    supportsMultimodal:
      inputModalities.some((m) => m !== "text") ||
      outputModalities.some((m) => m !== "text"),
    supportsStreaming: true,
    supportsStructuredOutput: Boolean(raw.structured_output ?? raw.tool_call),
    reasoning,
    costTier: inferCostTier(raw.cost?.input),
    inputModalities: inputModalities.length > 0 ? inputModalities : ["text"],
    outputModalities: outputModalities.length > 0 ? outputModalities : ["text"],
    costPerMillionInput: raw.cost?.input,
    costPerMillionOutput: raw.cost?.output,
    cacheCostRead: raw.cost?.cache_read,
    cacheCostWrite: raw.cost?.cache_write,
    knowledgeCutoff: raw.knowledge,
    allowsTemperature: raw.temperature !== false,
  };
}

function getStaticProviders(): DynamicProviderCatalogEntry[] {
  return Object.entries(PROVIDER_INFO).map(([id, info]) => ({
    id,
    displayName: info.displayName,
    requiresKey: info.requiresKey,
    description: info.description,
    npm: info.npm,
    supportsThinking: info.supportsThinking,
    supportsMultimodal: info.supportsMultimodal,
    models: info.models,
    source: "static" as const,
  }));
}

export async function getDynamicProviderCatalog(): Promise<
  DynamicProviderCatalogEntry[]
> {
  if (
    dynamicCache &&
    Date.now() - dynamicCache.fetchedAt < DYNAMIC_CACHE_TTL_MS
  ) {
    return dynamicCache.providers;
  }

  try {
    const providers = await getModelsDevProviders();

    if (!providers.length) {
      return getStaticProviders();
    }

    const catalogEntries = await Promise.all(
      providers.map(async (provider) => {
        const providerModels = await getModelsByProvider(provider.id);
        const normalizedModels = providerModels.map((m) => normalizeModel(m));

        return {
          id: provider.id,
          displayName: provider.name,
          requiresKey: (provider.env?.length ?? 0) > 0,
          description:
            provider.doc || `Dynamic provider from models.dev (${provider.id})`,
          npm: provider.npm || "@ai-sdk/openai-compatible",
          apiBaseUrl: provider.api,
          env: provider.env,
          supportsThinking: normalizedModels.some((m) => m.supportsThinking),
          supportsMultimodal: normalizedModels.some(
            (m) => m.supportsMultimodal,
          ),
          models: normalizedModels,
          source: "models.dev" as const,
        };
      }),
    );

    dynamicCache = {
      fetchedAt: Date.now(),
      providers: catalogEntries,
    };

    return catalogEntries;
  } catch {
    return getStaticProviders();
  }
}

export async function findDynamicModelInfo(
  providerId: string,
  modelId: string,
): Promise<ModelInfo | null> {
  const catalog = await getDynamicProviderCatalog();
  const provider = catalog.find((p) => p.id === providerId);
  if (!provider) return null;

  const exact = provider.models.find((m) => m.id === modelId);
  if (exact) return exact;

  const slashNormalized = modelId.includes("/")
    ? modelId.split("/").slice(1).join("/")
    : modelId;
  const normalized = provider.models.find((m) => m.id === slashNormalized);
  return normalized ?? null;
}
