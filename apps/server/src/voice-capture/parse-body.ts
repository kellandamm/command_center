import type { IncomingMessage } from "node:http";
import { readRawBody } from "../request-body";
import { ValidationError } from "../settings";
import { VOICE_CAPTURE_TOO_LARGE, VOICE_CAPTURE_UNSUPPORTED_TYPE } from "./errors";
import { VOICE_CAPTURE_MAX_BYTES, normalizeAudioMime } from "./limits";

export interface ParsedAudioBody {
  audio: Buffer;
  mime: string;
}

function parseMultipart(buffer: Buffer, contentType: string): ParsedAudioBody {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary) throw new ValidationError(VOICE_CAPTURE_UNSUPPORTED_TYPE);
  const delimiter = Buffer.from(`--${boundary}`);
  const parts = splitMultipart(buffer, delimiter);
  for (const part of parts) {
    if (!part.length) continue;
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;
    const headerText = part.subarray(0, headerEnd).toString("latin1");
    if (!/content-disposition:\s*form-data/i.test(headerText)) continue;
    const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText);
    const mime = normalizeAudioMime(typeMatch?.[1]?.trim());
    if (!mime) continue;
    let body = part.subarray(headerEnd + 4);
    if (body.subarray(-2).equals(Buffer.from("\r\n"))) body = body.subarray(0, -2);
    return { audio: body, mime };
  }
  throw new ValidationError(VOICE_CAPTURE_UNSUPPORTED_TYPE);
}

function splitMultipart(buffer: Buffer, delimiter: Buffer): Buffer[] {
  const out: Buffer[] = [];
  let start = 0;
  while (start < buffer.length) {
    const idx = buffer.indexOf(delimiter, start);
    if (idx < 0) break;
    if (idx > start) out.push(buffer.subarray(start, idx));
    start = idx + delimiter.length;
    if (buffer.subarray(start, start + 2).equals(Buffer.from("--"))) break;
    if (buffer.subarray(start, start + 2).equals(Buffer.from("\r\n"))) start += 2;
  }
  return out;
}

export async function parseAudioRequestBody(req: IncomingMessage): Promise<ParsedAudioBody> {
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
    return parseMultipart(buffer, rawType);
  }

  const mime = normalizeAudioMime(rawType);
  if (!mime) throw new ValidationError(VOICE_CAPTURE_UNSUPPORTED_TYPE);
  return { audio: buffer, mime };
}
