import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);

// Exercise server and browser modules with isolated database/network boundaries.
export function loadModule(path, imports = {}, globals = {}) {
  const { outputText } = ts.transpileModule(readFileSync(resolve(path), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  });
  const exports = {};
  runInNewContext(outputText, {
    exports, console, Buffer, URL, Date, setTimeout, setInterval,
    require(id) {
      if (Object.hasOwn(imports, id)) return imports[id];
      if (id.startsWith("@/")) throw new Error(`Missing isolated import: ${id}`);
      return require(id);
    },
    ...globals
  }, { filename: path });
  return exports;
}
