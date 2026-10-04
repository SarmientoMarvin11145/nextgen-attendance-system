self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text() || "You have a new attendance notification." };
  }

  event.waitUntil(self.registration.showNotification(payload.title || "Attendance System", {
    body: payload.body || "You have a new attendance notification.",
    tag: payload.tag || "attendance-notification",
    icon: "/icon.svg",
    data: { url: payload.url || "/notifications" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/notifications", self.location.origin).href;

  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    const existingClient = clients.find((client) => new URL(client.url).origin === self.location.origin);
    if (existingClient) {
      return existingClient.navigate(targetUrl).then(() => existingClient.focus());
    }
    return self.clients.openWindow(targetUrl);
  }));
});