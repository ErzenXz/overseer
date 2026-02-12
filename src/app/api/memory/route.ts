import { NextResponse } from "next/server";
import {
  getAllMemories,
  createMemory,
  updateMemory,
  deleteMemory,
  getMemoryById,
  searchMemories,
  getMemoryStats,
} from "@/agent/super-memory";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");
    const category = searchParams.get("category") as "preference" | "fact" | "project" | "context" | "custom" | null;
    const id = searchParams.get("id");
    const query = searchParams.get("q");

    if (action === "stats") {
      return NextResponse.json(getMemoryStats());
    }

    if (id) {
      const memory = getMemoryById(parseInt(id));
      if (!memory) {
        return NextResponse.json({ error: "Memory not found" }, { status: 404 });
      }
      return NextResponse.json(memory);
    }

    if (query) {
      return NextResponse.json(searchMemories(query));
    }

    return NextResponse.json(getAllMemories(category || undefined));
  } catch (error) {
    console.error("Memory API error:", error);
    return NextResponse.json(
      { error: "Failed to access memory" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { key, value, category, importance, source } = body;

    if (!key || !value) {
      return NextResponse.json(
        { error: "key and value are required" },
        { status: 400 }
      );
    }

    const memory = createMemory(
      key,
      value,
      category as "preference" | "fact" | "project" | "context" | "custom",
      importance,
      source
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
  try {
    const body = await request.json();
    const { id, key, value, category, importance } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const memory = updateMemory(id, { key, value, category, importance });
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
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
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
