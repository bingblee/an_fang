import { NextResponse } from "next/server";
import { getDb, itemSelect, mapItem, mapNotebookNote } from "@/lib/db";
import type { DashboardData } from "@/lib/types";
import { listTopics } from "@/lib/topics";
import { getRuntimeConfig } from "@/lib/runtime-config.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  const rows = db
    .prepare(
      `${itemSelect}
       WHERE i.status NOT IN ('completed', 'abandoned', 'merged')
       ORDER BY
         CASE i.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
         COALESCE(i.scheduled_for, '9999-12-31T23:59:59.999Z'),
         i.created_at DESC`
    )
    .all() as Array<Record<string, string | number | null>>;
  const items = rows.map(mapItem);
  const notebook = (
    db
      .prepare(
        `SELECT id, title, summary, content, source_item_title, provider, created_at
         FROM notebook_notes ORDER BY created_at DESC`
      )
      .all() as Array<Record<string, string | number | null>>
  ).map(mapNotebookNote);

  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const inbox = items.filter((item) => item.needsConfirmation);
  const waiting = items.filter((item) => item.status === "waiting" && !item.needsConfirmation);
  const due = items.filter(
    (item) =>
      item.status === "scheduled" &&
      !item.needsConfirmation &&
      ((item.scheduledFor && new Date(item.scheduledFor) <= endOfToday) ||
        item.priority === "urgent")
  );
  const quick = due.filter(
    (item) => (item.durationMinutes !== null && item.durationMinutes <= 15) || item.energy === "low"
  );
  const today = due.filter((item) => !quick.some((quickItem) => quickItem.id === item.id));
  const usedIds = new Set([...inbox, ...waiting, ...quick, ...today].map((item) => item.id));
  const later = items.filter((item) => !usedIds.has(item.id));

  const completedRow = db
    .prepare(
      `SELECT COUNT(*) AS count FROM items
       WHERE status = 'completed' AND completed_at >= ?`
    )
    .get(startOfToday.toISOString()) as { count: number };

  const data: DashboardData = {
    topics: listTopics(db),
    today,
    quick,
    later,
    waiting,
    inbox,
    notebook,
    completedToday: Number(completedRow.count),
    totalOpen: items.length,
    aiEnabled: Boolean(process.env.DEEPSEEK_API_KEY)
  };

  const { environment, remindersEnabled } = getRuntimeConfig();
  return NextResponse.json({ ...data, environment, remindersEnabled }, {
    headers: { "Cache-Control": "no-store" }
  });
}
