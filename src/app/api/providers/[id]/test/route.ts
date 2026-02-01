import { NextRequest, NextResponse } from "next/server";
import { providersModel } from "@/database";
import { testProvider, type ProviderName } from "@/agent";
import { decrypt } from "@/lib/crypto";
import { getCurrentUser } from "@/lib/auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const provider = providersModel.findById(parseInt(id));

  if (!provider) {
    return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  }

  try {
    const apiKey = provider.api_key_encrypted
      ? decrypt(provider.api_key_encrypted)
      : undefined;

    const result = await testProvider({
      name: provider.name as ProviderName,
      apiKey,
      baseUrl: provider.base_url || undefined,
      model: provider.model,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Test failed",
    });
  }
}
