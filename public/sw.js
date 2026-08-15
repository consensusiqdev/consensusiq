// Deliberately does no caching. This site's whole value is live SEC filing data (new insider
// trades every 5 minutes) — caching API responses or pages would risk showing stale trades as
// current ones, actively misleading for a financial-data tool. This service worker exists purely
// to satisfy Chrome's installability requirement for "Add to Home Screen" (a registered SW with a
// fetch handler); every request just passes straight through to the network.
self.addEventListener("fetch", () => {});

// Web Push: server sends { title, body, url } as the payload (see src/lib/push.ts). `url` is
// opened (or focused, if a tab already has it open) on click — carried via the notification's
// `data` since notificationclick fires as its own separate event with no access to the push
// event's payload.
self.addEventListener("push", (event) => {
  if (!event.data) return;
  const payload = event.data.json();
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: payload.url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const absoluteUrl = new URL(url, self.location.origin).href;
      const existing = clients.find((c) => c.url === absoluteUrl);
      if (existing) return existing.focus();
      return self.clients.openWindow(absoluteUrl);
    })
  );
});
