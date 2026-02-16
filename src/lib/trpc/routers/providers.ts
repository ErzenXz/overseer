import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { providersModel } from "@/database";
import { getDynamicProviderCatalog } from "@/agent/dynamic-provider-catalog";
import { getAllProvidersInfo } from "@/agent/providers";

const createProviderSchema = z.object({
  name: z.string().min(1, "Provider name is required"),
  display_name: z.string().min(1, "Display name is required"),
  api_key: z.string().optional(),
  base_url: z.string().optional(),
  model: z.string().min(1, "Model is required"),
  temperature: z.number().min(0).max(2).default(0.7),
  is_default: z.boolean().default(false),
  priority: z.number().int().default(0),
  config: z.record(z.string(), z.unknown()).optional(),
});

const updateProviderSchema = z.object({
  id: z.number().int(),
  name: z.string().optional(),
  display_name: z.string().optional(),
  api_key: z.string().optional(),
  base_url: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  is_active: z.boolean().optional(),
  is_default: z.boolean().optional(),
  priority: z.number().int().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

function sanitizeProvider(p: any) {
  return { ...p, api_key_encrypted: p.api_key_encrypted ? "***" : null };
}

function inferRuntimeAdapter(providerId: string, npm?: string): string {
  const npmMap: Record<string, string> = {
    "@ai-sdk/openai": "openai",
    "@ai-sdk/anthropic": "anthropic",
    "@ai-sdk/google": "google",
    "@ai-sdk/azure": "azure",
    "@ai-sdk/groq": "groq",
    "@ai-sdk/cohere": "cohere",
    "@ai-sdk/mistral": "mistral",
    "@ai-sdk/xai": "xai",
    "@ai-sdk/perplexity": "perplexity",
    "@ai-sdk/fireworks": "fireworks",
    "@ai-sdk/togetherai": "togetherai",
    "@ai-sdk/deepinfra": "deepinfra",
    "@ai-sdk/deepseek": "deepseek",
    "@ai-sdk/amazon-bedrock": "amazon-bedrock",
  };
  if (npm && npmMap[npm]) return npmMap[npm];
  return npmMap[`@ai-sdk/${providerId}`] || "openai-compatible";
}

export const providersRouter = router({
  list: authedProcedure.query(() => {
    const providers = providersModel.findAll();
    return providers.map(sanitizeProvider);
  }),

  getById: authedProcedure
    .input(z.object({ id: z.number().int() }))
    .query(({ input }) => {
      const provider = providersModel.findById(input.id);
      if (!provider) throw new TRPCError({ code: "NOT_FOUND", message: "Provider not found" });
      return sanitizeProvider(provider);
    }),

  create: authedProcedure
    .input(createProviderSchema)
    .mutation(({ input }) => {
      const provider = providersModel.create({
        name: input.name,
        display_name: input.display_name,
        api_key: input.api_key,
        base_url: input.base_url,
        model: input.model,
        is_active: true,
        is_default: input.is_default,
        priority: input.priority,
        temperature: input.temperature,
        config: input.config,
      });
      return sanitizeProvider(provider);
    }),

  update: authedProcedure
    .input(updateProviderSchema)
    .mutation(({ input }) => {
      const { id, ...data } = input;
      const provider = providersModel.update(id, {
        name: data.name,
        display_name: data.display_name,
        api_key: data.api_key,
        base_url: data.base_url,
        model: data.model,
        is_active: data.is_active,
        is_default: data.is_default,
        priority: data.priority,
        temperature: data.temperature,
        config: data.config,
      });
      if (!provider) throw new TRPCError({ code: "NOT_FOUND", message: "Provider not found" });
      return sanitizeProvider(provider);
    }),

  delete: authedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(({ input }) => {
      const deleted = providersModel.delete(input.id);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "Provider not found" });
      return { success: true };
    }),

  setDefault: authedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(({ input }) => {
      providersModel.setDefault(input.id);
      return { success: true };
    }),

  catalog: authedProcedure.query(async () => {
    const staticFallback = getAllProvidersInfo().map((p) => ({
      id: p.id,
      displayName: p.displayName,
      requiresKey: p.requiresKey,
      description: p.description,
      npm: p.npm,
      supportsThinking: p.supportsThinking,
      supportsMultimodal: p.supportsMultimodal,
      models: p.models,
      source: "static" as const,
    }));

    const timeoutMs = Number.parseInt(
      process.env.OVERSEER_PROVIDER_CATALOG_TIMEOUT_MS || "2500",
      10,
    );

    try {
      const providers = await Promise.race([
        getDynamicProviderCatalog(),
        new Promise<typeof staticFallback>((resolve) =>
          setTimeout(() => resolve(staticFallback as any), timeoutMs),
        ) as any,
      ]);

      return (providers as any[]).map((provider: any) => ({
        ...provider,
        runtimeAdapter: inferRuntimeAdapter(provider.id, provider.npm),
      }));
    } catch {
      return staticFallback.map((p) => ({
        ...p,
        runtimeAdapter: inferRuntimeAdapter(p.id, p.npm),
      }));
    }
  }),
});
