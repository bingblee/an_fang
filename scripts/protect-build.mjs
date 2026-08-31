import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";

// Next 16.3 applies route exclusions but leaves instrumentation's trace intact.
// These are runtime files, not deployable assets. Keep the generated manifests
// safe as well; never modify the original databases, uploads, or configuration.
export async function protectBuild(config, buildDir = resolve(".next-prod")) {
  if (existsSync(resolve(buildDir, "standalone"))) {
    throw new Error("独立部署包需要单独核验数据隔离；当前请使用 npm start，不发布 standalone 目录。");
  }
  const privateDirs = [config.dataRoot, ...Object.values(config.directories)];
  const traces = (await readdir(buildDir, { recursive: true })).filter((file) => file.endsWith(".nft.json"));
  if (!traces.length) throw new Error("未找到生产构建文件清单，停止发布。");
  let removed = 0;
  for (const trace of traces) {
    const path = resolve(buildDir, trace);
    const manifest = JSON.parse(await readFile(path, "utf8"));
    const files = manifest.files.filter((file) => {
      const absolute = resolve(dirname(path), file);
      return !basename(absolute).startsWith(".env") &&
        !privateDirs.some((dir) => absolute === dir || absolute.startsWith(dir + sep));
    });
    if (files.length !== manifest.files.length) {
      removed += manifest.files.length - files.length;
      await writeFile(path, JSON.stringify({ ...manifest, files }));
    }
  }
  return { traces: traces.length, removed };
}
