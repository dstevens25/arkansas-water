// Service worker: makes the app open and show its last data with no signal.
const SHELL = "wc-shell-v1";
const DATA  = "wc-data-v1";
const SHELL_FILES = ["./", "./index.html", "./logo.png", "./icon-192.png", "./manifest.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== DATA).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);

  // Never cache map tiles or the Windy frame — huge, and useless when stale.
  if(/tile\.openstreetmap|mesonet\.agron|embed\.windy/.test(url.href)) return;

  // Live data: try the network, fall back to the last good copy.
  const isData = /raw\.githubusercontent|waterservices\.usgs|api\.weather\.gov/.test(url.href);
  if(isData){
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(DATA).then(c => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // App itself: serve from cache first so it opens instantly with no signal.
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(SHELL).then(c => c.put(req, copy));
      return res;
    }))
  );
});
