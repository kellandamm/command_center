import { BlockList, isIP } from "node:net";
import { lookup } from "node:dns/promises";

/**
 * The server fetches URLs a model and a settings page choose, from inside the
 * user's network. Everything that is not a public internet address is refused.
 */
const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32]] as const) {
  blocked.addSubnet(net, bits, "ipv6");
}

export function isPublicIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 0) return false;
  if (kind === 6) {
    const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicIp(mapped[1]!);
    const hexMapped = ip.toLowerCase().match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMapped) {
      const hi = parseInt(hexMapped[1]!, 16), lo = parseInt(hexMapped[2]!, 16);
      return isPublicIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return !blocked.check(ip, "ipv6");
  }
  return !blocked.check(ip, "ipv4");
}

export class BlockedUrlError extends Error {}

/** Throws unless `url` is http(s) and every address its host resolves to is public. */
export async function assertPublicUrl(
  url: string,
  resolve: (host: string) => Promise<string[]> = async (h) => (await lookup(h, { all: true })).map((r) => r.address),
): Promise<URL> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new BlockedUrlError("not a valid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new BlockedUrlError("only http(s) URLs are allowed");
  if (u.username || u.password) throw new BlockedUrlError("URLs with credentials are not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (!isPublicIp(host)) throw new BlockedUrlError("address is not public");
    return u;
  }
  if (!host.includes(".") || /\.(local|localhost|internal|lan|home\.arpa)$/i.test(host)) throw new BlockedUrlError("host is not public");
  let addrs: string[];
  try {
    addrs = await resolve(host);
  } catch {
    throw new BlockedUrlError("host did not resolve");
  }
  if (!addrs.length || !addrs.every(isPublicIp)) throw new BlockedUrlError("host resolves to a non-public address");
  return u;
}

/**
 * fetch() with SSRF checks on the first request and on every redirect hop, a
 * timeout and a response-size cap. Residual risk: DNS can change between this
 * check and the connection (rebinding); run the container without access to
 * your LAN if that matters to you.
 */
export async function safeFetch(
  url: string,
  opts: {
    headers?: Record<string, string>;
    timeoutMs?: number;
    maxBytes?: number;
    maxRedirects?: number;
    method?: string;
    body?: string;
  } = {},
): Promise<{ finalUrl: string; status: number; contentType: string; body: string }> {
  const maxBytes = opts.maxBytes ?? 3_000_000;
  let current = url;
  for (let hop = 0; hop <= (opts.maxRedirects ?? 5); hop++) {
    await assertPublicUrl(current);
    const res = await fetch(current, {
      method: opts.method ?? "GET",
      body: opts.body,
      redirect: "manual",
      headers: { "user-agent": "ai-homepage-server/1.0 (+self-hosted)", accept: "*/*", ...opts.headers },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, current).href;
      await res.body?.cancel();
      continue;
    }
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    return {
      finalUrl: current,
      status: res.status,
      contentType: res.headers.get("content-type") ?? "",
      body: Buffer.concat(chunks).toString("utf8"),
    };
  }
  throw new BlockedUrlError("too many redirects");
}
