import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb, mapNotebookNote } from "@/lib/db";
import {
  notebookSummaryFromMarkdown,
  notebookTitleFromMarkdown
} from "@/lib/notebook-markdown.mjs";
import { requireApiSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createNoteSchema = z.object({
  title: z.string().trim().max(120, "标题不能超过 120 个字符。").optional().default(""),
  content: z.string().trim().min(1, "请写下一些内容再保存。").max(10_000, "正文不能超过 10000 个字符。")
});

export async function POST(request: NextRequest) {
  const auth = await requireApiSession(request);
  if (!auth.ok) return auth.response;
  const { userId } = auth.session;
  const parsed = createNoteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "笔记内容不正确。" }, { status: 400 });
  }

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const title = parsed.data.title || notebookTitleFromMarkdown(parsed.data.content);
  const summary = notebookSummaryFromMarkdown(parsed.data.content, Boolean(parsed.data.title));
  db.prepare(
    `INSERT INTO notebook_notes
      (id, user_id, source_item_id, source_enrichment_id, title, summary, content,
       source_item_title, provider, created_at, updated_at)
     VALUES (?, ?, NULL, NULL, ?, ?, ?, NULL, 'manual', ?, ?)`
  ).run(id, userId, title, summary, parsed.data.content, now, now);

  const row = db.prepare(
    `SELECT id, title, summary, content, source_item_title, provider, created_at
     FROM notebook_notes WHERE id = ? AND user_id = ?`
  ).get(id, userId) as Record<string, string | number | null>;
  return NextResponse.json({
    note: mapNotebookNote(row),
    message: "笔记已留下。"
  }, { status: 201 });
}
