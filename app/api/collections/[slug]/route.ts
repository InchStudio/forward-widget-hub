import { NextRequest, NextResponse } from "next/server";
import { getBackendDb, getBackendStore } from "@/lib/backend";
import { extractToken, authenticateToken, checkRateLimit } from "@/lib/auth";

function getClientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const db = await getBackendDb();
  const collection = await db.prepare("SELECT * FROM collections WHERE slug = ?").get(slug) as Record<string, unknown> | undefined;
  if (!collection) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const modules = await db.prepare(
    "SELECT id, filename, widget_id, title, description, version, author, file_size, is_encrypted FROM modules WHERE collection_id = ? ORDER BY created_at"
  ).all(collection.id);

  return NextResponse.json({ collection, modules });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter) } });
  }

  const token = extractToken(request);
  if (!token) return NextResponse.json({ error: "Token required" }, { status: 401 });
  const auth = await authenticateToken(token);
  if (!auth) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const { slug } = await params;
  const db = await getBackendDb();
  const collection = await db.prepare("SELECT id, user_id FROM collections WHERE slug = ?").get(slug) as { id: string; user_id: string } | undefined;
  if (!collection || collection.user_id !== auth.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const title = formData.get("title") as string | null;
  const description = formData.get("description") as string | null;
  const iconFile = formData.get("icon") as File | null;

  let iconUrl: string | undefined;
  if (iconFile && iconFile.size > 0) {
    const store = await getBackendStore();
    const contentType = iconFile.type || "image/png";
    const ext = contentType.includes("png") ? "png"
      : contentType.includes("gif") ? "gif"
      : contentType.includes("webp") ? "webp"
      : contentType.includes("svg") ? "svg"
      : "jpg";
    const buffer = Buffer.from(await iconFile.arrayBuffer());
    const iconFilename = `_icon.${ext}`;
    await store.save(collection.id, iconFilename, buffer);
    const cdnUrl = store.getUrl?.(collection.id, iconFilename);
    const proto = request.headers.get("x-forwarded-proto") || "https";
    const host = request.headers.get("host") || request.nextUrl.host;
    iconUrl = cdnUrl || `${proto}://${host}/api/collections/${slug}/icon`;
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  if (title !== null && title.trim()) { updates.push("title = ?"); values.push(title.trim()); }
  if (description !== null) { updates.push("description = ?"); values.push(description.trim()); }
  if (iconUrl) { updates.push("icon_url = ?"); values.push(iconUrl); }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  updates.push("updated_at = ?");
  values.push(Math.floor(Date.now() / 1000));
  values.push(collection.id);

  await db.prepare(`UPDATE collections SET ${updates.join(", ")} WHERE id = ?`).run(...values);

  return NextResponse.json({ success: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter) } });
  }

  const token = extractToken(request);
  if (!token) return NextResponse.json({ error: "Token required" }, { status: 401 });
  const auth = await authenticateToken(token);
  if (!auth) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const { slug } = await params;
  const db = await getBackendDb();
  const collection = await db.prepare("SELECT id, user_id FROM collections WHERE slug = ?").get(slug) as { id: string; user_id: string } | undefined;
  if (!collection || collection.user_id !== auth.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.prepare("DELETE FROM modules WHERE collection_id = ?").run(collection.id);
  await db.prepare("DELETE FROM collections WHERE id = ?").run(collection.id);
  const store = await getBackendStore();
  await store.removeCollection(collection.id);

  return NextResponse.json({ success: true });
}
