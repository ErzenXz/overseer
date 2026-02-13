import { NextResponse } from "next/server";
import {
  createMemory,
  updateMemory,
  deleteMemory,
  getMemoryById,
  getAllMemoriesForUser,
  searchMemoriesForUser,
  getMemoryStatsForUser,
} from "@/agent/super-memory";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");
    const category = searchParams.get("category") as "preference" | "fact" | "project" | "context" | "custom" | null;
    const id = searchParams.get("id");
    const query = searchParams.get("q");

    if (action === "stats") {
      return NextResponse.json(getMemoryStatsForUser(user.id));
    }

    if (id) {
      const memory = getMemoryById(parseInt(id));
      if (!memory) {
        return NextResponse.json({ error: "Memory not found" }, { status: 404 });
      }
      if (memory.owner_user_id !== user.id && memory.scope !== "shared") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.json(memory);
    }

    if (query) {
      return NextResponse.json(searchMemoriesForUser(user.id, query));
    }

    return NextResponse.json(getAllMemoriesForUser(user.id, category || undefined));
  } catch (error) {
    console.error("Memory API error:", error);
    return NextResponse.json(
      { error: "Failed to access memory" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { key, value, category, importance, source, scope } = body;

    if (!key || !value) {
      return NextResponse.json(
        { error: "key and value are required" },
        { status: 400 }
      );
    }

    const memory = createMemory(
      user.id,
      key,
      value,
      category as "preference" | "fact" | "project" | "context" | "custom",
      importance,
      source,
      scope
    );
    return NextResponse.json(memory);
  } catch (error) {
    console.error("Memory create error:", error);
    return NextResponse.json(
      { error: "Failed to create memory" },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id, key, value, category, importance, scope } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const existing = getMemoryById(id);
    if (!existing) {
      return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    }
    if (existing.owner_user_id !== user.id && existing.scope !== "shared") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const memory = updateMemory(id, { key, value, category, importance, scope });
    if (!memory) {
      return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    }

    return NextResponse.json(memory);
  } catch (error) {
    console.error("Memory update error:", error);
    return NextResponse.json(
      { error: "Failed to update memory" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const existing = getMemoryById(parseInt(id));
    if (!existing) {
      return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    }
    if (existing.owner_user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const deleted = deleteMemory(parseInt(id));
    return NextResponse.json({ success: deleted });
  } catch (error) {
    console.error("Memory delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete memory" },
      { status: 500 }
    );
  }
}
