/** Path prefixes that must never be cached by the service worker (network-only / bypass). */
export const SERVICE_WORKER_BYPASS_PREFIXES = ["/api/", "/budget/"] as const;

/** Exact paths that bypass the service worker cache handler. */
export const SERVICE_WORKER_BYPASS_EXACT = ["/extension.zip", "/budget"] as const;

/** JS expression used inside the shipped service worker fetch listener (single source of truth). */
export function serviceWorkerFetchBypassConditionJs(): string {
  const parts = [
    'req.method !== "GET"',
    "url.origin !== location.origin",
    ...SERVICE_WORKER_BYPASS_PREFIXES.map((p) => `url.pathname.startsWith(${JSON.stringify(p)})`),
    ...SERVICE_WORKER_BYPASS_EXACT.map((p) => `url.pathname === ${JSON.stringify(p)}`),
  ];
  return parts.join(" || ");
}

export function buildServiceWorkerSource(): string {
  const bypass = serviceWorkerFetchBypassConditionJs();
  return `
const CACHE = "ah-v1";
self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (${bypass}) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || new Response("Offline", { status: 503 })))
  );
});
`;
}

/** Mirrors the shipped service worker fetch early-return guard. */
export function serviceWorkerBypassesFetch(method: string, pathname: string): boolean {
  if (method !== "GET") return true;
  for (const p of SERVICE_WORKER_BYPASS_PREFIXES) {
    if (pathname.startsWith(p)) return true;
  }
  for (const p of SERVICE_WORKER_BYPASS_EXACT) {
    if (pathname === p) return true;
  }
  return false;
}
