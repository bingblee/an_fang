import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { claimLegacyData, getDb } from "@/lib/db";

export const sessionCookieName = "anfang_session";
export const rememberedSessionSeconds = 60 * 60 * 24 * 30;
export const browserSessionSeconds = 60 * 60 * 24;

const scryptOptions = { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };
const sessionTouchIntervalMs = 15 * 60 * 1000;
const loginWindowMs = 15 * 60 * 1000;
const loginBlockMs = 15 * 60 * 1000;
const maxLoginAttempts = 5;
const dummySalt = "01582c8541e92898f0b38f984e1a819c";
const dummyHash = "3cc4f9a4dfc58c29ed1f490f6372525b83528be6802d344ae95a18b7cfc493b15d77808430967128c0aaefef22e405c5548b0bbd785d264969f5c433cf1fb173";

export type AuthSession = {
  userId: string;
  username: string;
  expiresAt: string;
  remembered: boolean;
};

type SessionRow = {
  user_id: string;
  username: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
};

type UserRow = {
  id: string;
  username: string;
  username_key: string;
  password_hash: string;
  password_salt: string;
};

export function normalizeUsername(value: string) {
  return value.trim().normalize("NFKC").toLocaleLowerCase("zh-CN");
}

export function passwordProblem(value: string) {
  if (value.length < 10) return "密码至少需要 10 个字符。";
  if (value.length > 200) return "密码不能超过 200 个字符。";
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return "密码需要同时包含字母和数字。";
  return null;
}

export function usernameProblem(value: string) {
  const normalized = value.trim().normalize("NFKC");
  if (normalized.length < 2) return "用户名至少需要 2 个字符。";
  if (normalized.length > 40) return "用户名不能超过 40 个字符。";
  if (/\p{C}/u.test(normalized)) return "用户名包含不能使用的字符。";
  return null;
}

function derivePassword(password: string, salt: string) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, 64, scryptOptions, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export async function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const derived = await derivePassword(password, salt);
  return { hash: derived.toString("hex"), salt };
}

export async function verifyPassword(password: string, hash: string, salt: string) {
  const derived = await derivePassword(password, salt);
  const expected = Buffer.from(hash, "hex");
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

export function hasOwnerAccount() {
  const row = getDb().prepare("SELECT 1 AS present FROM auth_users LIMIT 1").get() as
    | { present: number }
    | undefined;
  return Boolean(row);
}

export function findUser(username: string) {
  return getDb()
    .prepare("SELECT id, username, username_key, password_hash, password_salt FROM auth_users WHERE username_key = ?")
    .get(normalizeUsername(username)) as UserRow | undefined;
}

export function findUserById(userId: string) {
  return getDb()
    .prepare("SELECT id, username, username_key, password_hash, password_salt FROM auth_users WHERE id = ?")
    .get(userId) as UserRow | undefined;
}

async function createAccount(
  username: string,
  password: string,
  options: { onlyFirst: boolean; claimLegacy: boolean }
) {
  const db = getDb();
  const displayName = username.trim().normalize("NFKC");
  const key = normalizeUsername(displayName);
  const credentials = await hashPassword(password);
  const userId = randomUUID();
  const now = new Date().toISOString();
  let transactionOpen = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    if (
      (options.onlyFirst && db.prepare("SELECT 1 FROM auth_users LIMIT 1").get()) ||
      db.prepare("SELECT 1 FROM auth_users WHERE username_key = ?").get(key)
    ) {
      db.exec("ROLLBACK");
      transactionOpen = false;
      return null;
    }
    db.prepare(
      `INSERT INTO auth_users
        (id, username, username_key, password_hash, password_salt, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(userId, displayName, key, credentials.hash, credentials.salt, now, now);
    if (options.claimLegacy) claimLegacyData(db, userId);
    db.exec("COMMIT");
    transactionOpen = false;
    return { id: userId, username: displayName };
  } catch (error) {
    if (transactionOpen) db.exec("ROLLBACK");
    throw error;
  }
}

export async function createOwner(username: string, password: string) {
  return createAccount(username, password, { onlyFirst: true, claimLegacy: true });
}

export async function createUser(username: string, password: string) {
  return createAccount(username, password, { onlyFirst: false, claimLegacy: false });
}

function sessionHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function getCurrentSessionTokenHash() {
  const token = (await cookies()).get(sessionCookieName)?.value;
  return token && token.length <= 256 ? sessionHash(token) : null;
}

export function createSession(userId: string, remember: boolean) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const ttl = remember ? rememberedSessionSeconds : browserSessionSeconds;
  const expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();
  const db = getDb();
  db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(now.toISOString());
  db.prepare(
    `INSERT INTO auth_sessions (token_hash, user_id, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(sessionHash(token), userId, now.toISOString(), now.toISOString(), expiresAt);
  return { token, expiresAt, remember };
}

export async function getCurrentSession(): Promise<AuthSession | null> {
  const token = (await cookies()).get(sessionCookieName)?.value;
  if (!token || token.length > 256) return null;
  const db = getDb();
  const row = db.prepare(
    `SELECT session.user_id, session.created_at, session.expires_at, session.last_seen_at, user.username
     FROM auth_sessions session
     JOIN auth_users user ON user.id = session.user_id
     WHERE session.token_hash = ?`
  ).get(sessionHash(token)) as SessionRow | undefined;
  if (!row) return null;
  const now = new Date();
  if (new Date(row.expires_at) <= now) {
    db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(sessionHash(token));
    return null;
  }
  if (now.getTime() - new Date(row.last_seen_at).getTime() >= sessionTouchIntervalMs) {
    db.prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?")
      .run(now.toISOString(), sessionHash(token));
  }
  return {
    userId: row.user_id,
    username: row.username,
    expiresAt: row.expires_at,
    remembered: new Date(row.expires_at).getTime() - new Date(row.created_at).getTime() > browserSessionSeconds * 1000 * 2
  };
}

function requestIsSecure(request: Request) {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return forwarded === "https" || new URL(request.url).protocol === "https:";
}

export async function setSessionCookie(
  request: Request,
  session: { token: string; remember: boolean }
) {
  const store = await cookies();
  store.set(sessionCookieName, session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: requestIsSecure(request),
    path: "/",
    ...(session.remember ? { maxAge: rememberedSessionSeconds } : {})
  });
}

export async function clearSessionCookie(request: Request) {
  const store = await cookies();
  const token = store.get(sessionCookieName)?.value;
  if (token) {
    const hash = sessionHash(token);
    const db = getDb();
    db.prepare("DELETE FROM push_subscriptions WHERE session_token_hash = ?").run(hash);
    db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(hash);
  }
  store.set(sessionCookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: requestIsSecure(request),
    path: "/",
    expires: new Date(0)
  });
}

export function setupTokenMatches(value: string) {
  const expected = process.env.AUTH_SETUP_TOKEN || "";
  if (expected.length < 20 || value.length > 500) return false;
  const expectedHash = createHash("sha256").update(expected).digest();
  const valueHash = createHash("sha256").update(value).digest();
  return timingSafeEqual(expectedHash, valueHash);
}

export function requestOriginAllowed(request: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const target = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const expected = forwardedHost
    ? `${forwardedProto === "https" ? "https" : target.protocol.replace(":", "")}://${forwardedHost}`
    : target.origin;
  return origin === expected;
}

export type ApiSessionResult =
  | { ok: true; session: AuthSession }
  | { ok: false; response: NextResponse };

export async function requireApiSession(request: NextRequest): Promise<ApiSessionResult> {
  if (!requestOriginAllowed(request)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "请求来源无效，请刷新页面后重试。" }, { status: 403 })
    };
  }
  const session = await getCurrentSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "登录状态已失效，请重新登录。" },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      )
    };
  }
  return { ok: true, session };
}

function loginAttemptKey(request: NextRequest, username: string) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(`${normalizeUsername(username)}\n${address}`).digest("hex");
}

export function loginBlocked(request: NextRequest, username: string) {
  const key = loginAttemptKey(request, username);
  const row = getDb().prepare(
    "SELECT blocked_until FROM auth_login_attempts WHERE attempt_key = ?"
  ).get(key) as { blocked_until: string | null } | undefined;
  return Boolean(row?.blocked_until && new Date(row.blocked_until) > new Date());
}

export function recordLoginFailure(request: NextRequest, username: string) {
  const db = getDb();
  const key = loginAttemptKey(request, username);
  const now = new Date();
  db.prepare("DELETE FROM auth_login_attempts WHERE updated_at < ?")
    .run(new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());
  const row = db.prepare(
    "SELECT attempts, window_started_at FROM auth_login_attempts WHERE attempt_key = ?"
  ).get(key) as { attempts: number; window_started_at: string } | undefined;
  const inWindow = row && now.getTime() - new Date(row.window_started_at).getTime() < loginWindowMs;
  const attempts = inWindow ? row.attempts + 1 : 1;
  const windowStartedAt = inWindow ? row.window_started_at : now.toISOString();
  const blockedUntil = attempts >= maxLoginAttempts
    ? new Date(now.getTime() + loginBlockMs).toISOString()
    : null;
  db.prepare(
    `INSERT INTO auth_login_attempts
      (attempt_key, attempts, window_started_at, blocked_until, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(attempt_key) DO UPDATE SET
       attempts = excluded.attempts,
       window_started_at = excluded.window_started_at,
       blocked_until = excluded.blocked_until,
       updated_at = excluded.updated_at`
  ).run(key, attempts, windowStartedAt, blockedUntil, now.toISOString());
  db.exec(
    `DELETE FROM auth_login_attempts
     WHERE attempt_key IN (
       SELECT attempt_key FROM auth_login_attempts
       ORDER BY updated_at DESC LIMIT -1 OFFSET 1000
     )`
  );
  return { blocked: Boolean(blockedUntil), attempts };
}

export function clearLoginFailures(request: NextRequest, username: string) {
  getDb().prepare("DELETE FROM auth_login_attempts WHERE attempt_key = ?")
    .run(loginAttemptKey(request, username));
}

export async function runDummyPasswordCheck(password: string) {
  await verifyPassword(password, dummyHash, dummySalt);
}

export async function changePassword(userId: string, password: string) {
  const credentials = await hashPassword(password);
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    "UPDATE auth_users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?"
  ).run(credentials.hash, credentials.salt, now, userId);
  db.prepare(
    `DELETE FROM push_subscriptions
     WHERE session_token_hash IN (SELECT token_hash FROM auth_sessions WHERE user_id = ?)`
  ).run(userId);
  db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(userId);
}
