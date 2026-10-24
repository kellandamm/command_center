import type { IncomingMessage } from "node:http";
import type { CfAccessJwtVerifier } from "../cf-access";
import { accessJwtFromRequest, cfAccessConfigured, createCfAccessRemoteJwtVerifier } from "../cf-access";
import type { Config } from "../config";
import { queueHmacVerify, QUEUE_HMAC_WINDOW_SEC } from "./hmac";
import type { QueueNonceStore } from "./nonce-store";

export type QueueAuthRole = "producer" | "worker";

export type QueueAuthResult =
  | { ok: true; role: QueueAuthRole }
  | { ok: false; status: 401 | 403 | 404; reason: string };

let integrationJwtVerifier: CfAccessJwtVerifier | null | undefined;

export function setQueueCfAccessVerifier(verifier: CfAccessJwtVerifier | null | undefined): void {
  integrationJwtVerifier = verifier;
}

function resolveVerifier(cfg: Config): CfAccessJwtVerifier | null {
  if (integrationJwtVerifier !== undefined) return integrationJwtVerifier;
  return createCfAccessRemoteJwtVerifier(cfg);
}

function headerOne(req: IncomingMessage, name: string): string {
  const raw = req.headers[name.toLowerCase()];
  return (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
}

export function queueKeyForRole(cfg: Config, role: QueueAuthRole): string | null {
  const key = role === "producer" ? cfg.queueHmacKeyProducer : cfg.queueHmacKeyWorker;
  return key && key.length >= 32 ? key : null;
}

export function queueRoleConfigured(cfg: Config, role: QueueAuthRole): boolean {
  return queueKeyForRole(cfg, role) !== null;
}

export async function authenticateQueueRequest(
  cfg: Config,
  req: IncomingMessage,
  role: QueueAuthRole,
  rawBody: string,
  nonces: QueueNonceStore,
): Promise<QueueAuthResult> {
  const key = queueKeyForRole(cfg, role);
  if (!key) return { ok: false, status: 404, reason: "queue endpoint not configured" };

  if (!cfAccessConfigured(cfg)) {
    return { ok: false, status: 403, reason: "CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are required for the agent queue" };
  }

  const token = accessJwtFromRequest(req.headers);
  if (!token) return { ok: false, status: 403, reason: "Cf-Access-Jwt-Assertion required" };

  const verify = resolveVerifier(cfg);
  if (!verify) return { ok: false, status: 403, reason: "Cloudflare Access JWT verification is not configured" };

  try {
    await verify(token);
  } catch {
    return { ok: false, status: 403, reason: "Invalid or expired Cloudflare Access JWT" };
  }

  const tsRaw = headerOne(req, "x-queue-timestamp");
  const nonce = headerOne(req, "x-queue-nonce");
  const sig = headerOne(req, "x-queue-signature");
  if (!tsRaw || !nonce || !sig) {
    return { ok: false, status: 401, reason: "X-Queue-Timestamp, X-Queue-Nonce, and X-Queue-Signature required" };
  }

  const ts = Number(tsRaw);
  if (!Number.isFinite(ts)) return { ok: false, status: 401, reason: "invalid timestamp" };
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > QUEUE_HMAC_WINDOW_SEC) {
    return { ok: false, status: 401, reason: "timestamp outside allowed window" };
  }

  if (!queueHmacVerify(key, tsRaw, nonce, rawBody, sig)) {
    return { ok: false, status: 401, reason: "invalid signature" };
  }

  if (!nonces.remember(nonce)) return { ok: false, status: 401, reason: "nonce already used" };

  return { ok: true, role };
}
