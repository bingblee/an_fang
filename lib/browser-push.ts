export type NotificationState = "enabled" | "disabled" | "unsupported";

function publicKeyBytes(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const raw = window.atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

export async function synchronizePushSubscription(requestPermission = false): Promise<NotificationState> {
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return "unsupported";
  }
  const permission = requestPermission ? await Notification.requestPermission() : Notification.permission;
  if (permission !== "granted") return "disabled";

  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const keyResponse = await fetch("/api/push/public-key", { cache: "no-store" });
  if (!keyResponse.ok) throw new Error("无法读取提醒配置");
  const { publicKey } = await keyResponse.json() as { publicKey: string };
  const key = publicKeyBytes(publicKey);
  let subscription = await registration.pushManager.getSubscription();
  const previousKey = subscription?.options.applicationServerKey;
  if (subscription && previousKey) {
    const bytes = new Uint8Array(previousKey);
    if (bytes.length !== key.length || bytes.some((value, index) => value !== key[index])) {
      await subscription.unsubscribe();
      subscription = null;
    }
  }
  subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });

  // Browser permission alone says nothing about the current server session's binding.
  const response = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON())
  });
  if (!response.ok) throw new Error("提醒订阅保存失败");
  return "enabled";
}
