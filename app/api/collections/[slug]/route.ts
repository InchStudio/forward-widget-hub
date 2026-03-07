import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const db = getDb();
  const collection = db.prepare("SELECT * FROM collections WHERE slug = ?").get(slug) as Record<string, unknown> | undefined;
  if (!collection) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const modules = db.prepare(
    "SELECT id, filename, widget_id, title, description, version, author, file_size, is_encrypted FROM modules WHERE collection_id = ? ORDER BY created_at"
  ).all(collection.id);

  return NextResponse.json({ collection, modules });
}
