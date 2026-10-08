// Open Counter service worker: shows the owner a notification for each new booking, and opens the dashboard on tap.
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(d.title || "New booking", {
    body: d.body || "", tag: d.tag, icon: "/addon/icon-192.png", badge: "/addon/icon-72.png", data: { url: d.url || "/?s=owner" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/?s=owner", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
    for (const w of wins) if (w.url.startsWith(self.location.origin) && "focus" in w) { w.navigate(url); return w.focus(); }
    return self.clients.openWindow(url);
  }));
});
