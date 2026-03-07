import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readModule } from "@/lib/storage";

interface ModuleRow { id: string; collection_id: string; filename: string; is_encrypted: number; }

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const mod = db.prepare("SELECT id, collection_id, filename, is_encrypted FROM modules WHERE id = ?").get(id) as ModuleRow | undefined;
  if (!mod) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const content = readModule(mod.collection_id, mod.filename);
  if (!content) return NextResponse.json({ error: "File not found" }, { status: 404 });

  const contentType = mod.is_encrypted ? "application/octet-stream" : "application/javascript; charset=utf-8";

  return new NextResponse(content, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${mod.filename}"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
