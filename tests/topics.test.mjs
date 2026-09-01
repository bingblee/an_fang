import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { after, before, test } from "node:test";
import { runInNewContext } from "node:vm";
import { ensureDataDirectory, getRuntimeConfig } from "../lib/runtime-config.mjs";

// Exercise the production routes against a disposable database and a deterministic
// model endpoint. No real API key, user data, notifications, or external AI calls.
let dataDir, app, db, mock, baseUrl;
let reply = { title: "测试事项" };
let modelFails = false;
const prompts = [];
const legacyId = randomUUID();
let topicA, topicB, taskA;

const listen = async (server) => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function api(path, method = "GET", body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  });
  return { status: response.status, body: await response.json() };
}
async function capture(text, topicId = "auto", decision = {}, image = false) {
  reply = { title: text.slice(0, 100) || "截图中的事项", ...decision };
  const form = new FormData();
  form.set("text", text);
  form.set("topicId", topicId);
  if (image) form.set("attachment", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64")], { type: "image/png" }), "测试截图.png");
  const response = await fetch(`${baseUrl}/api/captures`, { method: "POST", body: form });
  return { status: response.status, body: await response.json() };
}
const itemRow = (id) => db.prepare("SELECT * FROM items WHERE id = ?").get(id);
const itemCount = () => Number(db.prepare("SELECT COUNT(*) n FROM items").get().n);
const latestPrompt = () => {
  const content = prompts.at(-1).messages[1].content;
  return typeof content === "string" ? content : content[0].text;
};

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "anfang-topics-test-"));
  ensureDataDirectory(getRuntimeConfig({ ANFANG_ENV: "test", TEST_DATA_DIR: dataDir }));
  const oldDb = new DatabaseSync(join(dataDir, "app.db"));
  // The pre-topic schema intentionally lacks topics, topic_id, topic_source, and merged_into_id.
  oldDb.exec(`
    CREATE TABLE captures (id TEXT PRIMARY KEY, kind TEXT NOT NULL, original_text TEXT, source_url TEXT,
      status TEXT NOT NULL, created_at TEXT NOT NULL, processed_at TEXT);
    CREATE TABLE items (id TEXT PRIMARY KEY, capture_id TEXT NOT NULL REFERENCES captures(id), title TEXT NOT NULL,
      notes TEXT, category TEXT NOT NULL, status TEXT NOT NULL, priority TEXT NOT NULL, duration_minutes INTEGER,
      energy TEXT NOT NULL, person TEXT, context_label TEXT, scheduled_for TEXT, time_window TEXT, source_excerpt TEXT,
      extraction_source TEXT NOT NULL, confidence REAL NOT NULL, needs_confirmation INTEGER NOT NULL DEFAULT 0,
      confirmation_question TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT);
  `);
  const now = new Date().toISOString();
  const captureId = randomUUID();
  oldDb.prepare("INSERT INTO captures VALUES (?, 'text', '原有事项，不要丢失', NULL, 'processed', ?, ?)").run(captureId, now, now);
  oldDb.prepare(`INSERT INTO items (id, capture_id, title, category, status, priority, energy, extraction_source, confidence, created_at, updated_at)
    VALUES (?, ?, '原有事项，不要丢失', 'life', 'later', 'normal', 'low', 'local', 0.7, ?, ?)`).run(legacyId, captureId, now, now);
  oldDb.close();

  mock = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    prompts.push(payload);
    if (modelFails) { response.writeHead(503).end("Simulated offline model"); return; }
    const enrichment = payload.messages[0].content.includes("JSON 字段：title、summary、content");
    const result = enrichment ? { title: "项目准备清单", summary: "确认需求后再执行。", content: "1. 确认需求\n2. 检查交付物", confidence: 0.9 } : reply;
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
  });
  const modelPort = await listen(mock);
  const reservation = createServer();
  const port = await listen(reservation);
  await new Promise((resolve) => reservation.close(resolve));
  baseUrl = `http://127.0.0.1:${port}`;
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: process.cwd(),
    env: { ...process.env, ANFANG_ENV: "test", DATA_DIR: "", TEST_DATA_DIR: dataDir, DEEPSEEK_API_KEY: "test-only", DEEPSEEK_BASE_URL: `http://127.0.0.1:${modelPort}`, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  app.stdout.on("data", (chunk) => { output += chunk; });
  app.stderr.on("data", (chunk) => { output += chunk; });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { ready = (await fetch(`${baseUrl}/api/dashboard`)).ok; } catch { /* starting */ }
    if (ready) break;
    if (app.exitCode !== null) throw new Error(`Test server exited: ${output}`);
    await delay(200);
  }
  assert.ok(ready, `Test server did not start. Run npm run build first. ${output}`);
  db = new DatabaseSync(join(dataDir, "app.db"));
});

after(async () => {
  db?.close();
  if (app && app.exitCode === null) { app.kill("SIGTERM"); await once(app, "exit"); }
  if (mock) await new Promise((resolve) => mock.close(resolve));
  if (dataDir && !process.env.KEEP_TEST_DATA) await rm(dataDir, { recursive: true, force: true });
  if (dataDir && process.env.KEEP_TEST_DATA) console.log(`Disposable test data: ${dataDir}`);
});

test("legacy database adds a review cycle without altering existing task content", async () => {
  const result = await api("/api/dashboard");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.topics, []);
  assert.equal(result.body.totalOpen, 1);
  assert.equal(result.body.environment, "test");
  assert.equal(result.body.remindersEnabled, false);
  const legacyItem = [...result.body.review, ...result.body.later].find((item) => item.id === legacyId);
  assert.equal(legacyItem.id, legacyId);
  assert.equal(legacyItem.topicId, null);
  assert.equal(legacyItem.status, "later");
  assert.ok(legacyItem.reviewAt);
  assert.equal(itemRow(legacyId).title, "原有事项，不要丢失");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("test UI is labeled, push is blocked, and the initial theme is restored before rendering", async () => {
  assert.equal((await api("/api/push/public-key")).status, 403);
  assert.equal((await api("/api/push/subscribe", "POST", {})).status, 403);
  assert.equal((await api("/manifest.webmanifest")).body.short_name, "安放测试");
  const html = await (await fetch(baseUrl)).text();
  assert.match(html, /自动化测试/);
  assert.ok(html.indexOf('id="anfang-theme-init"') < html.indexOf("<body"));
  const script = html.match(/<script id="anfang-theme-init">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  for (const saved of [null, "light", "dark", "invalid", "storage-disabled"]) {
    const root = { dataset: {} };
    const meta = { setAttribute(_name, value) { this.content = value; } };
    runInNewContext(script, { document: { documentElement: root, querySelector: () => meta },
      localStorage: { getItem() { if (saved === "storage-disabled") throw new Error("disabled"); return saved; } } });
    assert.equal(root.dataset.theme, saved === "dark" ? "dark" : "light");
    assert.equal(meta.content, saved === "dark" ? "#080d18" : "#f6f7f2");
  }
});

test("topic creation, normalized duplicates, validation, and edit conflicts", async () => {
  const a = await api("/api/topics", "POST", { name: "  星河项目  ", description: "新版官网的设计、研发和发布" });
  assert.equal(a.status, 201); topicA = a.body.topic;
  assert.equal(topicA.name, "星河项目");
  const dup = await api("/api/topics", "POST", { name: "星河项目" });
  assert.equal(dup.status, 200);
  assert.equal(dup.body.topic.id, topicA.id);
  assert.equal(dup.body.topic.description, topicA.description);
  const b = await api("/api/topics", "POST", { name: "远山项目", description: "门店落地与线下活动" });
  topicB = b.body.topic;
  for (const name of [" ", "长".repeat(81)]) assert.equal((await api("/api/topics", "POST", { name })).status, 400);
  assert.equal((await api(`/api/topics/${topicB.id}`, "PATCH", { name: "星河项目" })).status, 409);
  assert.equal((await api(`/api/topics/${randomUUID()}`)).status, 404);
  const malformed = await fetch(`${baseUrl}/api/topics`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
  assert.equal(malformed.status, 400);
});

test("natural commands create topics, not tasks; all three synonyms work", async () => {
  const count = itemCount();
  const calls = prompts.length;
  for (const [word, name] of [["话题", "搬家计划"], ["主题", "读书计划"], ["专题", "旅行计划"]]) {
    const result = await capture(`请创建一个关于${name}的${word}。`);
    assert.equal(result.status, 200);
    assert.equal(result.body.kind, "topic");
    assert.equal(result.body.createdTopic.name, name);
    assert.equal(result.body.item, undefined);
  }
  assert.equal(itemCount(), count);
  assert.equal(prompts.length, calls);
  const duplicate = await capture("创建一个关于搬家计划的话题");
  assert.match(duplicate.body.message, /已存在/);
  const original = db.prepare("SELECT original_text FROM captures WHERE original_text LIKE '%旅行计划%' ORDER BY created_at DESC").get();
  assert.equal(original.original_text, "请创建一个关于旅行计划的专题。");
});

test("creation followed by content routes the task and keeps the original input", async () => {
  const input = "请创建一个关于周末徒步的话题。周五检查雨衣";
  const result = await capture(input, "auto", { title: "检查雨衣" });
  assert.equal(result.status, 200);
  assert.equal(result.body.item.topicId, result.body.createdTopic.id);
  assert.equal(result.body.item.topicSource, "manual");
  assert.equal(result.body.item.sourceExcerpt, "周五检查雨衣");
  assert.equal(db.prepare("SELECT original_text FROM captures WHERE id = ?").get(result.body.item.captureId).original_text, input);
  assert.match(latestPrompt(), /用户记录：周五检查雨衣/);
});

test("manual topic overrides the model; separate tasks in one topic stay separate", async () => {
  const first = await capture("星河项目评审设计方案", topicA.id, { title: "评审设计方案", topicId: topicB.id, topicConfidence: 0.99, specificTime: "2030-09-01T09:00:00+08:00" });
  taskA = first.body.item;
  assert.equal(first.status, 200);
  assert.equal(taskA.topicId, topicA.id);
  assert.equal(taskA.topicSource, "manual");
  const second = await capture("星河项目准备上线说明", topicA.id, { title: "准备上线说明", topicId: topicA.id, topicConfidence: 0.99 });
  assert.notEqual(second.body.item.id, taskA.id);
  const detail = (await api(`/api/topics/${topicA.id}`)).body;
  assert.equal(detail.items.length, 2);
  assert.equal(detail.topic.openCount, 2);
  assert.equal(new Set(detail.items.map((item) => item.id)).size, 2);
  assert.ok(latestPrompt().includes(topicA.description));
});

test("confident AI classification works without requiring the project name", async () => {
  const result = await capture("确认新版官网首页交互稿", "auto", { title: "确认首页交互稿", topicId: topicA.id, topicConfidence: 0.94 });
  assert.equal(result.body.item.topicId, topicA.id);
  assert.equal(result.body.item.topicSource, "ai");
});

test("uncertain, unknown, and explicitly unassigned decisions stay unassigned", async () => {
  for (const decision of [{ topicId: topicA.id, topicConfidence: 0.6 }, { topicId: randomUUID(), topicConfidence: 0.99 }, {}]) {
    const result = await capture("换厨房滤芯", "auto", decision);
    assert.equal(result.body.item.topicId, null);
  }
  const none = await capture("星河项目打印合同", "none", { title: "打印合同", topicId: topicA.id, topicConfidence: 0.99 });
  assert.equal(none.body.item.topicId, null);
  assert.equal(none.body.item.topicSource, "manual");
  const supplement = await capture("打印合同补充：用双面打印", "auto", { title: "打印合同", operation: "merge", mergeTargetId: none.body.item.id, mergeConfidence: 0.98, topicId: topicA.id, topicConfidence: 0.95 });
  assert.equal(supplement.body.item.id, none.body.item.id);
  assert.equal(supplement.body.item.topicId, null);
  assert.equal(supplement.body.item.topicSource, "manual");
});

test("time supplements merge, keep topic, and update the reminder atomically", async () => {
  const result = await capture("星河项目评审设计方案时间改成明天 14:30", "auto", { title: "评审设计方案", operation: "merge", mergeTargetId: taskA.id, mergeConfidence: 0.98, topicId: topicA.id, topicConfidence: 0.96, specificTime: "2030-09-02T14:30:00+08:00" });
  assert.equal(result.body.merged, true);
  assert.equal(result.body.item.id, taskA.id);
  assert.equal(result.body.item.sourceCount, 2);
  assert.equal(result.body.item.topicSource, "manual");
  const triggers = db.prepare("SELECT * FROM triggers WHERE item_id = ? AND active = 1").all(taskA.id);
  assert.equal(triggers.length, 1);
  assert.equal(triggers[0].value, "2030-09-02T06:30:00.000Z");
});

test("cross-topic merge targets are filtered and rejected without altering the original", async () => {
  const before = { ...itemRow(taskA.id) };
  const result = await capture("远山项目评审设计方案时间改成周五", topicB.id, { title: "远山评审设计方案", operation: "merge", mergeTargetId: taskA.id, mergeConfidence: 1, topicId: topicB.id, topicConfidence: 1 });
  assert.equal(result.body.merged, false);
  assert.notEqual(result.body.item.id, taskA.id);
  assert.equal(result.body.item.topicId, topicB.id);
  assert.ok(!latestPrompt().includes(taskA.id));
  assert.deepEqual({ ...itemRow(taskA.id) }, before);
  const auto = await capture("远山项目的评审设计方案补充，改成周五", "auto", { title: "远山评审补充", operation: "merge", mergeTargetId: taskA.id, mergeConfidence: 1, topicId: topicB.id, topicConfidence: 1 });
  assert.notEqual(auto.body.item.id, taskA.id);
  assert.deepEqual({ ...itemRow(taskA.id) }, before);
});

test("screenshots retain their attachment and manually chosen topic", async () => {
  const result = await capture("", topicB.id, { title: "查看门店现场照片", topicId: topicA.id, topicConfidence: 0.99 }, true);
  assert.equal(result.status, 200);
  assert.equal(result.body.item.topicId, topicB.id);
  assert.equal(result.body.item.attachment.mimeType, "image/png");
  const image = await fetch(`${baseUrl}/api/attachments/${result.body.item.attachment.id}`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
});

test("topic moves keep reminders, source links, suggestions and independent notebook copies", async () => {
  const suggested = await api(`/api/items/${taskA.id}/suggestions`, "POST", { request: "提供准备步骤" });
  assert.equal(suggested.status, 200);
  const detail = (await api(`/api/topics/${topicA.id}`)).body;
  const enriched = detail.items.find((item) => item.id === taskA.id);
  assert.ok(enriched.enrichment);
  const note = await api(`/api/items/${taskA.id}/suggestions/${enriched.enrichment.id}`, "PATCH", { action: "save_to_notebook" });
  assert.equal(note.status, 200);
  const triggers = db.prepare("SELECT * FROM triggers WHERE item_id = ?").all(taskA.id);
  const before = { ...itemRow(taskA.id) };
  const moved = await api(`/api/items/${taskA.id}`, "PATCH", { action: "set_topic", topicId: topicB.id });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.item.topicId, topicB.id);
  assert.equal(moved.body.item.scheduledFor, before.scheduled_for);
  assert.equal(moved.body.item.status, before.status);
  assert.equal(moved.body.item.sourceCount, enriched.sourceCount);
  assert.deepEqual(moved.body.item.enrichment, enriched.enrichment);
  assert.deepEqual(db.prepare("SELECT * FROM triggers WHERE item_id = ?").all(taskA.id), triggers);
  assert.equal((await api("/api/dashboard")).body.notebook.length, 1);
  assert.equal((await api(`/api/items/${taskA.id}`, "PATCH", { action: "set_topic", topicId: randomUUID() })).status, 404);
  assert.equal(itemRow(taskA.id).topic_id, topicB.id);
  const removed = await api(`/api/items/${taskA.id}`, "PATCH", { action: "set_topic", topicId: null });
  assert.equal(removed.body.item.topicId, null);
  await api(`/api/items/${taskA.id}`, "PATCH", { action: "set_topic", topicId: topicB.id });
});

test("topic detail includes completed tasks; counts exclude abandoned tasks", async () => {
  const complete = await api(`/api/items/${taskA.id}`, "PATCH", { action: "complete" });
  assert.equal(complete.status, 200);
  const discard = await capture("远山项目旧物料替换", topicB.id);
  await api(`/api/items/${discard.body.item.id}`, "PATCH", { action: "abandon" });
  const detail = (await api(`/api/topics/${topicB.id}`)).body;
  assert.equal(detail.topic.completedCount, 1);
  assert.equal(detail.items.filter((item) => item.status === "completed").length, 1);
  assert.equal(detail.items.length, detail.topic.openCount + detail.topic.completedCount);
  assert.ok(!detail.items.some((item) => item.id === discard.body.item.id));
  assert.ok(!(await api("/api/dashboard")).body.today.some((item) => item.id === taskA.id));
});

test("local fallback assigns only unique names and does not collapse separate project tasks", async () => {
  modelFails = true;
  try {
    const one = await capture("星河项目校对新闻稿");
    const two = await capture("星河项目校对产品说明");
    assert.equal(one.body.usedAI, false);
    assert.equal(one.body.item.topicId, topicA.id);
    assert.equal(one.body.item.topicSource, "rule");
    assert.notEqual(one.body.item.id, two.body.item.id);
    const updateTask = await capture("更新星河项目产品说明页面");
    assert.equal(updateTask.body.merged, false);
    assert.notEqual(updateTask.body.item.id, two.body.item.id);
    const ambiguous = await capture("星河项目和远山项目共同的预算");
    assert.equal(ambiguous.body.item.topicId, null);
    const manually = await capture("星河项目的草图复核", topicB.id);
    assert.equal(manually.body.item.topicId, topicB.id);
  } finally { modelFails = false; }
});

test("renames propagate to task labels without changing associations", async () => {
  const renamed = await api(`/api/topics/${topicB.id}`, "PATCH", { name: "远山二期", description: "二期门店落地" });
  assert.equal(renamed.status, 200);
  const detail = (await api(`/api/topics/${topicB.id}`)).body;
  assert.ok(detail.items.length > 0);
  assert.ok(detail.items.every((item) => item.topicName === "远山二期" && item.topicId === topicB.id));
  assert.equal(detail.topic.description, "二期门店落地");
});

test("invalid topic choices fail before saving; all stored relations remain valid", async () => {
  const count = Number(db.prepare("SELECT COUNT(*) n FROM captures").get().n);
  assert.equal((await capture("不应存储", "invalid")).status, 400);
  assert.equal((await capture("不应存储", randomUUID())).status, 404);
  assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM captures").get().n), count);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM captures WHERE status != 'processed'").get().n, 0);
});

test("title-only edits preserve exact reminders, confirmation state, source and topic", async () => {
  const created = await capture("给星河项目购买烘焙奶酪", topicA.id, {
    title: "购买烘焙奶酪", category: "shopping", specificTime: "2030-09-03T18:15:37+08:00",
    timeWindow: "下班后", contextLabel: "外出购物", needsConfirmation: true, confirmationQuestion: "要买多少？"
  });
  assert.equal(created.status, 200);
  const id = created.body.item.id;
  const before = itemRow(id);
  const triggers = db.prepare("SELECT * FROM triggers WHERE item_id = ?").all(id);
  const source = db.prepare("SELECT * FROM captures WHERE id = ?").get(before.capture_id);
  const renamed = await api(`/api/items/${id}`, "PATCH", { action: "rename", title: "  购买马苏里拉奶酪  " });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.item.title, "购买马苏里拉奶酪");
  assert.equal(renamed.body.item.categoryManual, false);
  const after = itemRow(id);
  for (const key of Object.keys(before).filter((key) => !["title", "updated_at"].includes(key))) assert.deepEqual(after[key], before[key], key);
  assert.deepEqual(db.prepare("SELECT * FROM triggers WHERE item_id = ?").all(id), triggers);
  assert.deepEqual(db.prepare("SELECT * FROM captures WHERE id = ?").get(before.capture_id), source);
  assert.equal(db.prepare("SELECT original_value FROM feedback WHERE item_id = ? AND kind = 'rename'").get(id).original_value, before.title);
});

test("completed titles can be edited without reopening tasks or changing notebook copies", async () => {
  const before = itemRow(taskA.id);
  assert.equal(before.status, "completed");
  const notebook = (await api("/api/dashboard")).body.notebook;
  const triggers = db.prepare("SELECT * FROM triggers WHERE item_id = ?").all(taskA.id);
  const renamed = await api(`/api/items/${taskA.id}`, "PATCH", { action: "rename", title: "已评审的设计方案" });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.item.status, "completed");
  assert.equal(renamed.body.item.completedAt, before.completed_at);
  assert.equal(renamed.body.item.scheduledFor, before.scheduled_for);
  assert.deepEqual(db.prepare("SELECT * FROM triggers WHERE item_id = ?").all(taskA.id), triggers);
  assert.deepEqual((await api("/api/dashboard")).body.notebook, notebook);
  assert.equal((await api(`/api/topics/${topicB.id}`)).body.items.find((item) => item.id === taskA.id).title, "已评审的设计方案");
});

test("renaming a waiting item preserves waiting and rejects blank, missing and oversized titles", async () => {
  const created = await capture("等朋友确认野餐地点", "none", { category: "relationship" });
  const id = created.body.item.id;
  await api(`/api/items/${id}`, "PATCH", { action: "waiting" });
  const triggers = db.prepare("SELECT * FROM triggers WHERE item_id = ?").all(id);
  for (const title of ["", "   ", "字".repeat(121), null]) {
    assert.equal((await api(`/api/items/${id}`, "PATCH", { action: "rename", title })).status, 400);
  }
  assert.equal((await api(`/api/items/${id}`, "PATCH", { action: "rename" })).status, 400);
  assert.equal((await api(`/api/items/${randomUUID()}`, "PATCH", { action: "rename", title: "不存在" })).status, 404);
  const renamed = await api(`/api/items/${id}`, "PATCH", { action: "rename", title: "等待确认野餐公园" });
  assert.equal(renamed.body.item.status, "waiting");
  assert.equal(renamed.body.item.scheduledFor, null);
  assert.deepEqual(db.prepare("SELECT * FROM triggers WHERE item_id = ?").all(id), triggers);
});

test("category collections span topics, include completed items once, and omit merged or abandoned items", async () => {
  const first = (await capture("购买展厅灯泡", topicA.id, { category: "shopping" })).body.item;
  const second = (await capture("购买门店门垫", topicB.id, { category: "shopping" })).body.item;
  const unassigned = (await capture("购买洗衣液", "none", { category: "shopping" })).body.item;
  const discarded = (await capture("购买旧型号电池", "none", { category: "shopping" })).body.item;
  const merged = (await capture("重复的电池记录", "none", { category: "shopping" })).body.item;
  await api(`/api/items/${second.id}`, "PATCH", { action: "complete" });
  await api(`/api/items/${discarded.id}`, "PATCH", { action: "abandon" });
  db.prepare("UPDATE items SET status = 'merged', merged_into_id = ? WHERE id = ?").run(first.id, merged.id);
  const response = await api("/api/categories/shopping");
  assert.equal(response.status, 200);
  const { category, items } = response.body;
  assert.equal(category.name, "购物");
  for (const item of [first, second, unassigned]) assert.ok(items.some((row) => row.id === item.id));
  for (const item of [discarded, merged]) {
    assert.ok(!items.some((row) => row.id === item.id));
    assert.equal((await api(`/api/items/${item.id}`, "PATCH", { action: "rename", title: "不应该修改" })).status, 409);
  }
  assert.equal(items.length, new Set(items.map((item) => item.id)).size);
  assert.equal(category.openCount, items.filter((item) => item.status !== "completed").length);
  assert.equal(category.completedCount, items.filter((item) => item.status === "completed").length);
  assert.equal((await api("/api/categories/not-a-category")).status, 404);
  assert.deepEqual((await api("/api/categories/personal")).body.items, []);
  const dashboard = (await api("/api/dashboard")).body;
  assert.equal(dashboard.categories.length, 6);
  assert.deepEqual(dashboard.categories.find((entry) => entry.id === "shopping"), category);
});

test("manual category moves keep sources, suggestions, notebook, topic and reminders intact", async () => {
  const before = itemRow(taskA.id);
  const triggers = db.prepare("SELECT * FROM triggers WHERE item_id = ?").all(taskA.id);
  const notebook = (await api("/api/dashboard")).body.notebook;
  const sources = db.prepare("SELECT * FROM item_sources WHERE item_id = ?").all(taskA.id);
  const enrichment = db.prepare("SELECT * FROM item_enrichments WHERE item_id = ?").all(taskA.id);
  assert.equal((await api(`/api/items/${taskA.id}`, "PATCH", { action: "set_category", category: "invalid" })).status, 400);
  const result = await api(`/api/items/${taskA.id}`, "PATCH", { action: "set_category", category: "work" });
  assert.equal(result.status, 200);
  assert.equal(result.body.item.category, "work");
  assert.equal(result.body.item.categoryManual, true);
  const after = itemRow(taskA.id);
  for (const key of Object.keys(before).filter((key) => !["category", "category_manual", "updated_at"].includes(key))) assert.deepEqual(after[key], before[key], key);
  assert.deepEqual(db.prepare("SELECT * FROM triggers WHERE item_id = ?").all(taskA.id), triggers);
  assert.deepEqual(db.prepare("SELECT * FROM item_sources WHERE item_id = ?").all(taskA.id), sources);
  assert.deepEqual(db.prepare("SELECT * FROM item_enrichments WHERE item_id = ?").all(taskA.id), enrichment);
  assert.deepEqual((await api("/api/dashboard")).body.notebook, notebook);
  assert.ok((await api("/api/categories/work")).body.items.some((item) => item.id === taskA.id));
  assert.ok(!(await api(`/api/categories/${before.category}`)).body.items.some((item) => item.id === taskA.id));
});

test("later AI supplements respect a manually corrected category", async () => {
  const created = (await capture("星河项目采购展台绿植", topicA.id, { category: "shopping" })).body.item;
  await api(`/api/items/${created.id}`, "PATCH", { action: "set_category", category: "work" });
  const supplement = await capture("星河项目采购展台绿植补充：需要两盆", topicA.id, {
    title: "星河项目采购展台绿植", category: "shopping", operation: "merge", mergeTargetId: created.id, mergeConfidence: 0.99
  });
  assert.equal(supplement.body.merged, true);
  assert.equal(supplement.body.item.id, created.id);
  assert.equal(supplement.body.item.category, "work");
  assert.equal(supplement.body.item.categoryManual, true);
  assert.equal(supplement.body.item.sourceCount, 2);
  assert.equal(supplement.body.item.topicId, topicA.id);
  assert.ok(!(await api("/api/categories/shopping")).body.items.some((item) => item.id === created.id));
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("unscheduled work gets a review time and can move into today's active work", async () => {
  const created = await capture("整理九月旅行证件清单", "none", {
    title: "整理九月旅行证件清单",
    category: "personal",
    priority: "urgent",
    scheduleHint: "none"
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.item.status, "later");
  assert.equal(created.body.item.reviewIntervalDays, 1);
  assert.ok(created.body.item.reviewAt);

  const due = (await api("/api/dashboard")).body;
  assert.ok(due.review.some((item) => item.id === created.body.item.id));
  assert.ok(!due.later.some((item) => item.id === created.body.item.id));

  const started = await api(`/api/items/${created.body.item.id}`, "PATCH", { action: "start" });
  assert.equal(started.status, 200);
  assert.equal(started.body.item.status, "doing");
  assert.equal(started.body.item.reviewAt, null);
  assert.equal(started.body.item.scheduledFor, null);
  assert.match(started.body.message, /正在做/);
  const active = (await api("/api/dashboard")).body;
  assert.ok(active.doing.some((item) => item.id === created.body.item.id));
  assert.ok(!active.review.some((item) => item.id === created.body.item.id));
  assert.ok(!active.later.some((item) => item.id === created.body.item.id));
});

test("continue leaving an item increases the review interval without bouncing back immediately", async () => {
  const created = (await capture("整理露营装备保养清单", "none", {
    title: "整理露营装备保养清单",
    category: "life",
    priority: "normal",
    scheduleHint: "none"
  })).body.item;
  db.prepare("UPDATE items SET review_at = ?, review_interval_days = 1 WHERE id = ?")
    .run("2000-01-01T00:00:00.000Z", created.id);

  const first = await api(`/api/items/${created.id}`, "PATCH", { action: "keep_later" });
  assert.equal(first.status, 200);
  assert.equal(first.body.item.status, "later");
  assert.equal(first.body.item.reviewIntervalDays, 3);
  assert.ok(new Date(first.body.item.reviewAt).getTime() - Date.now() > 2.9 * 86_400_000);
  assert.match(first.body.message, /3 天后/);
  let triggers = db.prepare("SELECT * FROM triggers WHERE item_id = ? AND active = 1").all(created.id);
  assert.equal(triggers.length, 1);
  assert.equal(triggers[0].type, "review");
  assert.equal(triggers[0].value, first.body.item.reviewAt);
  assert.ok(!(await api("/api/dashboard")).body.review.some((item) => item.id === created.id));

  const second = await api(`/api/items/${created.id}`, "PATCH", { action: "keep_later" });
  assert.equal(second.body.item.reviewIntervalDays, 7);
  assert.ok(new Date(second.body.item.reviewAt).getTime() - Date.now() > 6.9 * 86_400_000);
  triggers = db.prepare("SELECT * FROM triggers WHERE item_id = ? AND active = 1").all(created.id);
  assert.equal(triggers.length, 1);
  assert.equal(triggers[0].value, second.body.item.reviewAt);
});

test("arranging an exact time replaces review, and clearing it restores a review plan", async () => {
  const created = (await capture("安排年度牙齿复诊", "none", {
    title: "安排年度牙齿复诊",
    category: "personal",
    priority: "normal",
    scheduleHint: "none"
  })).body.item;
  const scheduledFor = "2032-03-12T02:26:00.000Z";
  const arranged = await api(`/api/items/${created.id}`, "PATCH", {
    action: "edit",
    title: created.title,
    scheduledFor,
    status: "scheduled"
  });
  assert.equal(arranged.status, 200);
  assert.equal(arranged.body.item.status, "scheduled");
  assert.equal(arranged.body.item.scheduledFor, scheduledFor);
  assert.equal(arranged.body.item.reviewAt, null);
  let active = db.prepare("SELECT * FROM triggers WHERE item_id = ? AND active = 1").all(created.id);
  assert.equal(active.length, 1);
  assert.equal(active[0].type, "time");
  assert.equal(active[0].value, scheduledFor);

  const cleared = await api(`/api/items/${created.id}`, "PATCH", {
    action: "edit",
    title: created.title,
    scheduledFor: null,
    status: "later"
  });
  assert.equal(cleared.body.item.status, "later");
  assert.equal(cleared.body.item.scheduledFor, null);
  assert.equal(cleared.body.item.reviewIntervalDays, 3);
  assert.ok(new Date(cleared.body.item.reviewAt) > new Date());
  active = db.prepare("SELECT * FROM triggers WHERE item_id = ? AND active = 1").all(created.id);
  assert.equal(active.length, 1);
  assert.equal(active[0].type, "review");
  assert.equal(active[0].value, cleared.body.item.reviewAt);
});

test("continue leaving an explicitly scheduled item preserves its exact time", async () => {
  const created = (await capture("2031 年检查长期证件有效期", "none", {
    title: "检查长期证件有效期",
    category: "personal",
    specificTime: "2031-09-18T14:37:00+08:00"
  })).body.item;
  const before = itemRow(created.id);
  const triggers = db.prepare("SELECT * FROM triggers WHERE item_id = ? AND active = 1").all(created.id);
  const kept = await api(`/api/items/${created.id}`, "PATCH", { action: "keep_later" });
  assert.equal(kept.status, 200);
  assert.equal(kept.body.item.status, "scheduled");
  assert.equal(kept.body.item.scheduledFor, before.scheduled_for);
  assert.equal(kept.body.item.reviewAt, null);
  assert.match(kept.body.message, /原定时间/);
  assert.deepEqual(db.prepare("SELECT * FROM triggers WHERE item_id = ? AND active = 1").all(created.id), triggers);
  assert.ok((await api("/api/dashboard")).body.later.some((item) => item.id === created.id));
});

test("today resurfaces at most three due items and every decision removes one from review", async () => {
  const ids = [];
  for (let index = 0; index < 4; index += 1) {
    const item = (await capture(`复盘测试事项 ${index + 1}`, "none", {
      title: `复盘测试事项 ${index + 1}`,
      category: "other",
      priority: "urgent",
      scheduleHint: "none"
    })).body.item;
    db.prepare("UPDATE items SET review_at = ? WHERE id = ?")
      .run(`2000-01-0${index + 1}T00:00:00.000Z`, item.id);
    ids.push(item.id);
  }

  const before = (await api("/api/dashboard")).body;
  assert.equal(before.review.length, 3);
  assert.deepEqual(before.review.map((item) => item.id), ids.slice(0, 3));
  assert.ok(before.later.some((item) => item.id === ids[3]));

  const waiting = await api(`/api/items/${ids[0]}`, "PATCH", { action: "waiting" });
  assert.equal(waiting.body.item.status, "waiting");
  assert.equal(waiting.body.item.reviewAt, null);
  const abandoned = await api(`/api/items/${ids[1]}`, "PATCH", { action: "abandon" });
  assert.equal(abandoned.body.item.status, "abandoned");
  const postponed = await api(`/api/items/${ids[2]}`, "PATCH", { action: "later" });
  assert.equal(postponed.body.item.status, "later");
  assert.ok(new Date(postponed.body.item.reviewAt) > new Date());

  const after = (await api("/api/dashboard")).body;
  assert.ok(after.waiting.some((item) => item.id === ids[0]));
  assert.ok(!after.review.some((item) => ids.slice(0, 3).includes(item.id)));
  assert.ok(after.review.some((item) => item.id === ids[3]));
});
