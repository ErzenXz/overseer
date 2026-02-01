import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { conversationsModel, messagesModel } from "@/database";

// Get conversation history
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { conversationId } = await params;
  const id = parseInt(conversationId, 10);

  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid conversation ID" }, { status: 400 });
  }

  const conversation = conversationsModel.findById(id);
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const messages = messagesModel.findByConversation(id, 100);

  return NextResponse.json({
    conversation,
    messages,
  });
}

// Delete conversation
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { conversationId } = await params;
  const id = parseInt(conversationId, 10);

  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid conversation ID" }, { status: 400 });
  }

  const conversation = conversationsModel.findById(id);
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Clear messages first (due to foreign key constraint)
  conversationsModel.clearMessages(id);
  conversationsModel.delete(id);

  return NextResponse.json({ success: true });
}
