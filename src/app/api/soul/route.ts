import { NextRequest, NextResponse } from "next/server";
import {
  loadSoul,
  loadUserSoulSupplement,
  saveUserSoulSupplement,
  resetUserSoulSupplement,
} from "@/agent";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Return the per-user supplement for editing (effective soul is base + supplement).
  const supplement = loadUserSoulSupplement(user.id);
  const effective = loadSoul(user.id);
  return NextResponse.json({ content: supplement, effective });
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

    saveUserSoulSupplement(user.id, body.content);
    
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
    resetUserSoulSupplement(user.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error resetting soul:", error);
    return NextResponse.json(
      { error: "Failed to reset soul document" },
      { status: 500 }
    );
  }
}
