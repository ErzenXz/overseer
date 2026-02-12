import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDynamicProviderCatalog } from "@/agent/dynamic-provider-catalog";

function inferRuntimeAdapter(providerId: string, npm?: string): string {
  if (npm === "@ai-sdk/openai") return "openai";
  if (npm === "@ai-sdk/anthropic") return "anthropic";
  if (npm === "@ai-sdk/google") return "google";
  if (npm === "@ai-sdk/azure") return "azure";
  if (npm === "@ai-sdk/groq") return "groq";
  if (npm === "@ai-sdk/cohere") return "cohere";
  if (npm === "@ai-sdk/mistral") return "mistral";
  if (npm === "@ai-sdk/xai") return "xai";
  if (npm === "@ai-sdk/perplexity") return "perplexity";
  if (npm === "@ai-sdk/fireworks") return "fireworks";
  if (npm === "@ai-sdk/togetherai") return "togetherai";
  if (npm === "@ai-sdk/deepinfra") return "deepinfra";
  if (npm === "@ai-sdk/deepseek") return "deepseek";
  if (npm === "@ai-sdk/amazon-bedrock") return "amazon-bedrock";

  if (providerId === "openai") return "openai";
  if (providerId === "anthropic") return "anthropic";
  if (providerId === "google") return "google";
  if (providerId === "azure") return "azure";
  if (providerId === "groq") return "groq";
  if (providerId === "cohere") return "cohere";
  if (providerId === "mistral") return "mistral";
  if (providerId === "xai") return "xai";
  if (providerId === "perplexity") return "perplexity";
  if (providerId === "fireworks") return "fireworks";
  if (providerId === "togetherai") return "togetherai";
  if (providerId === "deepinfra") return "deepinfra";
  if (providerId === "deepseek") return "deepseek";
  if (providerId === "amazon-bedrock") return "amazon-bedrock";

  return "openai-compatible";
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const providers = await getDynamicProviderCatalog();

  return NextResponse.json({
    providers: providers.map((provider) => ({
      ...provider,
      runtimeAdapter: inferRuntimeAdapter(provider.id, provider.npm),
    })),
  });
}
