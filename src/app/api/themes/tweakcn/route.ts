import { NextResponse } from "next/server";

const REGISTRY_URL = "https://tweakcn.com/r/themes/registry.json";

type RegistryItem = {
  name: string;
  title?: string;
  description?: string;
};

export async function GET() {
  try {
    const res = await fetch(REGISTRY_URL, {
      next: { revalidate: 60 * 60 },
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Failed to fetch tweakcn theme registry" }, { status: 502 });
    }

    const data = (await res.json()) as { items?: RegistryItem[] };

    const themes = (data.items ?? [])
      .map((item) => ({
        name: item.name,
        title: item.title ?? item.name,
        description: item.description,
      }))
      .sort((a, b) => a.title.localeCompare(b.title));

    return NextResponse.json({ themes });
  } catch {
    return NextResponse.json({ error: "Failed to load tweakcn themes" }, { status: 500 });
  }
}
