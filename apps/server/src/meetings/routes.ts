import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../config";
import type { NotesStore } from "../notes/store";
import { ValidationError } from "../settings";
import { authenticateMeetingImport } from "./auth";
import { MEETING_IMPORT_MAX_BYTES } from "./constants";

const READ_BODY_MAX_BYTES = MEETING_IMPORT_MAX_BYTES + 64_000;
import { importMeetingTranscript, MeetingEditedLocallyError } from "./import-service";

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

async function readJson(req: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    body += chunk.toString();
    if (Buffer.byteLength(body, "utf8") > maxBytes) throw new ValidationError("payload too large");
  }
  try {
    const parsed = JSON.parse(body || "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof SyntaxError) throw new ValidationError("invalid JSON");
    throw new ValidationError("invalid JSON");
  }
}

export async function handleMeetingImportRoute(
  cfg: Config,
  notes: NotesStore,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    json(res, 405, { error: "method not allowed" });
    return;
  }
  const auth = await authenticateMeetingImport(cfg, req);
  if (!auth.ok) {
    json(res, auth.status, { error: "unauthorized" });
    return;
  }
  try {
    const body = await readJson(req, READ_BODY_MAX_BYTES);
    const result = await importMeetingTranscript(cfg, notes, body);
    json(res, result.created ? 201 : 200, {
      noteId: result.note.id,
      created: result.created,
      summaryStatus: result.summaryStatus,
    });
  } catch (err) {
    if (err instanceof MeetingEditedLocallyError) {
      json(res, 409, { error: "edited locally" });
      return;
    }
    if (err instanceof ValidationError) {
      json(res, 400, { error: err.message });
      return;
    }
    json(res, 500, { error: "import failed" });
  }
}
