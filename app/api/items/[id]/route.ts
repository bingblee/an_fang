import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb, itemSelect, mapItem } from "@/lib/db";
import { snoozeDate } from "@/lib/date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("complete") }),
  z.object({ action: z.literal("abandon") }),
  z.object({ action: z.literal("waiting") }),
  z.object({ action: z.literal("later") }),
  z.object({ action: z.literal("snooze"), preset: z.string().min(1) }),
  z.object({
    action: z.literal("edit"),
    title: z.string().min(1).max(120),
    scheduledFor: z.string().nullable().optional(),
    status: z.enum(["scheduled", "waiting", "later"]).optional()
  })
]);

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const parsed = actionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "操作参数不正确。" }, { status: 400 });
  }

  const db = getDb();
  const existing = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as
    | Record<string, string | number | null>
    | undefined;
  if (!existing) {
    return NextResponse.json({ error: "没有找到这件事。" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const action = parsed.data;
  if (action.action === "complete") {
    db.prepare(
      "UPDATE items SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?"
    ).run(now, now, id);
    db.prepare("UPDATE triggers SET active = 0 WHERE item_id = ?").run(id);
  } else if (action.action === "abandon") {
    db.prepare(
      "UPDATE items SET status = 'abandoned', updated_at = ? WHERE id = ?"
    ).run(now, id);
    db.prepare("UPDATE triggers SET active = 0 WHERE item_id = ?").run(id);
  } else if (action.action === "waiting") {
    db.prepare(
      "UPDATE items SET status = 'waiting', scheduled_for = NULL, updated_at = ? WHERE id = ?"
    ).run(now, id);
    db.prepare("UPDATE triggers SET active = 0 WHERE item_id = ?").run(id);
  } else if (action.action === "later") {
    db.prepare(
      "UPDATE items SET status = 'later', scheduled_for = NULL, updated_at = ? WHERE id = ?"
    ).run(now, id);
    db.prepare("UPDATE triggers SET active = 0 WHERE item_id = ?").run(id);
    db.prepare(
      `INSERT INTO triggers (id, item_id, type, value, active, created_at)
       VALUES (?, ?, 'review', 'daily', 1, ?)`
    ).run(randomUUID(), id, now);
  } else if (action.action === "snooze") {
    const scheduledFor = snoozeDate(action.preset);
    db.prepare(
      `UPDATE items
       SET status = 'scheduled', scheduled_for = ?, needs_confirmation = 0,
           confirmation_question = NULL, updated_at = ?
       WHERE id = ?`
    ).run(scheduledFor, now, id);
    db.prepare("UPDATE triggers SET active = 0 WHERE item_id = ?").run(id);
    db.prepare(
      `INSERT INTO triggers (id, item_id, type, value, active, created_at)
       VALUES (?, ?, 'time', ?, 1, ?)`
    ).run(randomUUID(), id, scheduledFor, now);
  } else if (action.action === "edit") {
    let scheduledFor: string | null = action.scheduledFor || null;
    if (scheduledFor) {
      const candidate = new Date(scheduledFor);
      if (Number.isNaN(candidate.getTime())) {
        return NextResponse.json({ error: "提醒时间不正确。" }, { status: 400 });
      }
      scheduledFor = candidate.toISOString();
    }
    const status = scheduledFor
      ? "scheduled"
      : action.status === "waiting"
        ? "waiting"
        : "later";
    db.prepare(
      `UPDATE items
       SET title = ?, scheduled_for = ?, status = ?, time_window = NULL,
           context_label = CASE
             WHEN context_label IN ('上午', '下午', '晚上', '今晚', '明早') THEN NULL
             ELSE context_label
           END,
           needs_confirmation = 0, confirmation_question = NULL, updated_at = ?
       WHERE id = ?`
    ).run(action.title, scheduledFor, status, now, id);
    db.prepare("UPDATE triggers SET active = 0 WHERE item_id = ?").run(id);
    if (scheduledFor) {
      db.prepare(
        `INSERT INTO triggers (id, item_id, type, value, active, created_at)
         VALUES (?, ?, 'time', ?, 1, ?)`
      ).run(randomUUID(), id, scheduledFor, now);
    } else {
      db.prepare(
        `INSERT INTO triggers (id, item_id, type, value, active, created_at)
         VALUES (?, ?, 'review', 'daily', 1, ?)`
      ).run(randomUUID(), id, now);
    }
  }

  db.prepare(
    `INSERT INTO feedback
      (id, item_id, kind, original_value, corrected_value, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    id,
    action.action,
    action.action === "edit" ? String(existing.scheduled_for || "") : null,
    JSON.stringify(action),
    now
  );

  const row = db.prepare(`${itemSelect} WHERE i.id = ?`).get(id) as Record<
    string,
    string | number | null
  >;
  return NextResponse.json({ item: mapItem(row) });
}
