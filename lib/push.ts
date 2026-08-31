import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import webpush from "web-push";
import { dataDir } from "@/lib/db";
import { ensureDataDirectory, getRuntimeConfig } from "@/lib/runtime-config.mjs";

type VapidKeys = { publicKey: string; privateKey: string };

let cachedKeys: VapidKeys | null = null;

export function getVapidKeys(): VapidKeys {
  if (cachedKeys) return cachedKeys;
  ensureDataDirectory(getRuntimeConfig());
  const path = join(dataDir, "vapid.json");
  if (existsSync(path)) {
    cachedKeys = JSON.parse(readFileSync(path, "utf8")) as VapidKeys;
    return cachedKeys;
  }
  cachedKeys = webpush.generateVAPIDKeys();
  writeFileSync(path, JSON.stringify(cachedKeys, null, 2), {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  });
  return cachedKeys;
}

export function configureWebPush() {
  const keys = getVapidKeys();
  webpush.setVapidDetails("mailto:local@anfang.invalid", keys.publicKey, keys.privateKey);
  return webpush;
}
