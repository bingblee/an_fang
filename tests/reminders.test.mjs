import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import * as policy from "../lib/push-policy.ts";
import { loadModule } from "./helpers/load-module.mjs";

const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
const keys = { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") };

function fixture(t, send = async () => {}) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(`CREATE TABLE items (id TEXT, user_id TEXT, title TEXT, status TEXT, scheduled_for TEXT, source_excerpt TEXT);
    CREATE TABLE reminders (id TEXT, item_id TEXT, reason TEXT, scheduled_for TEXT, delivered_at TEXT, outcome TEXT, created_at TEXT);
    CREATE TABLE push_subscriptions (id TEXT, user_id TEXT, endpoint TEXT, p256dh TEXT, auth TEXT, session_token_hash TEXT);
    CREATE TABLE auth_sessions (token_hash TEXT, user_id TEXT, expires_at TEXT);`);
  const sent = [];
  const scheduler = loadModule("lib/reminder-scheduler.ts", {
    "@/lib/db": { getDb: () => db },
    "@/lib/push-policy": policy,
    "@/lib/runtime-config.mjs": { getRuntimeConfig: () => ({ remindersEnabled: true }) },
    "@/lib/push": { configureWebPush: () => ({ sendNotification: async (subscription, payload, options) => {
      const item = JSON.parse(payload);
      sent.push({ subscription, item, options });
      await send(subscription, item);
    } }) }
  });
  return {
    db, sent, tick: scheduler.checkDueReminders,
    item(id, user = "owner", date = "2000-01-01T00:00:00.000Z") {
      db.prepare("INSERT INTO items VALUES (?, ?, ?, 'scheduled', ?, NULL)").run(id, user, id, date);
    },
    subscription(user = "owner", endpoint = `https://fcm.googleapis.com/fcm/send/${user}`, expires = "2099-01-01T00:00:00.000Z") {
      db.prepare("INSERT INTO auth_sessions VALUES (?, ?, ?)").run(user, user, expires);
      db.prepare("INSERT INTO push_subscriptions VALUES (?, ?, ?, ?, ?, ?)")
        .run(user, user, endpoint, keys.p256dh, keys.auth, user);
    }
  };
}

test("unsubscribed and expired users cannot starve another user's reminders", async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 20; i++) f.item(`old-${i}`, "no-device");
  f.item("expired", "expired");
  f.subscription("expired", undefined, "2000-01-01T00:00:00.000Z");
  f.item("deliver", "owner", "2000-01-02T00:00:00.000Z");
  f.subscription();
  await f.tick();
  assert.deepEqual(f.sent.map(({ item }) => item.itemId), ["deliver"]);
  assert.equal(f.sent[0].subscription.endpoint, "https://fcm.googleapis.com/fcm/send/owner");
  assert.equal(f.sent[0].options.timeout, 10_000);
  await f.tick();
  assert.equal(f.sent.length, 1, "Delivered reminders are not duplicated");
});

test("failed deliveries yield to new work and can retry after cooldown", async (t) => {
  let fail = true;
  const f = fixture(t, async (_subscription, item) => {
    if (fail && item.itemId.startsWith("fail")) throw Object.assign(new Error("Temporary failure"), { statusCode: 503 });
  });
  f.subscription();
  for (let i = 0; i < 20; i++) f.item(`fail-${i}`);
  f.item("healthy", "owner", "2000-01-02T00:00:00.000Z");
  await f.tick();
  assert.equal(f.sent.length, 20);
  await f.tick();
  assert.equal(f.sent.at(-1).item.itemId, "healthy");
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM reminders WHERE outcome = 'retry'").get().n, 20);
  fail = false;
  f.db.exec("UPDATE reminders SET created_at = '2000-01-01T00:00:00.000Z' WHERE outcome = 'retry'");
  await f.tick();
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM reminders WHERE delivered_at IS NOT NULL").get().n, 21);
});

test("unsafe legacy endpoints and expired push subscriptions are never retried indefinitely", async (t) => {
  const f = fixture(t, async () => { throw Object.assign(new Error("Gone"), { statusCode: 410 }); });
  f.item("unsafe", "unsafe");
  f.subscription("unsafe", "https://127.0.0.1/internal");
  f.item("gone");
  f.subscription();
  await f.tick();
  assert.deepEqual(f.sent.map(({ item }) => item.itemId), ["gone"]);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM push_subscriptions").get().n, 0);
  await f.tick();
  assert.equal(f.sent.length, 1);
});

test("overlapping scheduler ticks do not send the same reminder twice", async (t) => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const f = fixture(t, () => pending);
  f.item("one");
  f.subscription();
  const first = f.tick();
  await f.tick();
  assert.equal(f.sent.length, 1);
  finish();
  await first;
});

test("stored endpoints are normalized before the push library parses them", async (t) => {
  const f = fixture(t);
  f.item("encoded");
  f.subscription("owner", "https://fcm%2egoogleapis.com/test");
  await f.tick();
  assert.equal(f.sent[0].subscription.endpoint, "https://fcm.googleapis.com/test");
});

test("push routes reject unsafe endpoints and malformed keys before writing a subscription", async (t) => {
  const f = fixture(t);
  f.db.exec("ALTER TABLE push_subscriptions ADD COLUMN user_agent TEXT; ALTER TABLE push_subscriptions ADD COLUMN created_at TEXT; ALTER TABLE push_subscriptions ADD COLUMN updated_at TEXT; CREATE UNIQUE INDEX endpoint_unique ON push_subscriptions(endpoint)");
  const route = loadModule("app/api/push/subscribe/route.ts", {
    "@/lib/db": { getDb: () => f.db },
    "@/lib/push-policy": policy,
    "@/lib/runtime-config.mjs": { getRuntimeConfig: () => ({ remindersEnabled: true }) },
    "@/lib/auth": { requireApiSession: async () => ({ ok: true, session: { userId: "owner" } }), getCurrentSessionTokenHash: async () => "current-session" }
  });
  const submit = (body) => route.POST(new Request("http://localhost/api/push/subscribe", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  }));
  for (const endpoint of [
    "https://127.0.0.1/internal", "https://[::1]/internal", "https://10.1.2.3/internal",
    "http://fcm.googleapis.com/fcm/send/test", "https://fcm.googleapis.com:9443/test",
    "https://fcm.googleapis.com.evil.example/test", "https://evil.example/fcm.googleapis.com",
    "https://fcm.googleapis.com@evil.example/test", "https://user@fcm.googleapis.com/test",
    "https://fcm.googleapis.com/test#fragment", "file:///etc/passwd"
  ]) assert.equal((await submit({ endpoint, keys })).status, 400, endpoint);
  assert.equal((await submit({ endpoint: "https://fcm.googleapis.com/test", keys: { p256dh: "bad", auth: "bad" } })).status, 400);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM push_subscriptions").get().n, 0);
  for (const host of ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com", "wns2-db5p.notify.windows.com"]) {
    assert.equal((await submit({ endpoint: `https://${host}/test`, keys })).status, 200, host);
  }
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM push_subscriptions WHERE session_token_hash = 'current-session'").get().n, 4);
  assert.equal((await submit({ endpoint: "https://fcm%2egoogleapis.com/test", keys })).status, 200);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM push_subscriptions").get().n, 4, "Equivalent URLs use the same canonical endpoint");
  const malformed = await route.POST(new Request("http://localhost/api/push/subscribe", { method: "POST", body: "{" }));
  assert.equal(malformed.status, 400);
});
