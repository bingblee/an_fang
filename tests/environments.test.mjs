import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ensureDataDirectory, getRuntimeConfig } from "../lib/runtime-config.mjs";
import { getAllowedDevOrigins } from "../lib/dev-origins.ts";
import { migrateProduction } from "../scripts/migrate-production.mjs";

async function isolated(run) {
  const root = mkdtempSync(join(tmpdir(), "anfang-environment-test-"));
  try { await run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}
const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const config = (root, environment = "production", overrides = {}) => getRuntimeConfig({ DATA_ROOT: root, ANFANG_ENV: environment, ...overrides });

function legacyFixture(root, attachment = true) {
  const db = new DatabaseSync(join(root, "app.db"));
  const imagePath = join(root, "uploads", "2026", "example.png");
  mkdirSync(join(root, "uploads", "2026"), { recursive: true });
  if (attachment) writeFileSync(imagePath, "synthetic image bytes");
  db.exec(`CREATE TABLE items (id TEXT PRIMARY KEY, title TEXT, notes TEXT);
    CREATE TABLE attachments (id TEXT PRIMARY KEY, storage_path TEXT, sha256 TEXT);
    CREATE TABLE notebook_notes (id TEXT PRIMARY KEY, content TEXT);`);
  db.prepare("INSERT INTO items VALUES ('one', '保留原始事项', '私人内容不应进入测试库')").run();
  db.prepare("INSERT INTO attachments VALUES ('image', ?, ?)").run(imagePath, attachment ? hash(imagePath) : null);
  db.prepare("INSERT INTO notebook_notes VALUES ('note', '独立笔记副本')").run();
  db.close();
  writeFileSync(join(root, "vapid.json"), JSON.stringify({ publicKey: "synthetic-public", privateKey: "synthetic-private" }));
  return imagePath;
}

test("development, production, and automated tests have separate default directories", () => isolated(async (root) => {
  const prod = config(root), dev = config(root, "development"), automated = config(root, "test");
  assert.equal(new Set([prod.dataDir, dev.dataDir, automated.dataDir]).size, 3);
  assert.ok(prod.dataDir.endsWith("production"));
  assert.ok(dev.dataDir.endsWith("development"));
  assert.equal(prod.remindersEnabled, true);
  assert.equal(dev.remindersEnabled, false);
  assert.equal(automated.remindersEnabled, false);
  assert.equal(config(root, "production", { ANFANG_BUILD: "1" }).remindersEnabled, false);
  assert.ok(!existsSync(prod.dataDir), "Reading configuration must not create a production database");
  ensureDataDirectory(dev);
  assert.ok(!existsSync(prod.dataDir));
}));

test("development allows private LAN origins without exposing public interfaces", () => {
  const address = (value, internal = false) => ({
    address: value, netmask: "255.255.255.0", family: "IPv4", mac: "00:00:00:00:00:00",
    internal, cidr: `${value}/24`
  });
  const origins = getAllowedDevOrigins({
    wifi: [address("10.160.33.37")],
    home: [address("192.168.1.7")],
    vpn: [address("172.31.1.3")],
    public: [address("8.8.8.8")],
    loopback: [address("127.0.0.1", true)]
  }, "devbox.local, 10.160.33.37");
  assert.deepEqual(origins, ["127.0.0.1", "10.160.33.37", "192.168.1.7", "172.31.1.3", "devbox.local"]);
});

test("shared legacy DATA_DIR and misspelled environment names fail closed", () => isolated(async (root) => {
  assert.throws(() => config(root, "prodution"), /ANFANG_ENV/);
  assert.throws(() => config(root, "development", { DATA_DIR: root }), /DATA_DIR 已停用/);
}));

test("same, nested, and symlinked environment directories are rejected", () => isolated(async (root) => {
  const prod = config(root).dataDir;
  assert.throws(() => config(root, "development", { DEVELOPMENT_DATA_DIR: prod }), /不能相同/);
  assert.throws(() => config(root, "development", { DEVELOPMENT_DATA_DIR: join(prod, "nested") }), /不能相同/);
  mkdirSync(prod);
  symlinkSync(prod, join(root, "alias"));
  assert.throws(() => config(root, "development", { DEVELOPMENT_DATA_DIR: join(root, "alias") }), /不能相同/);
  assert.throws(() => config(root, "development", { DEVELOPMENT_DATA_DIR: root }), /独立子目录/);
}));

test("hard-linked database files cannot be opened as different environments", () => isolated(async (root) => {
  const prod = config(root), dev = config(root, "development");
  ensureDataDirectory(prod); ensureDataDirectory(dev);
  writeFileSync(prod.databasePath, "not a real database");
  linkSync(prod.databasePath, dev.databasePath);
  assert.throws(() => config(root, "development"), /共享同一个数据库文件/);
}));

test("directory marker prevents a copied or misconfigured production folder from becoming a test database", () => isolated(async (root) => {
  const prod = config(root); ensureDataDirectory(prod);
  const other = getRuntimeConfig({ DATA_ROOT: join(root, "another-root"), ANFANG_ENV: "test", TEST_DATA_DIR: prod.dataDir });
  assert.throws(() => ensureDataDirectory(other), /环境标记不匹配/);
}));

test("unmarked existing databases are never silently adopted", () => isolated(async (root) => {
  const dev = config(root, "development");
  mkdirSync(dev.dataDir); writeFileSync(dev.databasePath, "existing data");
  assert.throws(() => ensureDataDirectory(dev), /没有环境标记/);
}));

test("database and uploads symlinks cannot escape their environment", () => isolated(async (root) => {
  const dev = config(root, "development"), prod = config(root);
  ensureDataDirectory(dev); ensureDataDirectory(prod);
  writeFileSync(prod.databasePath, "synthetic data");
  symlinkSync(prod.databasePath, dev.databasePath);
  assert.throws(() => ensureDataDirectory(dev), /符号链接/);
  const other = config(join(root, "second"), "development");
  mkdirSync(other.dataDir, { recursive: true });
  symlinkSync(join(prod.dataDir, "uploads"), join(other.dataDir, "uploads"));
  assert.throws(() => ensureDataDirectory(other), /uploads/);
}));

test("legacy production data blocks an accidental empty production startup", () => isolated(async (root) => {
  legacyFixture(root);
  assert.throws(() => ensureDataDirectory(config(root)), /npm run db:migrate/);
  ensureDataDirectory(config(root, "development"));
  assert.ok(!existsSync(config(root, "development").databasePath));
}));

test("migration preserves original data, copies attachments and VAPID keys, and is idempotent", () => isolated(async (root) => {
  const image = legacyFixture(root);
  const originalHash = hash(join(root, "app.db"));
  const result = await migrateProduction(config(root), true);
  assert.equal(hash(join(root, "app.db")), originalHash);
  assert.ok(existsSync(result.backupPath));
  const db = new DatabaseSync(result.databasePath, { readOnly: true });
  assert.equal(db.prepare("SELECT title FROM items").get().title, "保留原始事项");
  assert.equal(db.prepare("SELECT content FROM notebook_notes").get().content, "独立笔记副本");
  const migratedImage = db.prepare("SELECT storage_path FROM attachments").get().storage_path;
  assert.ok(migratedImage.startsWith(config(root).dataDir));
  assert.equal(hash(migratedImage), hash(image));
  assert.equal(hash(join(root, "vapid.json")), hash(join(config(root).dataDir, "vapid.json")));
  db.close();
  ensureDataDirectory(config(root));
  assert.equal((await migrateProduction(config(root), true)).alreadyMigrated, true);
  ensureDataDirectory(config(root, "development"));
  assert.ok(!existsSync(config(root, "development").databasePath), "No private rows are copied into development");
}));

test("migration requires stopping the service and never overwrites an existing target", () => isolated(async (root) => {
  legacyFixture(root);
  await assert.rejects(migrateProduction(config(root)), /先停止正式服务/);
  mkdirSync(config(root).dataDir);
  await assert.rejects(migrateProduction(config(root), true), /已存在/);
}));

test("missing attachments stop migration before activating the new database", () => isolated(async (root) => {
  legacyFixture(root, false);
  const before = hash(join(root, "app.db"));
  await assert.rejects(migrateProduction(config(root), true));
  assert.ok(!existsSync(config(root).dataDir));
  assert.equal(hash(join(root, "app.db")), before);
}));
