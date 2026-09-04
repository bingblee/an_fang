import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb, itemSelect, mapItem } from "@/lib/db";
import { snoozeDate } from "@/lib/date";
import { categoryIds } from "@/lib/category-definitions";
import { initialReviewPlan, nextReviewPlan } from "@/lib/review-policy";
import { requireApiSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("complete") }),
  z.object({ action: z.literal("abandon") }),
  z.object({ action: z.literal("waiting") }),
  z.object({ action: z.literal("later") }),
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("keep_later") }),
  z.object({ action: z.literal("snooze"), preset: z.string().min(1) }),
  z.object({ action: z.literal("set_topic"), topicId: z.string().uuid().nullable() }),
  z.object({ action: z.literal("rename"), title: z.string().trim().min(1).max(120) }),
  z.object({ action: z.literal("set_category"), category: z.enum(categoryIds) }),
  z.object({
    action: z.literal("edit"),
    title: z.string().trim().min(1).max(120),
    scheduledFor: z.string().nullable().optional(),
    status: z.enum(["scheduled", "waiting", "later"]).optional()
  })
]);

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiSession(request);
  if (!auth.ok) return auth.response;
  const { userId } = auth.session;
  const { id } = await context.params;
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "操作参数不正确。" }, { status: 400 });
  }

  const db = getDb();
  const existing = db.prepare("SELECT * FROM items WHERE id = ? AND user_id = ?").get(id, userId) as
    | Record<string, string | number | null>
    | undefined;
  if (!existing) {
    return NextResponse.json({ error: "没有找到这件事。" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const action = parsed.data;
  let actionMessage: string | undefined;
  if (existing.status === "merged" || existing.status === "abandoned") {
    return NextResponse.json({ error: "这件事已合并或不再处理，请刷新列表。" }, { status: 409 });
  }
  if (action.action === "rename") {
    // Renaming must not reschedule, confirm, or reopen the item.
    db.prepare("UPDATE items SET title = ?, updated_at = ? WHERE id = ?").run(action.title, now, id);
  } else if (action.action === "set_category") {
    db.prepare("UPDATE items SET category = ?, category_manual = 1, updated_at = ? WHERE id = ?")
      .run(action.category, now, id);
  } else if (action.action === "set_topic") {
    if (action.topicId && !db.prepare("SELECT id FROM topics WHERE id = ? AND user_id = ?").get(action.topicId, userId)) {
      return NextResponse.json({ error: "话题不存在，请刷新后重试。" }, { status: 404 });
    }
    db.prepare("UPDATE items SET topic_id = ?, topic_source = 'manual', updated_at = ? WHERE id = ?")
      .run(action.topicId, now, id);
  } else if (action.action === "complete") {
    db.prepare(
      `UPDATE items SET status = 'completed', review_at = NULL,
       review_interval_days = NULL, completed_at = ?, updated_at = ? WHERE id = ?`
    ).run(now, now, id);
    db.prepare("UPDATE triggers SET active = 0 WHERE item_id = ?").run(id);
  } else if (action.action === "abandon") {
    db.prepare(
      `UPDATE items SET status = 'abandoned', review_at = NULL,
       review_interval_days = NULL, updated_at = ? WHERE id = ?`
    ).run(now, id);
    db.prepare("UPDATE triggers SET active = 0 WHERE item_id = ?").run(id);
  } else if (action.action === "waiting") {
    db.prepare(
      `UPDATE items SET status = 'waiting', scheduled_for = NULL, review_at = NULL,
       review_interval_days = NULL, completed_at = NULL, updated_at = ? WHERE id = ?`
    ).run(now, id);
    db.prepare("UPDATE triggers SET active = 0 WHERE item_id = ?").run(id);
  } else if (action.action === "start") {
    db.prepare(`UPDATE items SET status = 'doing', scheduled_for = NULL, review_at = NULL,
      review_interval_days = NULL, completed_at = NULL, needs_confirmation = 0,
      confirmation_question = NULL, updated_at = ? WHERE id = ?`).run(now, id);
    db.prepare("UPDATE triggers SET active = 0 WHERE item_id = ?").run(id);
    actionMessage = "已移到今日的“正在做”。";
  } else if (action.action === "later") {
    // An explicit “put it back” must always move the item into the future,
    // including urgent items that originally resurfaced immediately.
    const plan = nextReviewPlan(
      typeof existing.review_interval_days === "number" ? existing.review_interval_days : null,
      new Date(now)
    );
    db.prepare(
      `UPDATE items SET status = 'later', scheduled_for = NULL, review_at = ?,
       review_interval_days = ?, completed_at = NULL, updated_at = ? WHERE id = ?`
    ).run(plan.reviewAt, plan.intervalDays, now, id);
    db.prepare("UPDATE triggers SET active = 0 WHERE item_id = ?").run(id);
    db.prepare(
      `INSERT INTO triggers (id, item_id, type, value, active, created_at)
       VALUES (?, ?, 'review', ?, 1, ?)`
    ).run(randomUUID(), id, plan.reviewAt, now);
    actionMessage = "已放回稍后，系统会在合适的时候再拿回来。";
  } else if (action.action === "keep_later") {
    const futureSchedule = existing.status === "scheduled" && existing.scheduled_for &&
      new Date(String(existing.scheduled_for)) > new Date(now);
    if (futureSchedule) {
      db.prepare("UPDATE items SET updated_at = ? WHERE id = ?").run(now, id);
      actionMessage = "会按原定时间回来。";
    } else {
      const plan = nextReviewPlan(typeof existing.review_interval_days === "number" ? existing.review_interval_days : null, new Date(now));
      db.prepare(`UPDATE items SET status = 'later', scheduled_for = NULL, review_at = ?,
        review_interval_days = ?, completed_at = NULL, updated_at = ? WHERE id = ?`).run(plan.reviewAt, plan.intervalDays, now, id);
      db.prepare("UPDATE triggers SET active = 0 WHERE item_id = ?").run(id);
      db.prepare(`INSERT INTO triggers (id, item_id, type, value, active, created_at)
        VALUES (?, ?, 'review', ?, 1, ?)`).run(randomUUID(), id, plan.reviewAt, now);
      actionMessage = `先继续放着，${plan.intervalDays} 天后再拿回来。`;
    }
  } else if (action.action === "snooze") {
    const scheduledFor = snoozeDate(action.preset);
    db.prepare(
      `UPDATE items
       SET status = 'scheduled', scheduled_for = ?, review_at = NULL, needs_confirmation = 0,
           review_interval_days = NULL, completed_at = NULL, confirmation_question = NULL, updated_at = ?
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
    const reviewPlan = status === "later"
      ? initialReviewPlan(String(existing.priority) as "urgent" | "high" | "normal" | "low", new Date(now))
      : null;
    db.prepare(
      `UPDATE items
       SET title = ?, scheduled_for = ?, status = ?, review_at = ?, review_interval_days = ?, time_window = NULL,
           context_label = CASE
             WHEN context_label IN ('上午', '下午', '晚上', '今晚', '明早') THEN NULL
             ELSE context_label
           END,
           completed_at = NULL, needs_confirmation = 0, confirmation_question = NULL, updated_at = ?
       WHERE id = ?`
    ).run(action.title, scheduledFor, status, reviewPlan?.reviewAt || null, reviewPlan?.intervalDays || null, now, id);
    db.prepare("UPDATE triggers SET active = 0 WHERE item_id = ?").run(id);
    if (scheduledFor) {
      db.prepare(
        `INSERT INTO triggers (id, item_id, type, value, active, created_at)
         VALUES (?, ?, 'time', ?, 1, ?)`
      ).run(randomUUID(), id, scheduledFor, now);
    } else {
      db.prepare(
        `INSERT INTO triggers (id, item_id, type, value, active, created_at)
         VALUES (?, ?, 'review', ?, 1, ?)`
      ).run(randomUUID(), id, reviewPlan!.reviewAt, now);
    }
  }

  db.prepare(
    `INSERT INTO feedback
      (id, user_id, item_id, kind, original_value, corrected_value, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    userId,
    id,
    action.action,
    action.action === "rename" ? String(existing.title) : action.action === "set_category" ? String(existing.category) :
      action.action === "edit" ? String(existing.scheduled_for || "") : action.action === "set_topic" ? String(existing.topic_id || "") : null,
    JSON.stringify(action),
    now
  );

  const row = db.prepare(`${itemSelect} WHERE i.id = ? AND i.user_id = ?`).get(id, userId) as Record<
    string,
    string | number | null
  >;
  return NextResponse.json({ item: mapItem(row), message: actionMessage });
}
