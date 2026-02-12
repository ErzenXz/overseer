import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { testInterfaceById } from "@/lib/interface-health";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const interfaceId = Number.parseInt(id, 10);

  if (!Number.isFinite(interfaceId)) {
    return NextResponse.json(
      { error: "Invalid interface ID" },
      { status: 400 },
    );
  }

  try {
    const result = await testInterfaceById(interfaceId);
    return NextResponse.json({ success: result.ok, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
