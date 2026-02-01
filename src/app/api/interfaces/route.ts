import { NextRequest, NextResponse } from "next/server";
import { interfacesModel } from "@/database";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const interfaces = interfacesModel.findAll();
  
  // Don't expose tokens
  const safeInterfaces = interfaces.map((i) => {
    const config = JSON.parse(i.config);
    return {
      ...i,
      config: JSON.stringify({
        ...config,
        bot_token: config.bot_token ? "***" : null,
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
