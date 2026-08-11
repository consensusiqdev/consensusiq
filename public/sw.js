// Deliberately does no caching. This site's whole value is live SEC filing data (new insider
// trades every 5 minutes) — caching API responses or pages would risk showing stale trades as
// current ones, actively misleading for a financial-data tool. This service worker exists purely
// to satisfy Chrome's installability requirement for "Add to Home Screen" (a registered SW with a
// fetch handler); every request just passes straight through to the network.
self.addEventListener("fetch", () => {});
