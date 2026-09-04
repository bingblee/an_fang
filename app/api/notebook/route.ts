import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb, mapNotebookNote } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createNoteSchema = z.object({
  title: z.string().trim().max(120, "标题不能超过 120 个字符。").optional().default(""),
  content: z.string().trim().min(1, "请写下一些内容再保存。").max(10_000, "正文不能超过 10000 个字符。")
});

function truncate(value: string, length: number) {
  const characters = Array.from(value);
  return characters.length <= length ? value : `${characters.slice(0, length - 1).join("")}…`;
}

function noteTitle(content: string) {
  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || content;
  const cleaned = firstLine.replace(/^#{1,6}\s*/, "").replace(/^[-*]\s+/, "").trim();
  return truncate(cleaned || "未命名笔记", 120);
}

function noteSummary(content: string, titleWasProvided: boolean) {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const source = !titleWasProvided && lines.length > 1 ? lines.slice(1).join(" ") : lines.join(" ");
  return truncate(source || content.replace(/\s+/gu, " ").trim(), 180);
}

export async function POST(request: NextRequest) {
  const parsed = createNoteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "笔记内容不正确。" }, { status: 400 });
  }

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const title = parsed.data.title || noteTitle(parsed.data.content);
  const summary = noteSummary(parsed.data.content, Boolean(parsed.data.title));
  db.prepare(
    `INSERT INTO notebook_notes
      (id, source_item_id, source_enrichment_id, title, summary, content,
       source_item_title, provider, created_at, updated_at)
     VALUES (?, NULL, NULL, ?, ?, ?, NULL, 'manual', ?, ?)`
  ).run(id, title, summary, parsed.data.content, now, now);

  const row = db.prepare(
    `SELECT id, title, summary, content, source_item_title, provider, created_at
     FROM notebook_notes WHERE id = ?`
  ).get(id) as Record<string, string | number | null>;
  return NextResponse.json({
    note: mapNotebookNote(row),
    message: "笔记已留下。"
  }, { status: 201 });
}
