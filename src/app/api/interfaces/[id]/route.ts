import { NextRequest, NextResponse } from "next/server";
import { interfacesModel } from "@/database";
import { getCurrentUser } from "@/lib/auth";
import { syncInterfaceServiceState } from "@/lib/interface-services";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const iface = interfacesModel.findById(parseInt(id));

  if (!iface) {
    return NextResponse.json({ error: "Interface not found" }, { status: 404 });
  }

  return NextResponse.json({ interface: iface });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();

  const existing = interfacesModel.findById(parseInt(id));
  const iface = interfacesModel.update(parseInt(id), {
    type: body.type,
    name: body.name,
    config: body.config,
    is_active: body.is_active,
    allowed_users: body.allowed_users,
  });

  if (!iface) {
    return NextResponse.json({ error: "Interface not found" }, { status: 404 });
  }

  let serviceSync:
    | { attempted: boolean; ok: boolean; message?: string }
    | undefined;

  // If active state changed, try to sync service runtime state as well.
  if (
    existing &&
    body.is_active !== undefined &&
    Boolean(existing.is_active) !== Boolean(iface.is_active)
  ) {
    serviceSync = await syncInterfaceServiceState(
      iface.type,
      Boolean(iface.is_active),
    );
  }

  return NextResponse.json({ success: true, interface: iface, serviceSync });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const deleted = interfacesModel.delete(parseInt(id));

  if (!deleted) {
    return NextResponse.json({ error: "Interface not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
