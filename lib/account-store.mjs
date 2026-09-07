import { randomBytes, randomUUID, scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const scryptOptions = { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };
const ownedTables = ["captures", "topics", "items", "notebook_notes", "feedback", "context_facts", "push_subscriptions"];
const bootstrapKey = "system-account-bingbing-v1";

export function normalizeUsername(value) {
  return value.trim().normalize("NFKC").toLocaleLowerCase("zh-CN");
}

export function passwordProblem(value) {
  if (value.length < 10) return "密码至少需要 10 个字符。";
  if (value.length > 200) return "密码不能超过 200 个字符。";
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return "密码需要同时包含字母和数字。";
  return null;
}

export function usernameProblem(value) {
  const normalized = value.trim().normalize("NFKC");
  if (normalized.length < 2) return "用户名至少需要 2 个字符。";
  if (normalized.length > 40) return "用户名不能超过 40 个字符。";
  if (/\p{C}/u.test(normalized)) return "用户名包含不能使用的字符。";
  return null;
}

function derivePassword(password, salt) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, scryptOptions, (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return { hash: (await derivePassword(password, salt)).toString("hex"), salt };
}

export async function verifyPassword(password, hash, salt) {
  const derived = await derivePassword(password, salt);
  const expected = Buffer.from(hash, "hex");
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

export function initialCredentialsPath(dataDir) {
  return join(dataDir, "initial-account.json");
}

export function readPrivateFile(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o077) || (process.getuid && stat.uid !== process.getuid()) || stat.size > 4096) {
      throw new Error("密码文件必须由当前系统用户拥有，仅本人可读写，且不超过 4 KB。");
    }
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}

function pendingCredentials(dataDir) {
  const path = initialCredentialsPath(dataDir);
  try {
    const value = JSON.parse(readPrivateFile(path));
    if (value.version !== 1 || value.username !== "bingbing" || typeof value.userId !== "string" ||
        !/^[0-9a-f-]{36}$/.test(value.userId) || typeof value.password !== "string" || passwordProblem(value.password)) {
      throw new Error("初始账号文件格式无效，请在服务器核对该文件。");
    }
    return value;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const value = { version: 1, userId: randomUUID(), username: "bingbing", password: `Aa1-${randomBytes(24).toString("base64url")}` };
  // Persist before committing the account so a failed startup can reuse its password.
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value, null, 2) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const directory = openSync(dataDir, "r");
  try { fsyncSync(directory); } finally { closeSync(directory); }
  return value;
}

export function initializeSystemAccount(db, dataDir) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS app_migrations (
      name TEXT PRIMARY KEY, completed_at TEXT NOT NULL
    )`);
    if (db.prepare("SELECT 1 FROM app_migrations WHERE name = ?").get(bootstrapKey)) {
      db.exec("COMMIT");
      return;
    }
    const existing = db.prepare("SELECT id FROM auth_users WHERE username_key = 'bingbing'").get();
    const hasUnownedData = ownedTables.some((table) => db.prepare(`SELECT 1 FROM ${table} WHERE user_id IS NULL LIMIT 1`).get());
    if (existing && hasUnownedData) {
      throw new Error("已有 bingbing 账号且存在无归属数据，请在服务器核实归属后再启动；不会自动向已有账号授权。");
    }
    if (!existing) {
      const initial = pendingCredentials(dataDir);
      const salt = randomBytes(16).toString("hex");
      const hash = scryptSync(initial.password, salt, 64, scryptOptions).toString("hex");
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO auth_users
        (id, username, username_key, password_hash, password_salt, created_at, updated_at)
        VALUES (?, 'bingbing', 'bingbing', ?, ?, ?, ?)`)
        .run(initial.userId, hash, salt, now, now);
      for (const table of ownedTables) {
        db.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id IS NULL`).run(initial.userId);
      }
    }
    db.prepare("INSERT INTO app_migrations (name, completed_at) VALUES (?, ?)").run(bootstrapKey, new Date().toISOString());
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function removeInitialCredentials(dataDir, userId) {
  try {
    const path = initialCredentialsPath(dataDir);
    if (JSON.parse(readPrivateFile(path)).userId === userId) unlinkSync(path);
  } catch (error) {
    if (error.code !== "ENOENT") console.warn("密码已更新，但初始账号文件未能清理，请在服务器检查文件权限。");
  }
}

export async function updateAccountPassword(db, dataDir, userId, password, expectedHash) {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const credentials = await hashPassword(password);
  db.exec("BEGIN IMMEDIATE");
  try {
    const user = db.prepare("SELECT password_hash FROM auth_users WHERE id = ?").get(userId);
    if (!user) throw new Error("账号不存在。");
    if (expectedHash !== undefined && user.password_hash !== expectedHash) {
      db.exec("ROLLBACK");
      return false;
    }
    db.prepare("UPDATE auth_users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?")
      .run(credentials.hash, credentials.salt, new Date().toISOString(), userId);
    db.prepare(`DELETE FROM push_subscriptions WHERE user_id = ? OR
      session_token_hash IN (SELECT token_hash FROM auth_sessions WHERE user_id = ?)`).run(userId, userId);
    db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(userId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  removeInitialCredentials(dataDir, userId);
  return true;
}
