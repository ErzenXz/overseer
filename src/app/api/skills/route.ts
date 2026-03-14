import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listSkillsWithToolsForUser } from "@/agent/skills/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const skills = listSkillsWithToolsForUser(user.id)
    .filter((skill) => skill.active)
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ skills });
}
