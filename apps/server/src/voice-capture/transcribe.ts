import type { Config } from "../config";
import { llmConfig, llmConfigured } from "../config";
import type { FetchLike } from "../llm/provider";
import { VOICE_CAPTURE_TRANSCRIPTION_FAILED, VOICE_CAPTURE_TRANSCRIPTION_UNAVAILABLE } from "./errors";
import { VOICE_CAPTURE_TRANSCRIBE_TIMEOUT_MS } from "./limits";

export interface TranscribeConfig {
  url: string;
  apiKey: string | null;
  model: string;
}

export function resolveTranscribeConfig(cfg: Config): TranscribeConfig | null {
  const explicit = cfg.transcribeUrl?.replace(/\/+$/, "");
  if (explicit) {
    return {
      url: explicit.endsWith("/audio/transcriptions") ? explicit : `${explicit}/audio/transcriptions`,
      apiKey: cfg.transcribeApiKey,
      model: cfg.transcribeModel,
    };
  }
  if (!llmConfigured(cfg)) return null;
  const llm = llmConfig(cfg)!;
  return {
    url: `${llm.baseUrl}/audio/transcriptions`,
    apiKey: cfg.transcribeApiKey ?? llm.apiKey,
    model: cfg.transcribeModel,
  };
}

export function transcriptionConfigured(cfg: Config): boolean {
  return resolveTranscribeConfig(cfg) !== null;
}

export type Transcriber = (audio: Buffer, mime: string) => Promise<string>;

export function createTranscriber(cfg: Config, fetchFn: FetchLike = fetch): Transcriber {
  const resolved = resolveTranscribeConfig(cfg);
  if (!resolved) {
    return async () => {
      throw new TranscriptionNotConfiguredError();
    };
  }
  return (audio, mime) => transcribeWithConfig(resolved, audio, mime, fetchFn);
}

export class TranscriptionNotConfiguredError extends Error {
  constructor() {
    super(VOICE_CAPTURE_TRANSCRIPTION_UNAVAILABLE);
    this.name = "TranscriptionNotConfiguredError";
  }
}

export async function transcribeWithConfig(
  tc: TranscribeConfig,
  audio: Buffer,
  mime: string,
  fetchFn: FetchLike = fetch,
): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from(audio)], { type: mime }), "capture.m4a");
  form.append("model", tc.model);
  const headers: Record<string, string> = {};
  if (tc.apiKey) headers.authorization = `Bearer ${tc.apiKey}`;
  const res = await fetchFn(tc.url, {
    method: "POST",
    headers,
    body: form,
    signal: AbortSignal.timeout(VOICE_CAPTURE_TRANSCRIBE_TIMEOUT_MS),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(VOICE_CAPTURE_TRANSCRIPTION_FAILED);
  let json: { text?: string };
  try {
    json = JSON.parse(body) as { text?: string };
  } catch {
    throw new Error(VOICE_CAPTURE_TRANSCRIPTION_FAILED);
  }
  const text = json.text?.trim();
  if (!text) throw new Error(VOICE_CAPTURE_TRANSCRIPTION_FAILED);
  return text;
}
