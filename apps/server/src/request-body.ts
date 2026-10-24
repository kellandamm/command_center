import type { IncomingMessage } from "node:http";
import { ValidationError } from "./settings";

/** Extra bytes read after the limit before giving up on draining the socket. */
const OVER_LIMIT_DRAIN_CAP = 10 * 1024 * 1024;

export async function readRawBody(req: IncomingMessage, limit = 200_000): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let kept = 0;
  let overLimit = false;
  let drained = 0;
  for await (const c of req) {
    const buf = Buffer.isBuffer(c) ? c : Buffer.from(c);
    if (!overLimit) {
      if (kept + buf.length > limit) {
        overLimit = true;
        drained += buf.length;
      } else {
        chunks.push(buf);
        kept += buf.length;
      }
    } else {
      drained += buf.length;
      if (drained > OVER_LIMIT_DRAIN_CAP) {
        req.destroy();
        throw new ValidationError("request body too large");
      }
    }
  }
  if (overLimit) throw new ValidationError("request body too large");
  return Buffer.concat(chunks);
}

export async function readJsonObjectBody(req: IncomingMessage, limit = 200_000): Promise<Record<string, unknown>> {
  const raw = await readRawBody(req, limit);
  if (!raw.length) return {};
  try {
    const parsed = JSON.parse(raw.toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("body must be an object");
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof SyntaxError) throw new ValidationError("invalid JSON");
    throw new ValidationError(err instanceof Error ? err.message : "invalid request");
  }
}

export async function readBody(req: IncomingMessage, limit = 200_000): Promise<unknown> {
  const raw = await readRawBody(req, limit);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new ValidationError("invalid JSON");
  }
}
