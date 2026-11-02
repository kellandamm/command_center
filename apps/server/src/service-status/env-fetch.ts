import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockedUrlError } from "../ssrf";

function normalizeBase(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Fetch a URL that must match the configured env base (allows LAN/loopback). No redirects off-origin. */
export async function fetchEnvConfiguredUrl(
  configuredBase: string,
  pathSuffix: string,
  opts: {
    headers?: Record<string, string>;
    timeoutMs?: number;
    maxBytes?: number;
  } = {},
): Promise<{ status: number; body: string }> {
  const base = normalizeBase(configuredBase);
  const target = `${base}${pathSuffix.startsWith("/") ? pathSuffix : `/${pathSuffix}`}`;
  let current: URL;
  try {
    current = new URL(target);
  } catch {
    throw new BlockedUrlError("invalid env URL");
  }
  if (current.protocol !== "http:" && current.protocol !== "https:") throw new BlockedUrlError("invalid protocol");
  if (current.username || current.password) throw new BlockedUrlError("credentials in URL");

  const allowedOrigin = new URL(base).origin;
  const timeoutMs = opts.timeoutMs ?? 3000;
  const maxBytes = opts.maxBytes ?? 4096;

  for (let hop = 0; hop <= 3; hop++) {
    if (current.origin !== allowedOrigin) throw new BlockedUrlError("redirect off origin");
    const res = await nodeFetch(current, { headers: opts.headers, timeoutMs, maxBytes });
    if (res.status >= 300 && res.status < 400 && res.location) {
      current = new URL(res.location, current);
      continue;
    }
    return { status: res.status, body: res.body };
  }
  throw new BlockedUrlError("too many redirects");
}

function nodeFetch(
  url: URL,
  opts: { headers?: Record<string, string>; timeoutMs: number; maxBytes: number },
): Promise<{ status: number; body: string; location?: string }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = lib(
      url,
      { method: "GET", headers: { "user-agent": "stremmy-server/1.0", accept: "*/*", ...opts.headers } },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > opts.maxBytes) {
            req.destroy();
            reject(new BlockedUrlError("response too large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            location: res.headers.location,
          });
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(opts.timeoutMs, () => {
      req.destroy();
      reject(new BlockedUrlError("timeout"));
    });
    req.end();
  });
}
