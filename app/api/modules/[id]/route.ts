import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { extractToken, authenticateToken, checkRateLimit } from "@/lib/auth";
import { deleteModule as deleteModuleFile } from "@/lib/storage";

function getClientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter) } });
  }

  const token = extractToken(request);
  if (!token) return NextResponse.json({ error: "Token required" }, { status: 401 });
  const auth = authenticateToken(token);
  if (!auth) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const mod = db.prepare(
    `SELECT m.id, m.collection_id, m.filename, c.user_id
     FROM modules m JOIN collections c ON m.collection_id = c.id WHERE m.id = ?`
  ).get(id) as { id: string; collection_id: string; filename: string; user_id: string } | undefined;

  if (!mod || mod.user_id !== auth.userId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  db.prepare("DELETE FROM modules WHERE id = ?").run(id);
  deleteModuleFile(mod.collection_id, mod.filename);

  return NextResponse.json({ success: true });
}
