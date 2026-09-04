import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getDb, uploadsDir } from "@/lib/db";
import { requireApiSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiSession(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const row = getDb()
    .prepare(
      `SELECT attachment.storage_path, attachment.mime_type, attachment.original_name
       FROM attachments attachment
       JOIN captures capture ON capture.id = attachment.capture_id
       WHERE attachment.id = ? AND capture.user_id = ?`
    )
    .get(id, auth.session.userId) as
    | { storage_path: string; mime_type: string; original_name: string }
    | undefined;

  if (!row) return NextResponse.json({ error: "附件不存在。" }, { status: 404 });
  const path = resolve(row.storage_path);
  if (!path.startsWith(resolve(uploadsDir))) {
    return NextResponse.json({ error: "附件路径无效。" }, { status: 403 });
  }

  const file = await readFile(path);
  return new NextResponse(file, {
    headers: {
      "Content-Type": row.mime_type,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.original_name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
