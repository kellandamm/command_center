import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function assetsRoot(): string {
  const besideBundle = join(fileURLToPath(new URL(".", import.meta.url)), "excalidraw-assets");
  if (existsSync(besideBundle)) return besideBundle;
  return fileURLToPath(new URL("../../dist/excalidraw-assets", import.meta.url));
}

export function excalidrawAssetPath(relative: string): string | null {
  const root = assetsRoot();
  const safe = normalize(relative).replace(/^(\.\.(\/|\\|$))+/, "");
  const full = join(root, safe);
  if (!full.startsWith(root + sep) && full !== root) return null;
  if (!existsSync(full)) return null;
  return full;
}

export function excalidrawAssetContentType(relative: string): string {
  const ext = relative.slice(relative.lastIndexOf(".")).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}

export async function readExcalidrawAsset(relative: string): Promise<Buffer | null> {
  const full = excalidrawAssetPath(relative);
  if (!full) return null;
  return readFile(full);
}

export function streamExcalidrawAsset(relative: string) {
  const full = excalidrawAssetPath(relative);
  if (!full) return null;
  return createReadStream(full);
}
