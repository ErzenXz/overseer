import { NextRequest, NextResponse } from "next/server";
import { providersModel } from "@/database";
import { getCurrentUser } from "@/lib/auth";

export async function GET(
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

  return NextResponse.json({
    provider: {
      ...provider,
      api_key_encrypted: provider.api_key_encrypted ? "***" : null,
    },
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();

  const provider = providersModel.update(parseInt(id), {
    name: body.name,
    display_name: body.display_name,
    api_key: body.api_key,
    base_url: body.base_url,
    model: body.model,
    is_active: body.is_active,
    is_default: body.is_default,
    priority: body.priority,
    max_tokens: body.max_tokens,
    temperature: body.temperature,
  });

  if (!provider) {
    return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    provider: {
      ...provider,
      api_key_encrypted: provider.api_key_encrypted ? "***" : null,
    },
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const deleted = providersModel.delete(parseInt(id));

  if (!deleted) {
    return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
