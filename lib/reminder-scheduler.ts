import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { configureWebPush } from "@/lib/push";
import { getRuntimeConfig } from "@/lib/runtime-config.mjs";

declare global {
  var __anfangReminderTimer: NodeJS.Timeout | undefined;
  var __anfangReminderRunning: boolean | undefined;
}

type DueItem = {
  id: string;
  user_id: string;
  title: string;
  scheduled_for: string;
  source_excerpt: string | null;
};

type PushRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export async function checkDueReminders() {
  if (!getRuntimeConfig().remindersEnabled) return;
  if (globalThis.__anfangReminderRunning) return;
  globalThis.__anfangReminderRunning = true;
  try {
    const db = getDb();
    const dueItems = db
      .prepare(
        `SELECT i.id, i.user_id, i.title, i.scheduled_for, i.source_excerpt
         FROM items i
         WHERE i.user_id IS NOT NULL
           AND i.status = 'scheduled'
           AND i.scheduled_for IS NOT NULL
           AND i.scheduled_for <= ?
           AND NOT EXISTS (
             SELECT 1 FROM reminders r
             WHERE r.item_id = i.id
               AND r.scheduled_for = i.scheduled_for
               AND r.delivered_at IS NOT NULL
           )
         ORDER BY i.scheduled_for ASC
         LIMIT 20`
      )
      .all(new Date().toISOString()) as unknown as DueItem[];
    if (!dueItems.length) return;

    const subscriptions = db
      .prepare(
        `SELECT subscription.id, subscription.user_id, subscription.endpoint,
                subscription.p256dh, subscription.auth
         FROM push_subscriptions subscription
         JOIN auth_sessions session ON session.token_hash = subscription.session_token_hash
           AND session.user_id = subscription.user_id
         WHERE subscription.user_id IS NOT NULL AND session.expires_at > ?`
      )
      .all(new Date().toISOString()) as unknown as PushRow[];
    if (!subscriptions.length) return;

    const sender = configureWebPush();
    for (const item of dueItems) {
      let delivered = false;
      for (const subscription of subscriptions.filter((entry) => entry.user_id === item.user_id)) {
        try {
          await sender.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth }
            },
            JSON.stringify({
              title: "现在适合处理",
              body: item.title,
              itemId: item.id,
              url: "/"
            }),
            { TTL: 60 * 60 * 6, urgency: "normal" }
          );
          delivered = true;
        } catch (error) {
          const statusCode =
            typeof error === "object" && error && "statusCode" in error
              ? Number(error.statusCode)
              : 0;
          if (statusCode === 404 || statusCode === 410) {
            db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(subscription.id);
          }
        }
      }

      if (delivered) {
        const now = new Date().toISOString();
        db.prepare(
          `INSERT INTO reminders
            (id, item_id, reason, scheduled_for, delivered_at, created_at)
           VALUES (?, ?, '到达设定时间', ?, ?, ?)`
        ).run(randomUUID(), item.id, item.scheduled_for, now, now);
      }
    }
  } finally {
    globalThis.__anfangReminderRunning = false;
  }
}

export function startReminderScheduler() {
  if (!getRuntimeConfig().remindersEnabled) return;
  if (globalThis.__anfangReminderTimer) return;
  const run = () => {
    void checkDueReminders().catch((error) => {
      console.error("Reminder scheduler failed", error);
    });
  };
  setTimeout(run, 4_000);
  globalThis.__anfangReminderTimer = setInterval(run, 30_000);
}
