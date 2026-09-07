import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import * as accounts from "../lib/account-store.mjs";
import * as runtime from "../lib/runtime-config.mjs";
import { loadModule } from "./helpers/load-module.mjs";

const tables = ["captures", "topics", "items", "notebook_notes", "feedback", "context_facts", "push_subscriptions"];

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "anfang-account-store-"));
  runtime.ensureDataDirectory(runtime.getRuntimeConfig({ ANFANG_ENV: "test", TEST_DATA_DIR: dir }));
  const db = new DatabaseSync(join(dir, "app.db"));
  db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE auth_users (id TEXT PRIMARY KEY, username TEXT, username_key TEXT UNIQUE,
      password_hash TEXT, password_salt TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE auth_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT REFERENCES auth_users(id));`);
  for (const table of tables) {
    db.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, user_id TEXT REFERENCES auth_users(id), content TEXT, session_token_hash TEXT)`);
    db.prepare(`INSERT INTO ${table} (id, content) VALUES (?, ?)`).run(`legacy-${table}`, `preserved-${table}`);
  }
  db.exec(`CREATE TABLE attachments (id TEXT, capture_id TEXT REFERENCES captures(id), storage_path TEXT);
    INSERT INTO attachments VALUES ('attachment', 'legacy-captures', '/preserved/path');
    CREATE TABLE reminders (id TEXT, item_id TEXT REFERENCES items(id), scheduled_for TEXT);
    INSERT INTO reminders VALUES ('reminder', 'legacy-items', '2030-01-01T10:00:00Z');`);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const initial = () => JSON.parse(readFileSync(accounts.initialCredentialsPath(dir), "utf8"));
  return { db, dir, initial };
}

async function addExisting(db, name) {
  const credentials = await accounts.hashPassword("existing-password-123");
  db.prepare("INSERT INTO auth_users VALUES (?, ?, ?, ?, ?, 'before', 'before')")
    .run(name, name, name, credentials.hash, credentials.salt);
  return db.prepare("SELECT * FROM auth_users WHERE id = ?").get(name);
}

test("bootstrap assigns all unowned records, preserving owned data and child relationships", async (t) => {
  const { db, dir, initial } = fixture(t);
  const existing = await addExisting(db, "member");
  for (const table of tables) db.prepare(`INSERT INTO ${table} (id, user_id, content) VALUES ('owned', 'member', 'private')`).run();
  accounts.initializeSystemAccount(db, dir);
  const credentials = initial();
  const owner = db.prepare("SELECT * FROM auth_users WHERE username_key = 'bingbing'").get();
  assert.equal(credentials.userId, owner.id);
  assert.equal(statSync(accounts.initialCredentialsPath(dir)).mode & 0o777, 0o600);
  assert.equal(accounts.passwordProblem(credentials.password), null);
  assert.ok(await accounts.verifyPassword(credentials.password, owner.password_hash, owner.password_salt));
  assert.notEqual(owner.password_hash, credentials.password);
  for (const table of tables) {
    const rows = db.prepare(`SELECT * FROM ${table}`).all();
    assert.equal(rows[0].user_id, owner.id);
    assert.equal(rows[0].content, `preserved-${table}`);
    assert.equal(rows[1].user_id, "member");
    assert.equal(rows[1].content, "private");
  }
  assert.deepEqual(db.prepare("SELECT * FROM auth_users WHERE id = 'member'").get(), existing);
  assert.equal(db.prepare("SELECT storage_path FROM attachments").get().storage_path, "/preserved/path");
  assert.equal(db.prepare("SELECT scheduled_for FROM reminders").get().scheduled_for, "2030-01-01T10:00:00Z");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("failed bootstrap rolls back ownership and account, then reuses the durable initial password", (t) => {
  const { db, dir, initial } = fixture(t);
  db.exec("CREATE TRIGGER fail_claim BEFORE UPDATE ON notebook_notes BEGIN SELECT RAISE(ABORT, 'injected failure'); END");
  assert.throws(() => accounts.initializeSystemAccount(db, dir), /injected failure/);
  const pending = initial();
  assert.equal(db.prepare("SELECT count(*) n FROM auth_users").get().n, 0);
  for (const table of tables) assert.equal(db.prepare(`SELECT user_id FROM ${table}`).get().user_id, null);
  db.exec("DROP TRIGGER fail_claim");
  accounts.initializeSystemAccount(db, dir);
  assert.deepEqual(initial(), pending);
  assert.equal(db.prepare("SELECT id FROM auth_users").get().id, pending.userId);
});

test("restarts preserve changed passwords and do not claim newly unowned data or recreate credentials", async (t) => {
  const { db, dir, initial } = fixture(t);
  accounts.initializeSystemAccount(db, dir);
  const { userId } = initial();
  await accounts.updateAccountPassword(db, dir, userId, "changed-password-123");
  assert.equal(existsSync(accounts.initialCredentialsPath(dir)), false);
  db.exec("INSERT INTO captures (id, content) VALUES ('later-unowned', 'new')");
  accounts.initializeSystemAccount(db, dir);
  const owner = db.prepare("SELECT * FROM auth_users").get();
  assert.equal(owner.id, userId);
  assert.ok(await accounts.verifyPassword("changed-password-123", owner.password_hash, owner.password_salt));
  assert.equal(db.prepare("SELECT user_id FROM captures WHERE id = 'later-unowned'").get().user_id, null);
  assert.equal(existsSync(accounts.initialCredentialsPath(dir)), false);
});

test("a preexisting bingbing account is preserved and is never silently granted legacy data", async (t) => {
  const { db, dir } = fixture(t);
  const existing = await addExisting(db, "bingbing");
  assert.throws(() => accounts.initializeSystemAccount(db, dir), /核实归属/);
  assert.deepEqual(db.prepare("SELECT * FROM auth_users").get(), existing);
  for (const table of tables) assert.equal(db.prepare(`SELECT user_id FROM ${table}`).get().user_id, null);
  assert.equal(existsSync(accounts.initialCredentialsPath(dir)), false);
  for (const table of tables) db.exec(`UPDATE ${table} SET user_id = 'bingbing'`);
  accounts.initializeSystemAccount(db, dir);
  assert.deepEqual(db.prepare("SELECT * FROM auth_users").get(), existing);
  assert.equal(existsSync(accounts.initialCredentialsPath(dir)), false);
});

test("password reset revokes only the target account's sessions and subscriptions atomically", async (t) => {
  const { db, dir, initial } = fixture(t);
  accounts.initializeSystemAccount(db, dir);
  const { userId } = initial();
  const existing = await addExisting(db, "member");
  db.prepare("INSERT INTO auth_sessions VALUES ('owner-session', ?)").run(userId);
  db.exec("INSERT INTO auth_sessions VALUES ('member-session', 'member')");
  db.exec("INSERT INTO push_subscriptions (id, user_id, session_token_hash) VALUES ('member-push', 'member', 'member-session')");
  db.exec("INSERT INTO push_subscriptions (id, session_token_hash) VALUES ('legacy-session-push', 'owner-session')");
  const before = db.prepare("SELECT * FROM auth_users WHERE id = ?").get(userId);
  db.exec("CREATE TRIGGER fail_revoke BEFORE DELETE ON auth_sessions BEGIN SELECT RAISE(ABORT, 'injected failure'); END");
  await assert.rejects(accounts.updateAccountPassword(db, dir, userId, "reset-password-456"), /injected failure/);
  assert.deepEqual(db.prepare("SELECT * FROM auth_users WHERE id = ?").get(userId), before);
  assert.equal(db.prepare("SELECT count(*) n FROM push_subscriptions").get().n, 3);
  assert.ok(existsSync(accounts.initialCredentialsPath(dir)));
  db.exec("DROP TRIGGER fail_revoke");
  assert.equal(await accounts.updateAccountPassword(db, dir, userId, "reset-password-456", "stale-hash"), false);
  assert.equal(await accounts.updateAccountPassword(db, dir, userId, "reset-password-456", before.password_hash), true);
  assert.deepEqual(db.prepare("SELECT * FROM auth_users WHERE id = 'member'").get(), existing);
  assert.equal(db.prepare("SELECT count(*) n FROM auth_sessions").get().n, 1);
  assert.equal(db.prepare("SELECT user_id FROM auth_sessions").get().user_id, "member");
  assert.equal(db.prepare("SELECT count(*) n FROM push_subscriptions").get().n, 1);
  assert.equal(db.prepare("SELECT user_id FROM push_subscriptions").get().user_id, "member");
  assert.equal(db.prepare("SELECT content FROM items").get().content, "preserved-items");
});

test("local reset rejects missing accounts, weak passwords, unsafe files and implicit environments", async (t) => {
  const { db, dir, initial } = fixture(t);
  accounts.initializeSystemAccount(db, dir);
  const { userId } = initial();
  const before = db.prepare("SELECT * FROM auth_users").get();
  await assert.rejects(accounts.updateAccountPassword(db, dir, userId, "short"), /至少/);
  await assert.rejects(accounts.updateAccountPassword(db, dir, "missing", "strong-password-456"), /不存在/);
  const path = join(dir, "reset.txt");
  writeFileSync(path, "strong-password-456\n", { mode: 0o600 });
  const run = (args) => spawnSync(process.execPath, ["scripts/reset-password.mjs", ...args], {
    encoding: "utf8", env: { ...process.env, DATA_DIR: "", TEST_DATA_DIR: dir }
  });
  assert.equal(run(["--username", "bingbing", "--password-file", path]).status, 1);
  assert.equal(run(["--env", "test", "--username", "missing", "--password-file", path]).status, 1);
  chmodSync(path, 0o644);
  assert.equal(run(["--env", "test", "--username", "bingbing", "--password-file", path]).status, 1);
  assert.throws(() => accounts.readPrivateFile(path), /仅本人/);
  chmodSync(path, 0o600);
  symlinkSync(path, join(dir, "link.txt"));
  assert.throws(() => accounts.readPrivateFile(join(dir, "link.txt")));
  assert.deepEqual(db.prepare("SELECT * FROM auth_users").get(), before);
});

test("build-time database access fails before opening or creating runtime files", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "anfang-build-no-data-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const databaseModule = loadModule("lib/db.ts", {
    "@/lib/runtime-config.mjs": runtime,
    "@/lib/account-store.mjs": accounts
  }, { process: { env: { ANFANG_ENV: "test", TEST_DATA_DIR: dir, ANFANG_BUILD: "1" }, cwd: () => process.cwd() } });
  assert.throws(() => databaseModule.getDb(), /构建期间/);
  assert.equal(existsSync(join(dir, "app.db")), false);
  assert.equal(existsSync(accounts.initialCredentialsPath(dir)), false);
});
