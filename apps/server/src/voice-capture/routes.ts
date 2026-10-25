import type { IncomingMessage, ServerResponse } from "node:http";
import { readBody } from "../request-body";
import type { Config } from "../config";
import { llmConfigured } from "../config";
import type { CalendarWorkspace } from "../calendar/workspace";
import { OWNER_ACTION_FORBIDDEN } from "../owner-auth";
import { ValidationError } from "../settings";
import { commitQuickAddItems } from "../quick-add/commit";
import { QUICK_ADD_COMMIT_OWNER_REQUIRED, QUICK_ADD_LLM_NOT_CONFIGURED, QUICK_ADD_TODOIST_NOT_CONFIGURED } from "../quick-add/errors";
import { parseQuickAddText } from "../quick-add/parse";
import { parseQuickAddPayload } from "../quick-add/normalize";
import { todoistConfigured } from "../config";
import type { VoiceCaptureStore } from "./store";
import { parseAudioRequestBody } from "./parse-body";
import {
  VOICE_CAPTURE_LLM_NOT_CONFIGURED,
  VOICE_CAPTURE_NOT_FOUND,
  VOICE_CAPTURE_PARSE_FAILED,
  VOICE_CAPTURE_TRANSCRIPTION_UNAVAILABLE,
  VOICE_CAPTURE_UNAUTHORIZED,
} from "./errors";
import { createTranscriber, transcriptionConfigured, TranscriptionNotConfiguredError, type Transcriber } from "./transcribe";

export async function handleVoiceCaptureIngest(
  cfg: Config,
  store: VoiceCaptureStore,
  req: IncomingMessage,
  res: ServerResponse,
  transcriber?: Transcriber,
): Promise<void> {
  const json = (status: number, data: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(data));
  };
  if (req.method !== "POST") {
    json(405, { error: "Method not allowed" });
    return;
  }
  if (!transcriptionConfigured(cfg)) {
    json(503, { error: VOICE_CAPTURE_TRANSCRIPTION_UNAVAILABLE });
    return;
  }
  if (!llmConfigured(cfg)) {
    json(503, { error: VOICE_CAPTURE_LLM_NOT_CONFIGURED });
    return;
  }
  try {
    const { audio, mime } = await parseAudioRequestBody(req);
    const transcribe = transcriber ?? createTranscriber(cfg);
    const transcript = await transcribe(audio, mime);
    const items = await parseQuickAddText(cfg, transcript);
    const record = await store.create(transcript, items);
    json(201, { id: record.id, transcript: record.transcript, items: record.items });
  } catch (err) {
    if (err instanceof ValidationError) {
      json(400, { error: err.message });
      return;
    }
    if (err instanceof TranscriptionNotConfiguredError) {
      json(503, { error: VOICE_CAPTURE_TRANSCRIPTION_UNAVAILABLE });
      return;
    }
    if (err instanceof Error && err.message === VOICE_CAPTURE_PARSE_FAILED) {
      json(502, { error: VOICE_CAPTURE_PARSE_FAILED });
      return;
    }
    if (err instanceof Error && (err.message.includes("Transcription") || err.name === "TimeoutError")) {
      json(502, { error: "Transcription failed" });
      return;
    }
    json(502, { error: VOICE_CAPTURE_PARSE_FAILED });
  }
}

export function voiceCaptureUnauthorized(res: ServerResponse): void {
  res.writeHead(401, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify({ error: VOICE_CAPTURE_UNAUTHORIZED }));
}

export async function handleVoiceCaptureOwnerRoutes(
  cfg: Config,
  calendar: CalendarWorkspace | undefined,
  store: VoiceCaptureStore,
  canManage: boolean,
  owner: boolean,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  readJsonBody: (req: IncomingMessage) => Promise<unknown> = (r) => readBody(r, 64_000),
): Promise<boolean> {
  if (!path.startsWith("/api/voice-captures")) return false;
  const json = (status: number, data: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(data));
    return true;
  };
  if (!canManage) return json(403, { error: OWNER_ACTION_FORBIDDEN });

  if (path === "/api/voice-captures" && req.method === "GET") {
    await store.purgeExpired();
    return json(200, { captures: store.listSummaries(), count: store.pendingCount() });
  }

  const confirmMatch = path.match(/^\/api\/voice-captures\/([^/]+)\/confirm$/);
  if (confirmMatch && req.method === "POST") {
    if (!owner) return json(403, { error: QUICK_ADD_COMMIT_OWNER_REQUIRED });
    const id = decodeURIComponent(confirmMatch[1]!);
    const record = store.get(id);
    if (!record) return json(404, { error: VOICE_CAPTURE_NOT_FOUND });
    try {
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const rawItems = Array.isArray(body.items) ? body.items : record.items;
      const parsedItems = parseQuickAddPayload({ items: rawItems });
      if (parsedItems.some((item) => item.kind === "task") && !todoistConfigured(cfg)) {
        return json(503, { error: QUICK_ADD_TODOIST_NOT_CONFIGURED });
      }
      const { results, failures } = await commitQuickAddItems(cfg, calendar, rawItems, {});
      await store.remove(id);
      return json(200, { results, failures });
    } catch (err) {
      if (err instanceof ValidationError) return json(400, { error: err.message });
      return json(500, { error: "Voice capture confirm failed" });
    }
  }

  const dismissMatch = path.match(/^\/api\/voice-captures\/([^/]+)$/);
  if (dismissMatch && req.method === "DELETE") {
    const id = decodeURIComponent(dismissMatch[1]!);
    const removed = await store.remove(id);
    if (!removed) return json(404, { error: VOICE_CAPTURE_NOT_FOUND });
    return json(200, { ok: true });
  }

  const detailMatch = path.match(/^\/api\/voice-captures\/([^/]+)$/);
  if (detailMatch && req.method === "GET") {
    const id = decodeURIComponent(detailMatch[1]!);
    const record = store.get(id);
    if (!record) return json(404, { error: VOICE_CAPTURE_NOT_FOUND });
    return json(200, {
      id: record.id,
      createdAt: record.createdAt,
      transcript: record.transcript,
      items: record.items,
    });
  }

  return json(405, { error: "Method not allowed" });
}
