import { NextRequest, NextResponse } from "next/server";
import { providersModel } from "@/database";
import { getCurrentUser } from "@/lib/auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  providersModel.setDefault(parseInt(id));

  return NextResponse.json({ success: true });
}
