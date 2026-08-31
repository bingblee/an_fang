import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { test } from "node:test";
import { getRuntimeConfig } from "../lib/runtime-config.mjs";
import { protectBuild } from "../scripts/protect-build.mjs";

test("build protection only removes private references, preserves originals, and is repeatable", async () => {
  const root = await mkdtemp(join(tmpdir(), "anfang-build-test-"));
  try {
    const config = getRuntimeConfig({ DATA_ROOT: join(root, "private"), TEST_DATA_DIR: join(root, "custom-test") });
    const buildDir = join(root, "build");
    await mkdir(buildDir);
    await mkdir(config.dataRoot);
    const privateFile = join(config.dataRoot, "app.db");
    await writeFile(privateFile, "synthetic private bytes");
    const trace = join(buildDir, "instrumentation.js.nft.json");
    await writeFile(trace, JSON.stringify({ version: 1, files: [privateFile, join(config.directories.test, "app.db"), "../.env.local", "../node_modules/example/index.js"] }));
    assert.deepEqual(await protectBuild(config, buildDir), { traces: 1, removed: 3 });
    assert.deepEqual(JSON.parse(await readFile(trace, "utf8")).files, ["../node_modules/example/index.js"]);
    assert.equal(await readFile(privateFile, "utf8"), "synthetic private bytes");
    assert.equal((await protectBuild(config, buildDir)).removed, 0);
    await mkdir(join(buildDir, "standalone"));
    await assert.rejects(protectBuild(config, buildDir), /独立部署包/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("production deployment traces exclude private data and environment files", () => {
  const config = getRuntimeConfig();
  const privateDirs = [config.dataRoot, ...Object.values(config.directories)];
  const traces = readdirSync(".next-prod", { recursive: true }).filter((file) => file.endsWith(".nft.json"));
  assert.ok(traces.length > 0, "Run npm run build before the regression tests");
  for (const trace of traces) {
    const path = resolve(".next-prod", trace);
    const files = JSON.parse(readFileSync(path, "utf8")).files;
    for (const file of files) {
      const absolute = resolve(dirname(path), file);
      assert.ok(!privateDirs.some((dir) => absolute === dir || absolute.startsWith(dir + sep)), `${trace} includes private runtime data`);
      assert.ok(!basename(absolute).startsWith(".env"), `${trace} includes an environment configuration file`);
    }
  }
});
