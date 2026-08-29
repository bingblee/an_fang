import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { getDb, uploadsDir } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const row = getDb()
    .prepare(
      "SELECT storage_path, mime_type, original_name FROM attachments WHERE id = ?"
    )
    .get(id) as
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
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

