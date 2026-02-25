import { NextResponse } from "next/server";

const THEME_NAME_RE = /^[a-z0-9-]+$/;

export async function GET(
  _req: Request,
  context: { params: Promise<{ name: string }> },
) {
  const { name } = await context.params;

  if (!THEME_NAME_RE.test(name)) {
    return NextResponse.json({ error: "Invalid theme name" }, { status: 400 });
  }

  try {
    const res = await fetch(`https://tweakcn.com/r/themes/${name}.json`, {
      next: { revalidate: 60 * 60 },
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Theme not found" }, { status: 404 });
    }

    const data = (await res.json()) as {
      name?: string;
      title?: string;
      cssVars?: {
        theme?: Record<string, string>;
        light?: Record<string, string>;
        dark?: Record<string, string>;
      };
    };

    return NextResponse.json({
      name: data.name ?? name,
      title: data.title ?? name,
      cssVars: {
        theme: data.cssVars?.theme ?? {},
        light: data.cssVars?.light ?? {},
        dark: data.cssVars?.dark ?? {},
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to load theme" }, { status: 500 });
  }
}
