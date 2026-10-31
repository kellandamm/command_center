import { deflateSync } from "node:zlib";

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A flat app icon: dark rounded square with a warm "sun" disc and a horizon. Generated, so no binary assets in the repo. */
export function iconPng(size: number, maskable = false): Buffer {
  const px = Buffer.alloc(size * (size * 4 + 1));
  const r = size * (maskable ? 0 : 0.2);
  const cx = size / 2, cy = size * 0.46, rad = size * 0.2;
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    px[row] = 0;
    for (let x = 0; x < size; x++) {
      const o = row + 1 + x * 4;
      // rounded-corner alpha
      const dx = Math.max(r - x, 0, x - (size - 1 - r)), dy = Math.max(r - y, 0, y - (size - 1 - r));
      const inside = r === 0 || dx * dx + dy * dy <= r * r;
      let rgb = [17, 20, 28];
      const d = Math.hypot(x - cx, y - cy);
      if (d <= rad) rgb = [255, 176, 66];
      else if (y > size * 0.64 && y < size * 0.68 && Math.abs(x - cx) < size * 0.3) rgb = [120, 130, 160];
      px[o] = rgb[0]!; px[o + 1] = rgb[1]!; px[o + 2] = rgb[2]!; px[o + 3] = inside ? 255 : 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(px)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

export const MANIFEST = JSON.stringify({
  name: "AI Homepage",
  short_name: "Homepage",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#11141c",
  theme_color: "#11141c",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
});

/** Network-first for pages (the latest edition matters), cache as the offline fallback. Never touches /api. */
/** Fetch bypass rules are mirrored in `pwa-fetch-guard.ts` (`serviceWorkerBypassesFetch`). Keep in sync. */
export const SERVICE_WORKER = `
const CACHE = "ah-v1";
self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname === "/extension.zip" || url.pathname === "/budget" || url.pathname.startsWith("/budget/")) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || new Response("Offline", { status: 503 })))
  );
});
`;
