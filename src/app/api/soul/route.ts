import { NextRequest, NextResponse } from "next/server";
import { loadSoul, saveSoul, resetToDefaultSoul } from "@/agent";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const soul = loadSoul();
  return NextResponse.json({ content: soul });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    
    if (!body.content || typeof body.content !== "string") {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }

    saveSoul(body.content);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error saving soul:", error);
    return NextResponse.json(
      { error: "Failed to save soul document" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    resetToDefaultSoul();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error resetting soul:", error);
    return NextResponse.json(
      { error: "Failed to reset soul document" },
      { status: 500 }
    );
  }
}
