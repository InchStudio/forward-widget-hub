import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { extractToken, authenticateToken, checkRateLimit } from "@/lib/auth";

function getClientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter) } });
  }

  const token = extractToken(request);
  if (!token) return NextResponse.json({ error: "Token required" }, { status: 401 });
  const auth = authenticateToken(token);
  if (!auth) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const db = getDb();
  const collections = db.prepare("SELECT * FROM collections WHERE user_id = ? ORDER BY created_at DESC").all(auth.userId);

  const siteUrl = process.env.SITE_URL || request.nextUrl.origin;

  const result = (collections as Record<string, unknown>[]).map((col) => {
    const modules = db.prepare(
      "SELECT id, filename, widget_id, title, description, version, author, file_size, is_encrypted, created_at FROM modules WHERE collection_id = ? ORDER BY created_at"
    ).all(col.id);

    return { ...col, fwdUrl: `${siteUrl}/api/collections/${col.slug}/fwd`, pageUrl: `${siteUrl}/c/${col.slug}`, modules };
  });

  return NextResponse.json({ collections: result });
}
