import { NextRequest, NextResponse } from "next/server";
import { providersModel } from "@/database";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const providers = providersModel.findAll();
  
  // Don't expose API keys
  const safeProviders = providers.map((p) => ({
    ...p,
    api_key_encrypted: p.api_key_encrypted ? "***" : null,
  }));

  return NextResponse.json({ providers: safeProviders });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    const provider = providersModel.create({
      name: body.name,
      display_name: body.display_name,
      api_key: body.api_key,
      base_url: body.base_url,
      model: body.model,
      is_active: body.is_active !== false,
      is_default: body.is_default || false,
      priority: body.priority || 0,
      max_tokens: body.max_tokens || 4096,
      temperature: body.temperature || 0.7,
    });

    return NextResponse.json({
      success: true,
      provider: {
        ...provider,
        api_key_encrypted: provider.api_key_encrypted ? "***" : null,
      },
    });
  } catch (error) {
    console.error("Error creating provider:", error);
    return NextResponse.json(
      { error: "Failed to create provider" },
      { status: 500 }
    );
  }
}
