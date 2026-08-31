import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

const environments = ["development", "production", "test"];
const markerName = ".anfang-environment.json";

// Resolve existing parents too, so a symlink cannot make two apparently different
// directories point to the same database or uploads directory.
function canonicalPath(path) {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  return parent === path ? path : join(canonicalPath(parent), basename(path));
}

function contains(parent, child) {
  const path = relative(parent, child);
  return !path || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

export function getRuntimeConfig(env = process.env, cwd = process.cwd()) {
  const environment = env.ANFANG_ENV || (env.NODE_ENV === "development" ? "development" : env.NODE_ENV === "test" ? "test" : "production");
  if (!environments.includes(environment)) throw new Error("ANFANG_ENV 必须为 development、production 或 test。");
  if (env.DATA_DIR) throw new Error("DATA_DIR 已停用，避免开发与正式环境混用。请改用 DATA_ROOT 或分环境的 *_DATA_DIR。");
  const dataRoot = canonicalPath(resolve(cwd, env.DATA_ROOT || "data"));
  const directories = Object.fromEntries(environments.map((name) => [name,
    canonicalPath(resolve(cwd, env[`${name.toUpperCase()}_DATA_DIR`] || join(/* turbopackIgnore: true */ dataRoot, name)))
  ]));
  for (const [index, name] of environments.entries()) {
    const dir = directories[name];
    if ([dataRoot, canonicalPath(resolve(cwd)), parse(dir).root].includes(dir)) {
      throw new Error(`${name} 数据目录必须是独立子目录，不能使用项目根目录或共享数据根目录。`);
    }
    for (const other of environments.slice(index + 1)) {
      if (contains(dir, directories[other]) || contains(directories[other], dir)) {
        throw new Error(`${name} 与 ${other} 的数据目录不能相同或互相包含。`);
      }
      const a = join(dir, "app.db"), b = join(directories[other], "app.db");
      if (existsSync(a) && existsSync(b)) {
        const left = statSync(a), right = statSync(b);
        if (left.dev === right.dev && left.ino === right.ino) throw new Error("不同环境不能共享同一个数据库文件。");
      }
    }
  }
  return {
    environment, dataRoot, directories,
    dataDir: directories[environment],
    databasePath: join(directories[environment], "app.db"),
    remindersEnabled: environment === "production" && env.ENABLE_REMINDERS !== "false" && env.ANFANG_BUILD !== "1"
  };
}

export function ensureDataDirectory(config, { allowLegacyMigration = false } = {}) {
  if (existsSync(config.databasePath) && lstatSync(config.databasePath).isSymbolicLink()) {
    throw new Error("数据库文件不能是符号链接，避免读写另一环境的数据。");
  }
  if (!contains(canonicalPath(config.dataDir), canonicalPath(join(config.dataDir, "uploads")))) {
    throw new Error("uploads 必须位于当前环境目录内，不能链接到其他环境。");
  }
  const markerPath = join(config.dataDir, markerName);
  const validateMarker = () => {
    const marker = JSON.parse(readFileSync(markerPath, "utf8"));
    if (marker.environment !== config.environment) throw new Error("数据目录环境标记不匹配，拒绝打开其他环境的数据库。");
  };
  if (existsSync(markerPath)) validateMarker();
  else if (existsSync(config.databasePath)) {
    throw new Error("发现没有环境标记的数据库。请先核对数据来源，不会自动将它作为测试库或正式库打开。");
  }
  if (config.environment === "production" && !existsSync(config.databasePath) &&
      existsSync(join(config.dataRoot, "app.db")) && !allowLegacyMigration) {
    throw new Error("检测到旧版个人数据。请先运行 npm run db:migrate，将现有数据安全迁移到正式库。");
  }
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  if (!existsSync(markerPath)) {
    try {
      writeFileSync(markerPath, JSON.stringify({ version: 1, environment: config.environment }, null, 2), { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      validateMarker();
    }
  }
  mkdirSync(join(config.dataDir, "uploads"), { recursive: true, mode: 0o700 });
}
