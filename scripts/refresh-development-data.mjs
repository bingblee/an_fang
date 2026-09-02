import { constants, existsSync, realpathSync } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { backup, DatabaseSync } from "node:sqlite";
import nextEnv from "@next/env";
import { ensureDataDirectory, getRuntimeConfig } from "../lib/runtime-config.mjs";

const { loadEnvConfig } = nextEnv;

function isWithin(parent, child) {
  const path = relative(parent, child);
  return path && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

export async function refreshDevelopmentData({
  cwd = process.cwd(),
  env = process.env,
  confirmDevStopped = false
} = {}) {
  if (!confirmDevStopped) throw new Error("请先停止开发服务，再使用 --confirm-dev-stopped 刷新测试数据。");
  const production = getRuntimeConfig({ ...env, ANFANG_ENV: "production" }, cwd);
  const development = getRuntimeConfig({ ...env, ANFANG_ENV: "development" }, cwd);
  if (!existsSync(production.databasePath)) throw new Error("正式数据库不存在，未修改测试环境。");
  ensureDataDirectory(production);
  ensureDataDirectory(development);

  const backupRoot = join(production.dataRoot, "backups");
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  const backupDir = await mkdtemp(join(backupRoot, "before-development-refresh-"));
  const previousDevelopment = join(backupDir, "development");
  const stage = await mkdtemp(join(production.dataRoot, ".development-refresh-"));
  const stageConfig = { ...development, dataDir: stage, databasePath: join(stage, "app.db") };
  ensureDataDirectory(stageConfig);

  const source = new DatabaseSync(production.databasePath, { readOnly: true });
  try {
    await backup(source, stageConfig.databasePath);
  } finally {
    source.close();
  }
  await chmod(stageConfig.databasePath, 0o600);

  const cloned = new DatabaseSync(stageConfig.databasePath);
  let attachmentCount = 0;
  try {
    cloned.exec("PRAGMA foreign_keys = ON; BEGIN IMMEDIATE");
    const tableNames = new Set(cloned.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    const attachments = tableNames.has("attachments")
      ? cloned.prepare("SELECT id, storage_path, sha256 FROM attachments").all()
      : [];
    attachmentCount = attachments.length;
    const productionUploads = realpathSync(join(production.dataDir, "uploads"));
    for (const attachment of attachments) {
      const sourcePath = isAbsolute(attachment.storage_path)
        ? attachment.storage_path
        : resolve(production.dataDir, attachment.storage_path);
      const actual = realpathSync(sourcePath);
      if (!isWithin(productionUploads, actual)) throw new Error("正式截图路径越出了 uploads，已停止复制。");
      if (attachment.sha256 && createHash("sha256").update(await readFile(actual)).digest("hex") !== attachment.sha256) {
        throw new Error("正式截图校验失败，已停止复制。");
      }
      const within = relative(productionUploads, actual);
      const stagedPath = join(stage, "uploads", within);
      await mkdir(dirname(stagedPath), { recursive: true, mode: 0o700 });
      await copyFile(actual, stagedPath, constants.COPYFILE_EXCL);
      cloned.prepare("UPDATE attachments SET storage_path = ? WHERE id = ?")
        .run(join(development.dataDir, "uploads", within), attachment.id);
    }
    // 测试环境不继承正式浏览器的推送订阅，避免误发通知。
    if (tableNames.has("push_subscriptions")) cloned.exec("DELETE FROM push_subscriptions");
    cloned.exec("COMMIT");
    if (cloned.prepare("PRAGMA integrity_check").get().integrity_check !== "ok" ||
        cloned.prepare("PRAGMA foreign_key_check").all().length) {
      throw new Error("复制后的测试数据库完整性检查失败。");
    }
  } catch (error) {
    try { cloned.exec("ROLLBACK"); } catch { /* Transaction may already be closed. */ }
    throw error;
  } finally {
    cloned.close();
  }

  let movedPrevious = false;
  try {
    await rename(development.dataDir, previousDevelopment);
    movedPrevious = true;
    await rename(stage, development.dataDir);
  } catch (error) {
    if (movedPrevious && !existsSync(development.dataDir)) await rename(previousDevelopment, development.dataDir);
    throw error;
  } finally {
    if (existsSync(stage)) await rm(stage, { recursive: true, force: true });
  }

  const summary = clonedSummary(development.databasePath);
  return { ...summary, attachmentCount, backupPath: previousDevelopment };
}

function clonedSummary(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    const count = (table) => tables.has(table) ? Number(database.prepare(`SELECT count(*) AS count FROM ${table}`).get().count) : 0;
    return { captures: count("captures"), items: count("items"), topics: count("topics"), notes: count("notebook_notes") };
  } finally {
    database.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    loadEnvConfig(process.cwd(), false);
    const result = await refreshDevelopmentData({ confirmDevStopped: process.argv.includes("--confirm-dev-stopped") });
    console.log("正式数据已复制到测试环境；原测试环境已备份。");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
