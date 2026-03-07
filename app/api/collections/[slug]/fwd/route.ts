import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

interface ModuleRow {
  id: string; filename: string; widget_id: string | null; title: string | null;
  description: string | null; version: string | null; author: string | null; file_size: number;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const db = getDb();
  const collection = db.prepare("SELECT * FROM collections WHERE slug = ?").get(slug) as Record<string, unknown> | undefined;
  if (!collection) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const modules = db.prepare(
    "SELECT id, filename, widget_id, title, description, version, author, file_size FROM modules WHERE collection_id = ? ORDER BY created_at"
  ).all(collection.id) as ModuleRow[];

  const siteUrl = process.env.SITE_URL || request.nextUrl.origin;

  const fwd = {
    title: collection.title,
    description: collection.description,
    icon: collection.icon_url || "",
    widgets: modules.map((m) => ({
      id: m.widget_id || m.id,
      title: m.title || m.filename,
      description: m.description || "",
      version: m.version || "1.0.0",
      author: m.author || "",
      url: `${siteUrl}/api/modules/${m.id}/raw`,
    })),
  };

  return NextResponse.json(fwd);
}
