import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { conversationsModel } from "@/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// List user's web conversations for the chat sidebar
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const conversations = conversationsModel
    .findAll(50, 0, user.id)
    .filter((c) => c.interface_type === "web")
    .map((c) => ({
      id: c.id,
      title: c.title || "New conversation",
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      messageCount: c.message_count,
    }));

  return NextResponse.json({ conversations });
}
