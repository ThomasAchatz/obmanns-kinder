/* Service Worker für Obmanns Kinder: Offline-Cache, Updates und Push. */
const CACHE = "ok-v8";
const SCOPE = self.registration.scope; // z. B. https://name.github.io/obmanns-kinder/

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll([SCOPE, SCOPE + "manifest.webmanifest"]).catch(() => {})));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// Die App meldet „Jetzt aktualisieren“ → neue Version sofort übernehmen
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase, Fonts usw. nicht anfassen

  // Seitenaufrufe: erst Netz, offline aus dem Cache
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(SCOPE, copy));
          return res;
        })
        .catch(() => caches.match(SCOPE)),
    );
    return;
  }

  // Gebaute Dateien haben Hash-Namen → dürfen dauerhaft aus dem Cache kommen
  if (url.pathname.includes("/assets/") || url.pathname.includes("/icons/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});

self.addEventListener("push", (event) => {
  let data = { title: "Obmanns Kinder", body: "", url: "/" };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: SCOPE + "icons/icon-192.png",
      badge: SCOPE + "icons/badge-96.png",
      data: { url: data.url },
      tag: data.url,
      renotify: true,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.url) || "/";
  // "/#/spiel/12" → relativ zum Scope der App
  const target = new URL(path.replace(/^\//, ""), SCOPE).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.startsWith(SCOPE)) {
          w.focus();
          return w.navigate(target);
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
