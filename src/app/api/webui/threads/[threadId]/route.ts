import { NextRequest, NextResponse } from "next/server";
import { conversationsModel } from "@/database";
import { getCurrentUser } from "@/lib/auth";

function parseId(threadId: string): number | null {
  const id = Number.parseInt(threadId, 10);
  if (!Number.isFinite(id) || id <= 0) return null;
  return id;
}

async function getOwnedConversation(threadId: string) {
  const user = await getCurrentUser();
  if (!user) return { user: null, conversation: null };

  const id = parseId(threadId);
  if (!id) return { user, conversation: null };

  const conversation = conversationsModel.findById(id);
  if (!conversation) return { user, conversation: null };

  if (conversation.owner_user_id !== user.id || conversation.interface_type !== "web") {
    return { user, conversation: null };
  }

  return { user, conversation };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await params;
  const { user, conversation } = await getOwnedConversation(threadId);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!conversation) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await params;
  const { user, conversation } = await getOwnedConversation(threadId);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!conversation) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const title = typeof body?.title === "string" ? body.title.trim() : "";

  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  const updated = conversationsModel.update(conversation.id, { title });

  return NextResponse.json({
    thread: {
      id: String(updated?.id ?? conversation.id),
      title: updated?.title || title,
      status: "regular" as const,
      createdAt: updated?.created_at ?? conversation.created_at,
      updatedAt: updated?.updated_at ?? conversation.updated_at,
      messageCount: updated?.message_count ?? conversation.message_count,
    },
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await params;
  const { user, conversation } = await getOwnedConversation(threadId);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!conversation) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  conversationsModel.clearMessages(conversation.id);
  conversationsModel.delete(conversation.id);

  return NextResponse.json({ success: true });
}
