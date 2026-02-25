import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { conversationsModel } from "@/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "100", 10);
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 200) : 100;

  const threads = conversationsModel
    .findAll(safeLimit, 0, user.id)
    .filter((c) => c.interface_type === "web")
    .map((c) => ({
      id: String(c.id),
      title: c.title || "New chat",
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      messageCount: c.message_count,
      status: "regular" as const,
    }));

  return NextResponse.json({ threads });
}

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const conversation = conversationsModel.findOrCreate({
    owner_user_id: user.id,
    interface_type: "web",
    external_chat_id: `webui-thread-${user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    external_user_id: String(user.id),
    external_username: user.username,
    title: "New chat",
  });

  return NextResponse.json({
    thread: {
      id: String(conversation.id),
      title: conversation.title || "New chat",
      status: "regular" as const,
      createdAt: conversation.created_at,
      updatedAt: conversation.updated_at,
      messageCount: conversation.message_count,
    },
  });
}
