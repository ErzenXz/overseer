import { NextRequest, NextResponse } from "next/server";
import { interfacesModel } from "@/database";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, Permission } from "@/lib/permissions";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const canViewAll = hasPermission(user, Permission.TENANT_VIEW_ALL);
  const interfaces = canViewAll
    ? interfacesModel.findAll()
    : interfacesModel.findAllByOwner(user.id);
  
  // Don't expose tokens
  const safeInterfaces = interfaces.map((i) => {
    const config = JSON.parse(i.config) as Record<string, unknown>;
    const masked = { ...config };
    for (const key of [
      "bot_token",
      "webhook_secret",
      "signing_secret",
      "app_token",
      "access_token",
      "refresh_token",
      "client_secret",
    ]) {
      if (masked[key]) masked[key] = "***";
    }
    return {
      ...i,
      config: JSON.stringify({
        ...masked,
      }),
    };
  });

  return NextResponse.json({ interfaces: safeInterfaces });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    const iface = interfacesModel.create({
      owner_user_id: user.id,
      type: body.type,
      name: body.name,
      config: body.config,
      is_active: body.is_active !== false,
      allowed_users: body.allowed_users,
    });

    return NextResponse.json({ success: true, interface: iface });
  } catch (error) {
    console.error("Error creating interface:", error);
    return NextResponse.json(
      { error: "Failed to create interface" },
      { status: 500 }
    );
  }
}
