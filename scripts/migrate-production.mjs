import { constants, existsSync, realpathSync } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { backup, DatabaseSync } from "node:sqlite";
import nextEnv from "@next/env";
import { ensureDataDirectory, getRuntimeConfig } from "../lib/runtime-config.mjs";

const { loadEnvConfig } = nextEnv;

export async function migrateProduction(config, confirmStopped = false) {
  if (!confirmStopped) throw new Error("请先停止正式服务，再运行 npm run db:migrate -- --confirm-stopped。");
  if (config.environment !== "production") throw new Error("迁移目标必须为正式环境。");
  const sourcePath = join(config.dataRoot, "app.db");
  const reportPath = join(config.dataDir, ".legacy-migration.json");
  if (existsSync(reportPath) && existsSync(config.databasePath)) {
    ensureDataDirectory(config);
    return { ...JSON.parse(await readFile(reportPath, "utf8")), alreadyMigrated: true };
  }
  if (existsSync(config.dataDir)) throw new Error("正式数据目录已存在，未覆盖任何内容。请先人工核对。");
  if (!existsSync(sourcePath)) throw new Error("未找到旧版 data/app.db。新项目直接启动即可自动建立空库。");

  const backupRoot = join(config.dataRoot, "backups");
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  const backupDir = await mkdtemp(join(backupRoot, "before-environment-split-"));
  const backupPath = join(backupDir, "app.db");
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try { await backup(source, backupPath); } finally { source.close(); }
  await chmod(backupPath, 0o600);

  // Build the complete production directory off to the side. Only make it active
  // after every referenced attachment and database integrity check succeeds.
  await mkdir(dirname(config.dataDir), { recursive: true, mode: 0o700 });
  const stage = await mkdtemp(join(dirname(config.dataDir), ".production-migration-"));
  ensureDataDirectory({ ...config, dataDir: stage, databasePath: join(stage, "app.db") }, { allowLegacyMigration: true });
  await copyFile(backupPath, join(stage, "app.db"), constants.COPYFILE_EXCL);
  const copied = new DatabaseSync(join(stage, "app.db"));
  let report;
  try {
    copied.exec("PRAGMA foreign_keys = ON");
    const attachments = copied.prepare("SELECT id, storage_path, sha256 FROM attachments").all();
    const copiedFiles = new Set();
    const sourceUploads = join(config.dataRoot, "uploads");
    const uploadRoot = attachments.length ? realpathSync(sourceUploads) : sourceUploads;
    copied.exec("BEGIN IMMEDIATE");
    for (const attachment of attachments) {
      const oldPath = isAbsolute(attachment.storage_path) ? attachment.storage_path : resolve(config.dataRoot, attachment.storage_path);
      const actual = realpathSync(oldPath);
      const within = relative(uploadRoot, actual);
      if (!within || within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) {
        throw new Error("截图路径不在旧 uploads 目录中，已停止迁移。");
      }
      if (attachment.sha256 && createHash("sha256").update(await readFile(actual)).digest("hex") !== attachment.sha256) {
        throw new Error("截图校验失败，已停止迁移，旧文件未修改。");
      }
      if (!copiedFiles.has(within)) {
        const destination = join(stage, "uploads", within);
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
        await copyFile(actual, destination, constants.COPYFILE_EXCL);
        copiedFiles.add(within);
      }
      copied.prepare("UPDATE attachments SET storage_path = ? WHERE id = ?").run(join(config.dataDir, "uploads", within), attachment.id);
    }
    copied.exec("COMMIT");
    if (copied.prepare("PRAGMA integrity_check").get().integrity_check !== "ok" || copied.prepare("PRAGMA foreign_key_check").all().length) {
      throw new Error("数据库完整性检查失败，旧数据库未修改。");
    }
    if (existsSync(join(config.dataRoot, "vapid.json"))) {
      await copyFile(join(config.dataRoot, "vapid.json"), join(stage, "vapid.json"), constants.COPYFILE_EXCL);
      await chmod(join(stage, "vapid.json"), 0o600);
    }
    report = { migratedAt: new Date().toISOString(), sourcePath, backupPath, databasePath: config.databasePath, attachments: attachments.length };
    await writeFile(join(stage, ".legacy-migration.json"), JSON.stringify(report, null, 2), { flag: "wx", mode: 0o600 });
  } finally { copied.close(); }
  if (existsSync(config.dataDir)) throw new Error("正式目录在迁移期间被创建，未覆盖它。旧数据和迁移副本均保留。");
  await rename(stage, config.dataDir);
  return { ...report, alreadyMigrated: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    loadEnvConfig(process.cwd(), false);
    process.env.ANFANG_ENV = "production";
    const result = await migrateProduction(getRuntimeConfig(), process.argv.includes("--confirm-stopped"));
    console.log(result.alreadyMigrated ? "正式库已迁移，无需重复操作。" : "正式库迁移完成；旧数据库与截图均保留。");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
