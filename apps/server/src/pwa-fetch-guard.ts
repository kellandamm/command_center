/** Mirrors the service worker fetch early-return guard in `pwa.ts` (do not cache these). */
export function serviceWorkerBypassesFetch(method: string, pathname: string): boolean {
  if (method !== "GET") return true;
  if (pathname.startsWith("/api/")) return true;
  if (pathname === "/extension.zip") return true;
  if (pathname === "/budget" || pathname.startsWith("/budget/")) return true;
  return false;
}
