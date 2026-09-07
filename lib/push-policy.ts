import { z } from "zod";

const pushHosts = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com"
]);

export function isTrustedPushEndpoint(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.port && !url.username && !url.password && !url.hash &&
      (pushHosts.has(url.hostname) || url.hostname.endsWith(".notify.windows.com"));
  } catch {
    return false;
  }
}

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(4096).refine(isTrustedPushEndpoint).transform((value) => new URL(value).href),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}=?$/).refine((value) => {
      const key = Buffer.from(value, "base64url");
      return key.length === 65 && key[0] === 4;
    }),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}(?:==)?$/)
  })
});
