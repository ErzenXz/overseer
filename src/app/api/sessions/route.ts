/**
 * Session Management API
 * Endpoints for managing agent sessions, viewing stats, and controlling cleanup
 */

import { NextRequest, NextResponse } from "next/server";
import { SessionManager } from "../../../lib/session-manager";
import { agentSessionsModel } from "../../../database/models/agent-sessions";
import { getCurrentUser } from "../../../lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/sessions
 * Get all active sessions or specific session by ID
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("id");
    const conversationId = searchParams.get("conversationId");
    const stats = searchParams.get("stats");

    // Get statistics
    if (stats === "true") {
      const statistics = SessionManager.getStats();
      return NextResponse.json({ success: true, data: statistics });
    }

    // Get specific session by ID
    if (sessionId) {
      const id = parseInt(sessionId, 10);
      if (isNaN(id)) {
        return NextResponse.json(
          { error: "Invalid session ID" },
          { status: 400 }
        );
      }

      const session = SessionManager.getSession(id);
      if (!session) {
        return NextResponse.json(
          { error: "Session not found" },
          { status: 404 }
        );
      }

      return NextResponse.json({ success: true, data: session });
    }

    // Get session by conversation ID
    if (conversationId) {
      const id = parseInt(conversationId, 10);
      if (isNaN(id)) {
        return NextResponse.json(
          { error: "Invalid conversation ID" },
          { status: 400 }
        );
      }

      const session = agentSessionsModel.findByConversation(id);
      if (!session) {
        return NextResponse.json(
          { error: "Session not found" },
          { status: 404 }
        );
      }

      return NextResponse.json({ success: true, data: session });
    }

    // Get all active sessions
    const limit = parseInt(searchParams.get("limit") || "100", 10);
    const sessions = agentSessionsModel.findAllActive(limit);

    return NextResponse.json({
      success: true,
      data: sessions,
      count: sessions.length,
    });
  } catch (error) {
    console.error("Error in GET /api/sessions:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/sessions
 * Create a new session or perform actions on existing sessions
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { action, sessionId, conversationId, data } = body;

    // Handle different actions
    switch (action) {
      case "create": {
        if (!conversationId) {
          return NextResponse.json(
            { error: "Missing conversationId" },
            { status: 400 }
          );
        }

        const session = SessionManager.getOrCreateSession({
          conversation_id: conversationId,
          interface_type: data?.interface_type || "web",
          external_user_id: data?.external_user_id || "admin",
          external_chat_id: data?.external_chat_id || "admin",
          token_limit: data?.token_limit,
          expires_in_ms: data?.expires_in_ms,
          state: data?.state,
          metadata: data?.metadata,
        });

        return NextResponse.json({ success: true, data: session });
      }

      case "addMessage": {
        if (!sessionId || !data?.role || !data?.content) {
          return NextResponse.json(
            { error: "Missing required fields" },
            { status: 400 }
          );
        }

        const session = SessionManager.addMessage(
          sessionId,
          data.role,
          data.content,
          data.metadata
        );

        if (!session) {
          return NextResponse.json(
            { error: "Session not found" },
            { status: 404 }
          );
        }

        return NextResponse.json({ success: true, data: session });
      }

      case "clearMessages": {
        if (!sessionId) {
          return NextResponse.json(
            { error: "Missing sessionId" },
            { status: 400 }
          );
        }

        const session = SessionManager.clearMessages(sessionId);
        if (!session) {
          return NextResponse.json(
            { error: "Session not found" },
            { status: 404 }
          );
        }

        return NextResponse.json({ success: true, data: session });
      }

      case "updateState": {
        if (!sessionId || !data) {
          return NextResponse.json(
            { error: "Missing sessionId or state data" },
            { status: 400 }
          );
        }

        const session = SessionManager.updateState(sessionId, data);
        if (!session) {
          return NextResponse.json(
            { error: "Session not found" },
            { status: 404 }
          );
        }

        return NextResponse.json({ success: true, data: session });
      }

      case "deactivate": {
        if (!sessionId) {
          return NextResponse.json(
            { error: "Missing sessionId" },
            { status: 400 }
          );
        }

        const success = SessionManager.deactivateSession(sessionId);
        return NextResponse.json({ success });
      }

      case "cleanup": {
        SessionManager.cleanup();
        return NextResponse.json({ success: true, message: "Cleanup initiated" });
      }

      case "buildContext": {
        if (!sessionId) {
          return NextResponse.json(
            { error: "Missing sessionId" },
            { status: 400 }
          );
        }

        const maxMessages = data?.maxMessages || 20;
        const context = SessionManager.buildContext(sessionId, maxMessages);

        return NextResponse.json({ success: true, data: context });
      }

      default:
        return NextResponse.json(
          { error: "Unknown action" },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("Error in POST /api/sessions:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/sessions
 * Delete a session
 */
export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("id");

    if (!sessionId) {
      return NextResponse.json(
        { error: "Missing session ID" },
        { status: 400 }
      );
    }

    const id = parseInt(sessionId, 10);
    if (isNaN(id)) {
      return NextResponse.json(
        { error: "Invalid session ID" },
        { status: 400 }
      );
    }

    const success = agentSessionsModel.delete(id);
    
    if (!success) {
      return NextResponse.json(
        { error: "Session not found or already deleted" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error in DELETE /api/sessions:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
