import { ValidationError } from "../settings";

export interface TranscriptSegment {
  speaker?: string;
  startSec?: number;
  text: string;
}

export function parseTranscriptInput(transcript: unknown): { text: string; segments?: TranscriptSegment[] } {
  if (typeof transcript === "string") {
    const text = transcript.trim();
    if (!text) throw new ValidationError("transcript is required");
    return { text };
  }
  if (!Array.isArray(transcript)) throw new ValidationError("transcript must be text or segments");
  const segments: TranscriptSegment[] = [];
  for (const item of transcript) {
    if (!item || typeof item !== "object") throw new ValidationError("transcript segment must be an object");
    const row = item as Record<string, unknown>;
    if (typeof row.text !== "string" || !row.text.trim()) throw new ValidationError("transcript segment text is required");
    const segment: TranscriptSegment = { text: row.text.trim() };
    if (row.speaker !== undefined) {
      if (typeof row.speaker !== "string") throw new ValidationError("speaker must be text");
      segment.speaker = row.speaker.trim();
    }
    if (row.startSec !== undefined) {
      if (typeof row.startSec !== "number" || !Number.isFinite(row.startSec) || row.startSec < 0) {
        throw new ValidationError("startSec must be a non-negative number");
      }
      segment.startSec = row.startSec;
    }
    segments.push(segment);
  }
  if (!segments.length) throw new ValidationError("transcript is required");
  const text = segments.map((segment) => segment.text).join("\n");
  return { text, segments };
}

function formatTimestamp(sec: number): string {
  const total = Math.floor(sec);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatTranscriptBody(
  recordedAt: string,
  durationSec: number | undefined,
  participants: string[] | undefined,
  text: string,
  segments?: TranscriptSegment[],
): string {
  const meta: string[] = [`**Recorded:** ${recordedAt}`];
  if (durationSec !== undefined) meta.push(`**Duration:** ${Math.round(durationSec)}s`);
  if (participants?.length) meta.push(`**Participants:** ${participants.join(", ")}`);
  const lines: string[] = [...meta, ""];
  if (segments?.length) {
    for (const segment of segments) {
      const label = [
        segment.speaker ? `**${segment.speaker}**` : null,
        segment.startSec !== undefined ? `(${formatTimestamp(segment.startSec)})` : null,
      ].filter(Boolean).join(" ");
      lines.push(label || "—", segment.text, "");
    }
  } else {
    lines.push(text);
  }
  return lines.join("\n").trimEnd();
}
