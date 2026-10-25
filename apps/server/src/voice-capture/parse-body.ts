import type { IncomingMessage } from "node:http";
import { readRawBody } from "../request-body";
import { ValidationError } from "../settings";
import { VOICE_CAPTURE_TOO_LARGE, VOICE_CAPTURE_UNSUPPORTED_TYPE } from "./errors";
import { VOICE_CAPTURE_MAX_BYTES, normalizeAudioMime } from "./limits";

export interface ParsedAudioBody {
  audio: Buffer;
  mime: string;
}

/** Reject unsupported types before reading the request body. */
export function assertAudioContentType(req: IncomingMessage): void {
  const rawType = req.headers["content-type"] ?? "";
  if (!rawType.trim()) throw new ValidationError(VOICE_CAPTURE_UNSUPPORTED_TYPE);
  const lower = rawType.toLowerCase();
  if (lower.includes("multipart/form-data")) {
    if (!/boundary=/i.test(rawType)) throw new ValidationError(VOICE_CAPTURE_UNSUPPORTED_TYPE);
    return;
  }
  if (!normalizeAudioMime(rawType)) throw new ValidationError(VOICE_CAPTURE_UNSUPPORTED_TYPE);
}

async function parseMultipartForm(buffer: Buffer, contentType: string): Promise<ParsedAudioBody> {
  const request = new Request("http://voice-capture.local/upload", {
    method: "POST",
    headers: { "content-type": contentType },
    body: Uint8Array.from(buffer),
  });
  const form = await request.formData();
  for (const value of form.values()) {
    if (!(value instanceof Blob) || value.size === 0) continue;
    const mime = normalizeAudioMime(value.type);
    if (!mime) continue;
    const audio = Buffer.from(await value.arrayBuffer());
    return { audio, mime };
  }
  throw new ValidationError(VOICE_CAPTURE_UNSUPPORTED_TYPE);
}

export async function parseAudioRequestBody(req: IncomingMessage): Promise<ParsedAudioBody> {
  assertAudioContentType(req);
  const rawType = req.headers["content-type"] ?? "";
  const lower = rawType.toLowerCase();
  const buffer = await readRawBody(req, VOICE_CAPTURE_MAX_BYTES).catch((err) => {
    if (err instanceof ValidationError && err.message === "request body too large") {
      throw new ValidationError(VOICE_CAPTURE_TOO_LARGE);
    }
    throw err;
  });
  if (!buffer.length) throw new ValidationError(VOICE_CAPTURE_UNSUPPORTED_TYPE);

  if (lower.includes("multipart/form-data")) {
    return parseMultipartForm(buffer, rawType);
  }

  const mime = normalizeAudioMime(rawType)!;
  return { audio: buffer, mime };
}
