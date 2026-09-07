import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { DatabaseSync } from "node:sqlite";
import { Writable } from "node:stream";
import { parseArgs } from "node:util";
import nextEnv from "@next/env";
import { normalizeUsername, readPrivateFile, updateAccountPassword, usernameProblem } from "../lib/account-store.mjs";
import { ensureDataDirectory, getRuntimeConfig } from "../lib/runtime-config.mjs";

async function promptPassword() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("请在交互终端运行，或用 --password-file 指定私有密码文件。");
  const muted = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true, historySize: 0 });
  const controller = new AbortController();
  rl.on("SIGINT", () => controller.abort());
  try {
    process.stdout.write("新密码（输入不显示）：");
    const password = await rl.question("", { signal: controller.signal });
    process.stdout.write("\n再次输入新密码：");
    const confirmation = await rl.question("", { signal: controller.signal });
    if (password !== confirmation) throw new Error("两次输入的密码不一致。");
    return password;
  } finally {
    rl.close();
    muted.end();
    process.stdout.write("\n");
  }
}

try {
  const { values } = parseArgs({ options: {
    env: { type: "string" }, username: { type: "string" }, "password-file": { type: "string" }, help: { type: "boolean" }
  } });
  if (values.help) {
    console.log("用法：npm run auth:reset -- --env production --username bingbing [--password-file /private/password.txt]");
  } else {
    if (!["production", "development", "test"].includes(values.env)) throw new Error("请用 --env 指定 production、development 或 test。");
    if (!values.username || usernameProblem(values.username)) throw new Error("请用 --username 指定有效用户名。");
    nextEnv.loadEnvConfig(process.cwd(), values.env === "development");
    const config = getRuntimeConfig({ ...process.env, ANFANG_ENV: values.env });
    if (!existsSync(config.databasePath)) throw new Error("该环境尚无数据库，请先启动应用完成账号初始化。");
    ensureDataDirectory(config);
    const db = new DatabaseSync(config.databasePath);
    try {
      db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
      const user = db.prepare("SELECT id, username FROM auth_users WHERE username_key = ?").get(normalizeUsername(values.username));
      if (!user) throw new Error("账号不存在，不会创建账号或修改任何数据。");
      console.log(`重置 ${config.environment} 环境的账号：${user.username}`);
      const password = values["password-file"]
        ? readPrivateFile(values["password-file"]).replace(/\r?\n$/, "")
        : await promptPassword();
      await updateAccountPassword(db, config.dataDir, user.id, password);
      console.log("密码已重置，该账号的全部登录会话和推送订阅已撤销。请使用新密码登录。");
    } finally {
      db.close();
    }
  }
} catch (error) {
  console.error(error.name === "AbortError" ? "已取消，密码未修改。" : error.message);
  process.exitCode = 1;
}
