/** Max upload size (~25 MB). */
export const VOICE_CAPTURE_MAX_BYTES = 25 * 1024 * 1024;

/** Outbound transcription request timeout (10 minutes). */
export const VOICE_CAPTURE_TRANSCRIBE_TIMEOUT_MS = 10 * 60 * 1000;

/** Pending captures expire after 7 days. */
export const VOICE_CAPTURE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function normalizeAudioMime(raw: string | undefined): string | null {
  if (!raw) return null;
  const base = raw.split(";")[0]?.trim().toLowerCase() ?? "";
  if (base === "audio/mp4" || base === "audio/m4a" || base === "audio/x-m4a") return base;
  return null;
}
