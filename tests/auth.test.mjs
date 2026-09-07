import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("multi-user authentication protects registration, data isolation, sessions, and password changes", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "anfang-auth-test-"));
  const setupToken = "auth-test-setup-token-32-characters";
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const baseUrl = `http://127.0.0.1:${port}`;
  const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ANFANG_ENV: "test",
      DATA_DIR: "",
      TEST_DATA_DIR: dataDir,
      AUTH_SETUP_TOKEN: setupToken,
      DEEPSEEK_API_KEY: "",
      NEXT_TELEMETRY_DISABLED: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  app.stdout.on("data", (chunk) => { output += chunk; });
  app.stderr.on("data", (chunk) => { output += chunk; });

  const json = async (path, options = {}) => {
    const response = await fetch(`${baseUrl}${path}`, options);
    return { response, body: await response.json() };
  };
  const post = (path, body, cookie, extraHeaders = {}) => json(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      ...(cookie ? { Cookie: cookie } : {}),
      ...extraHeaders
    },
    body: JSON.stringify(body)
  });

  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { ready = (await fetch(`${baseUrl}/api/auth/state`)).ok; } catch { /* starting */ }
      if (ready) break;
      if (app.exitCode !== null) throw new Error(`Test server exited: ${output}`);
      await delay(200);
    }
    assert.ok(ready, `Test server did not start. Run npm run build first. ${output}`);

    const privateApi = await json("/api/dashboard");
    assert.equal(privateApi.response.status, 401);
    assert.match(privateApi.body.error, /登录/);
    const privatePage = await fetch(baseUrl, { redirect: "manual" });
    assert.ok([307, 308].includes(privatePage.status));
    assert.equal(new URL(privatePage.headers.get("location"), baseUrl).pathname, "/login");
    assert.equal((await fetch(`${baseUrl}/register`, { redirect: "manual" })).status, 200);
    for (const path of ["/setup", "/recover"]) {
      const legacyPage = await fetch(`${baseUrl}${path}`, { redirect: "manual" });
      assert.ok([307, 308].includes(legacyPage.status));
      assert.equal(new URL(legacyPage.headers.get("location"), baseUrl).pathname, "/login");
    }
    const loginHtml = await (await fetch(`${baseUrl}/login`)).text();
    assert.doesNotMatch(loginHtml, /首次设置口令|AUTH_SETUP_TOKEN|忘记密码/);
    const missingAttachment = await json("/api/attachments/missing");
    assert.equal(missingAttachment.response.status, 401);
    const loginArtwork = await fetch(`${baseUrl}/auth-sanctuary.jpg`);
    assert.equal(loginArtwork.status, 200);
    assert.equal(loginArtwork.headers.get("content-type"), "image/jpeg");

    const state = await json("/api/auth/state");
    assert.deepEqual(state.body, {
      authenticated: false,
      username: null
    });
    assert.equal((await post("/api/auth/setup", { setupToken, username: "主人", password: "strong-pass-123", remember: true })).response.status, 410);
    assert.equal((await post("/api/auth/recover", { setupToken, username: "bingbing", password: "strong-pass-123" })).response.status, 410);
    assert.equal((await post("/api/auth/register", { username: " ＢＩＮＧＢＩＮＧ ", password: "strong-pass-123" })).response.status, 409);
    const initial = JSON.parse(await readFile(join(dataDir, "initial-account.json"), "utf8"));
    assert.equal(initial.username, "bingbing");
    assert.ok(!output.includes(initial.password));
    const setup = await post("/api/auth/login", {
      username: initial.username,
      password: initial.password,
      remember: true
    });
    assert.equal(setup.response.status, 200);
    const rememberedHeader = setup.response.headers.get("set-cookie");
    assert.match(rememberedHeader, /anfang_session=/);
    assert.match(rememberedHeader, /HttpOnly/i);
    assert.match(rememberedHeader, /SameSite=Lax/i);
    assert.match(rememberedHeader, /Max-Age=2592000/i);
    assert.doesNotMatch(rememberedHeader, /Secure/i);
    const rememberedCookie = rememberedHeader.split(";", 1)[0];

    const database = new DatabaseSync(join(dataDir, "app.db"));
    const rememberedToken = rememberedCookie.slice(rememberedCookie.indexOf("=") + 1);
    const rememberedHash = createHash("sha256").update(rememberedToken).digest("hex");
    database.prepare(
      `INSERT INTO push_subscriptions
        (id, endpoint, p256dh, auth, session_token_hash, created_at, updated_at)
       VALUES ('test-subscription', 'https://push.example.test', 'key', 'auth', ?, ?, ?)`
    ).run(rememberedHash, new Date().toISOString(), new Date().toISOString());

    assert.equal((await post("/api/auth/setup", { setupToken, username: "另一个人", password: "another-pass-123", remember: true })).response.status, 410);
    assert.equal((await fetch(`${baseUrl}/register`)).status, 200);
    assert.equal((await json("/api/dashboard", { headers: { Cookie: rememberedCookie } })).response.status, 200);
    assert.equal((await json("/api/attachments/missing", { headers: { Cookie: rememberedCookie } })).response.status, 404);
    const signedInState = await json("/api/auth/state", { headers: { Cookie: rememberedCookie } });
    assert.equal(signedInState.body.authenticated, true);
    assert.equal(signedInState.body.username, "bingbing");

    const ownerTopic = await post(
      "/api/topics",
      { name: "共同话题", description: "主人自己的内容" },
      rememberedCookie
    );
    assert.equal(ownerTopic.response.status, 201);
    const ownerNote = await post(
      "/api/notebook",
      { title: "主人笔记", content: "只有主人可以看到" },
      rememberedCookie
    );
    assert.equal(ownerNote.response.status, 201);
    const ownerCaptureForm = new FormData();
    ownerCaptureForm.set("text", "共同事项");
    ownerCaptureForm.set("topicId", ownerTopic.body.topic.id);
    ownerCaptureForm.set(
      "attachment",
      new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64")], { type: "image/png" }),
      "主人截图.png"
    );
    const ownerCaptureResponse = await fetch(`${baseUrl}/api/captures`, {
      method: "POST",
      headers: { Origin: baseUrl, Cookie: rememberedCookie },
      body: ownerCaptureForm
    });
    assert.equal(ownerCaptureResponse.status, 200);
    const ownerCapture = await ownerCaptureResponse.json();

    assert.equal((await post("/api/auth/register", {
      username: "成员甲",
      password: "member-pass-123",
      remember: true
    }, null, { Origin: "https://evil.example" })).response.status, 403);
    assert.equal((await post("/api/auth/register", {
      username: "成员甲",
      password: "too-short",
      remember: true
    })).response.status, 400);
    const registration = await post("/api/auth/register", {
      username: "成员甲",
      password: "member-pass-123",
      remember: true
    });
    assert.equal(registration.response.status, 201);
    const memberCookie = registration.response.headers.get("set-cookie").split(";", 1)[0];
    assert.equal((await post("/api/auth/register", {
      username: " 成员甲 ",
      password: "member-pass-456",
      remember: true
    })).response.status, 409);

    const emptyMemberDashboard = await json("/api/dashboard", { headers: { Cookie: memberCookie } });
    assert.equal(emptyMemberDashboard.response.status, 200);
    assert.equal(emptyMemberDashboard.body.totalOpen, 0);
    assert.deepEqual(emptyMemberDashboard.body.topics, []);
    assert.deepEqual(emptyMemberDashboard.body.notebook, []);

    const memberTopic = await post(
      "/api/topics",
      { name: "共同话题", description: "成员甲自己的同名话题" },
      memberCookie
    );
    assert.equal(memberTopic.response.status, 201);
    assert.notEqual(memberTopic.body.topic.id, ownerTopic.body.topic.id);
    const memberNote = await post(
      "/api/notebook",
      { title: "成员笔记", content: "只有成员甲可以看到" },
      memberCookie
    );
    assert.equal(memberNote.response.status, 201);
    const memberCaptureForm = new FormData();
    memberCaptureForm.set("text", "共同事项");
    memberCaptureForm.set("topicId", memberTopic.body.topic.id);
    const memberCaptureResponse = await fetch(`${baseUrl}/api/captures`, {
      method: "POST",
      headers: { Origin: baseUrl, Cookie: memberCookie },
      body: memberCaptureForm
    });
    assert.equal(memberCaptureResponse.status, 200);
    const memberCapture = await memberCaptureResponse.json();
    assert.notEqual(memberCapture.item.id, ownerCapture.item.id);

    assert.equal((await json(`/api/topics/${ownerTopic.body.topic.id}`, { headers: { Cookie: memberCookie } })).response.status, 404);
    assert.equal((await json(`/api/attachments/${ownerCapture.item.attachment.id}`, { headers: { Cookie: memberCookie } })).response.status, 404);
    const crossItemEdit = await fetch(`${baseUrl}/api/items/${ownerCapture.item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: baseUrl, Cookie: memberCookie },
      body: JSON.stringify({ action: "rename", title: "越权修改" })
    });
    assert.equal(crossItemEdit.status, 404);
    assert.equal((await post(
      `/api/items/${ownerCapture.item.id}/suggestions`,
      { request: "给这条事项建议" },
      memberCookie
    )).response.status, 404);
    const crossNoteDelete = await fetch(`${baseUrl}/api/notebook/${ownerNote.body.note.id}`, {
      method: "DELETE",
      headers: { Origin: baseUrl, Cookie: memberCookie }
    });
    assert.equal(crossNoteDelete.status, 404);
    const crossTopicChoice = new FormData();
    crossTopicChoice.set("text", "放进别人的话题");
    crossTopicChoice.set("topicId", ownerTopic.body.topic.id);
    const crossTopicCapture = await fetch(`${baseUrl}/api/captures`, {
      method: "POST",
      headers: { Origin: baseUrl, Cookie: memberCookie },
      body: crossTopicChoice
    });
    assert.equal(crossTopicCapture.status, 404);

    const ownerDashboard = await json("/api/dashboard", { headers: { Cookie: rememberedCookie } });
    assert.equal(ownerDashboard.body.totalOpen, 1);
    assert.equal(ownerDashboard.body.topics.length, 1);
    assert.equal(ownerDashboard.body.notebook.length, 1);
    assert.equal(ownerDashboard.body.notebook[0].title, "主人笔记");
    const memberDashboard = await json("/api/dashboard", { headers: { Cookie: memberCookie } });
    assert.equal(memberDashboard.body.totalOpen, 1);
    assert.equal(memberDashboard.body.topics.length, 1);
    assert.equal(memberDashboard.body.notebook.length, 1);
    assert.equal(memberDashboard.body.notebook[0].title, "成员笔记");

    assert.equal((await post("/api/auth/logout", {}, rememberedCookie, { Origin: "https://evil.example" })).response.status, 403);
    const logout = await post("/api/auth/logout", {}, rememberedCookie);
    assert.equal(logout.response.status, 200);
    assert.match(logout.response.headers.get("set-cookie"), /Expires=Thu, 01 Jan 1970/i);
    assert.equal((await json("/api/dashboard", { headers: { Cookie: rememberedCookie } })).response.status, 401);
    assert.equal(database.prepare("SELECT count(*) AS count FROM push_subscriptions").get().count, 0);

    assert.equal((await post("/api/auth/login", { username: "bingbing", password: "wrong-password", remember: false })).response.status, 401);
    const login = await post("/api/auth/login", { username: " ＢＩＮＧＢＩＮＧ ", password: initial.password, remember: false });
    assert.equal(login.response.status, 200);
    const sessionHeader = login.response.headers.get("set-cookie");
    assert.doesNotMatch(sessionHeader, /Max-Age/i);
    const sessionCookie = sessionHeader.split(";", 1)[0];

    const wrongCurrent = await fetch(`${baseUrl}/api/auth/password`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: baseUrl, Cookie: sessionCookie },
      body: JSON.stringify({ currentPassword: "wrong-password", newPassword: "new-strong-pass-456" })
    });
    assert.equal(wrongCurrent.status, 401);
    const changed = await fetch(`${baseUrl}/api/auth/password`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: baseUrl, Cookie: sessionCookie },
      body: JSON.stringify({ currentPassword: initial.password, newPassword: "new-strong-pass-456" })
    });
    assert.equal(changed.status, 200);
    await assert.rejects(readFile(join(dataDir, "initial-account.json")), { code: "ENOENT" });
    const changedCookie = changed.headers.get("set-cookie").split(";", 1)[0];
    assert.equal((await json("/api/dashboard", { headers: { Cookie: sessionCookie } })).response.status, 401);
    assert.equal((await json("/api/dashboard", { headers: { Cookie: changedCookie } })).response.status, 200);
    assert.equal((await json("/api/dashboard", { headers: { Cookie: memberCookie } })).response.status, 200);
    assert.equal((await post("/api/auth/login", { username: "bingbing", password: initial.password, remember: true })).response.status, 401);
    assert.equal((await post("/api/auth/login", { username: "bingbing", password: "new-strong-pass-456", remember: true })).response.status, 200);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      assert.equal((await post("/api/auth/login", { username: "不存在", password: "wrong-password", remember: true })).response.status, 401);
    }
    const blocked = await post("/api/auth/login", { username: "不存在", password: "wrong-password", remember: true });
    assert.equal(blocked.response.status, 429);
    assert.equal(blocked.response.headers.get("retry-after"), "900");

    const passwordFile = join(dataDir, "reset-password.txt");
    await writeFile(passwordFile, "final-strong-pass-789\n", { mode: 0o600 });
    const reset = spawnSync(process.execPath, ["scripts/reset-password.mjs", "--env", "test", "--username", "bingbing", "--password-file", passwordFile], {
      env: { ...process.env, DATA_DIR: "", TEST_DATA_DIR: dataDir }, encoding: "utf8"
    });
    assert.equal(reset.status, 0, reset.stderr);
    assert.doesNotMatch(reset.stdout + reset.stderr, /final-strong-pass-789/);
    const recovered = await post("/api/auth/login", {
      username: "bingbing",
      password: "final-strong-pass-789",
      remember: true
    });
    assert.equal(recovered.response.status, 200);
    const recoveredHeader = recovered.response.headers.get("set-cookie");
    assert.match(recoveredHeader, /Max-Age=2592000/i);
    const recoveredCookie = recoveredHeader.split(";", 1)[0];
    assert.equal((await json("/api/dashboard", { headers: { Cookie: changedCookie } })).response.status, 401);
    assert.equal((await json("/api/dashboard", { headers: { Cookie: recoveredCookie } })).response.status, 200);
    assert.equal((await json("/api/dashboard", { headers: { Cookie: memberCookie } })).response.status, 200);
    assert.equal((await post("/api/auth/login", { username: "bingbing", password: "new-strong-pass-456", remember: true })).response.status, 401);
    database.close();
  } finally {
    if (app.exitCode === null) {
      app.kill("SIGTERM");
      await once(app, "exit");
    }
    if (!process.env.KEEP_TEST_DATA) await rm(dataDir, { recursive: true, force: true });
  }
});
