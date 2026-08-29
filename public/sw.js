self.addEventListener("push", (event) => {
  let payload = {
    title: "安放提醒",
    body: "有一件事到了适合处理的时候。",
    url: "/"
  };
  try {
    payload = { ...payload, ...event.data.json() };
  } catch {
    // 保留默认提醒内容。
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: { url: payload.url || "/", itemId: payload.itemId || null },
      badge: "/icon-192.png",
      icon: "/icon-192.png",
      tag: payload.itemId ? `item-${payload.itemId}` : "anfang-reminder",
      renotify: false
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url.startsWith(self.location.origin));
      if (existing) {
        existing.navigate(target);
        return existing.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});
