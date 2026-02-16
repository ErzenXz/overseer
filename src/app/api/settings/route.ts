import { NextRequest, NextResponse } from "next/server";
import { settingsModel } from "@/database";
import { getCurrentUser } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  requirePermission(user, Permission.SYSTEM_SETTINGS_READ, {
    resource: "settings",
    metadata: { action: "read_settings" },
  });

  const settings = settingsModel.getAll();
  return NextResponse.json({ settings });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  requirePermission(user, Permission.SYSTEM_SETTINGS_WRITE, {
    resource: "settings",
    metadata: { action: "write_settings" },
  });

  try {
    const body = await request.json();

    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "string") {
        settingsModel.set(key, value);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error saving settings:", error);
    return NextResponse.json(
      { error: "Failed to save settings" },
      { status: 500 }
    );
  }
}
