import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("single-owner authentication protects pages, APIs, sessions, and password changes", async () => {
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
    const missingAttachment = await json("/api/attachments/missing");
    assert.equal(missingAttachment.response.status, 401);
    const loginArtwork = await fetch(`${baseUrl}/auth-sanctuary.jpg`);
    assert.equal(loginArtwork.status, 200);
    assert.equal(loginArtwork.headers.get("content-type"), "image/jpeg");

    const state = await json("/api/auth/state");
    assert.deepEqual(state.body, {
      authenticated: false,
      needsSetup: true,
      setupConfigured: true,
      username: null
    });
    assert.equal((await post("/api/auth/setup", { setupToken: "wrong", username: "主人", password: "strong-pass-123", remember: true })).response.status, 403);
    assert.equal((await post("/api/auth/setup", { setupToken, username: "主人", password: "strong-pass-123", remember: true }, null, { Origin: "https://evil.example" })).response.status, 403);

    const setup = await post("/api/auth/setup", {
      setupToken,
      username: "主人",
      password: "strong-pass-123",
      remember: true
    });
    assert.equal(setup.response.status, 201);
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

    assert.equal((await post("/api/auth/setup", { setupToken, username: "另一个人", password: "another-pass-123", remember: true })).response.status, 409);
    assert.equal((await json("/api/dashboard", { headers: { Cookie: rememberedCookie } })).response.status, 200);
    assert.equal((await json("/api/attachments/missing", { headers: { Cookie: rememberedCookie } })).response.status, 404);
    const signedInState = await json("/api/auth/state", { headers: { Cookie: rememberedCookie } });
    assert.equal(signedInState.body.authenticated, true);
    assert.equal(signedInState.body.username, "主人");

    assert.equal((await post("/api/auth/logout", {}, rememberedCookie, { Origin: "https://evil.example" })).response.status, 403);
    const logout = await post("/api/auth/logout", {}, rememberedCookie);
    assert.equal(logout.response.status, 200);
    assert.match(logout.response.headers.get("set-cookie"), /Expires=Thu, 01 Jan 1970/i);
    assert.equal((await json("/api/dashboard", { headers: { Cookie: rememberedCookie } })).response.status, 401);
    assert.equal(database.prepare("SELECT count(*) AS count FROM push_subscriptions").get().count, 0);

    assert.equal((await post("/api/auth/login", { username: "主人", password: "wrong-password", remember: false })).response.status, 401);
    const login = await post("/api/auth/login", { username: " 主人 ", password: "strong-pass-123", remember: false });
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
      body: JSON.stringify({ currentPassword: "strong-pass-123", newPassword: "new-strong-pass-456" })
    });
    assert.equal(changed.status, 200);
    const changedCookie = changed.headers.get("set-cookie").split(";", 1)[0];
    assert.equal((await json("/api/dashboard", { headers: { Cookie: sessionCookie } })).response.status, 401);
    assert.equal((await json("/api/dashboard", { headers: { Cookie: changedCookie } })).response.status, 200);
    assert.equal((await post("/api/auth/login", { username: "主人", password: "strong-pass-123", remember: true })).response.status, 401);
    assert.equal((await post("/api/auth/login", { username: "主人", password: "new-strong-pass-456", remember: true })).response.status, 200);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      assert.equal((await post("/api/auth/login", { username: "不存在", password: "wrong-password", remember: true })).response.status, 401);
    }
    const blocked = await post("/api/auth/login", { username: "不存在", password: "wrong-password", remember: true });
    assert.equal(blocked.response.status, 429);
    assert.equal(blocked.response.headers.get("retry-after"), "900");

    assert.equal((await post("/api/auth/recover", {
      setupToken: "wrong",
      username: "主人",
      password: "final-strong-pass-789",
      remember: true
    })).response.status, 403);
    const recovered = await post("/api/auth/recover", {
      setupToken,
      username: "主人",
      password: "final-strong-pass-789",
      remember: true
    });
    assert.equal(recovered.response.status, 200);
    const recoveredHeader = recovered.response.headers.get("set-cookie");
    assert.match(recoveredHeader, /Max-Age=2592000/i);
    const recoveredCookie = recoveredHeader.split(";", 1)[0];
    assert.equal((await json("/api/dashboard", { headers: { Cookie: changedCookie } })).response.status, 401);
    assert.equal((await json("/api/dashboard", { headers: { Cookie: recoveredCookie } })).response.status, 200);
    assert.equal((await post("/api/auth/login", { username: "主人", password: "new-strong-pass-456", remember: true })).response.status, 401);
    database.close();
  } finally {
    if (app.exitCode === null) {
      app.kill("SIGTERM");
      await once(app, "exit");
    }
    if (!process.env.KEEP_TEST_DATA) await rm(dataDir, { recursive: true, force: true });
  }
});
