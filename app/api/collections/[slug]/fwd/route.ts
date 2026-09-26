import { NextRequest, NextResponse } from "next/server";
import { getBackendDb, getBackendStore } from "@/lib/backend";

interface ModuleRow {
  id: string; collection_id: string; filename: string; widget_id: string | null; title: string | null;
  description: string | null; version: string | null; author: string | null;
  required_version: string | null; file_size: number; updated_at: number | null;
  oss_key: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const ua = request.headers.get("user-agent") || "";
  if (!ua.includes("Forward") && !ua.includes("Rex")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { slug } = await params;
  const db = await getBackendDb();
  const collection = await db.prepare("SELECT * FROM collections WHERE slug = ?").get(slug) as Record<string, unknown> | undefined;
  if (!collection) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const modules = await db.prepare(
    "SELECT id, collection_id, filename, widget_id, title, description, version, author, required_version, file_size, updated_at, oss_key FROM modules WHERE collection_id = ? ORDER BY created_at"
  ).all(collection.id) as ModuleRow[];

  const store = await getBackendStore();
  const proto = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("host") || request.nextUrl.host;
  const siteUrl = `${proto}://${host}`;

  const fwd = {
    title: collection.title,
    description: collection.description,
    icon: collection.icon_url || "",
    widgets: modules.map((m) => ({
      id: m.widget_id || m.id,
      title: m.title || m.filename,
      description: m.description || "",
      requiredVersion: m.required_version || "0.0.1",
      version: m.version || "1.0.0",
      author: m.author || "",
      url: (() => {
        const storageKey = m.oss_key || m.filename;
        const base = store.getUrl?.(m.collection_id, storageKey) || `${siteUrl}/api/modules/${m.id}/raw`;
        return m.updated_at ? `${base}?v=${m.updated_at}` : base;
      })(),
    })),
  };

  return NextResponse.json(fwd, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Vary": "User-Agent",
    },
  });
}
