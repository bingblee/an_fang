import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import nextEnv from "@next/env";
import { ensureDataDirectory, getRuntimeConfig } from "../lib/runtime-config.mjs";
import { protectBuild } from "./protect-build.mjs";

const { loadEnvConfig } = nextEnv;

const [command, ...args] = process.argv.slice(2);
if (!["dev", "build", "start"].includes(command)) throw new Error("请选择 dev、build 或 start。");
const development = command === "dev";
process.env.NODE_ENV = development ? "development" : "production";
loadEnvConfig(process.cwd(), development);
// The command, not a shared .env.local value, decides which environment is opened.
process.env.ANFANG_ENV = development ? "development" : "production";
process.env.ANFANG_BUILD = command === "build" ? "1" : "0";
const config = getRuntimeConfig();
if (command !== "build") ensureDataDirectory(config);
console.log(`[安放] ${development ? "开发 / 测试数据" : "正式环境"} · ${config.databasePath}${config.remindersEnabled ? "" : " · 不发送提醒"}`);

if (command !== "build") {
  if (!args.some((arg) => arg === "-p" || arg === "--port" || arg.startsWith("--port="))) args.push("--port", process.env.PORT || (development ? "3001" : "3000"));
  if (!args.some((arg) => arg === "-H" || arg === "--hostname" || arg.startsWith("--hostname="))) args.push("--hostname", "0.0.0.0");
}
const require = createRequire(import.meta.url);
const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), command, ...args], { stdio: "inherit", env: process.env });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", async (code, signal) => {
  process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
  if (code === 0 && command === "build") {
    try {
      const result = await protectBuild(config);
      console.log(`[安放] 已检查 ${result.traces} 份部署清单，排除 ${result.removed} 条私人运行文件引用。`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
});
