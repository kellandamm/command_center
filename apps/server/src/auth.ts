import type { IncomingMessage } from "node:http";
import { timingSafeEqual, createHash } from "node:crypto";
import type { Config } from "./config";
import { accessJwtFromRequest, createCfAccessRemoteJwtVerifier } from "./cf-access";

export type AuthResult = { ok: true; who: string; setCookie?: string } | { ok: false; status: 401 | 403; reason: string };

const sha = (s: string) => createHash("sha256").update(s).digest();
export const tokenEquals = (a: string, b: string) => timingSafeEqual(sha(a), sha(b));

function cookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export type Authenticator = (req: IncomingMessage, url: URL) => Promise<AuthResult>;

export function bearerToken(req: IncomingMessage): string | undefined {
  return req.headers.authorization?.match(/^Bearer[ \t]+(\S+)$/i)?.[1];
}

export function makeAuthenticator(cfg: Config, verifyJwt?: (token: string) => Promise<string>): Authenticator {
  let verify = verifyJwt;
  if (!verify) {
    const remote = createCfAccessRemoteJwtVerifier(cfg);
    if (remote) {
      verify = async (token) => {
        const payload = await remote(token);
        return String(payload.email ?? payload.sub ?? "access-user");
      };
    }
  }

  return async (req, url) => {
    if (cfg.allowInsecureNoAuth && !verify && !cfg.adminToken) return { ok: true, who: "anonymous" };

    if (verify) {
      const token = accessJwtFromRequest(req.headers) ?? cookie(req, "CF_Authorization");
      if (token) {
        try {
          return { ok: true, who: await verify(token) };
        } catch {
          // fall through: a bad Access token may still be accompanied by a valid admin token
        }
      }
    }

    if (cfg.adminToken) {
      const header = bearerToken(req);
      const queryToken = url.searchParams.get("token");
      const presented = header ?? queryToken ?? cookie(req, "ah_token");
      if (presented && tokenEquals(presented, cfg.adminToken)) {
        // Remember a ?token= login in an HttpOnly cookie so the PWA keeps working.
        const setCookie =
          !header && queryToken
            ? `ah_token=${encodeURIComponent(cfg.adminToken)}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=2592000`
            : undefined;
        return { ok: true, who: "admin-token", setCookie };
      }
    }

    return { ok: false, status: 401, reason: verify ? "Cloudflare Access login required" : "Admin token required" };
  };
}

/** State-changing requests must come from this origin and carry our header (browsers can't forge it cross-site without a preflight). */
export function csrfOk(req: IncomingMessage): boolean {
  const method = req.method ?? "GET";
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  if (req.headers["x-ah"] !== "1") return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) return false;
    } catch {
      return false;
    }
  }
  return true;
}
