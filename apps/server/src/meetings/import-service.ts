import type { Config } from "../config";
import { llmConfig } from "../config";
import type { FetchLike } from "../llm/provider";
import type { KnowledgeNote, NotesStore } from "../notes/store";
import { ValidationError } from "../settings";
import { buildMeetingNoteContent } from "./content";
import {
  MEETING_IMPORT_MAX_BYTES,
  MEETING_TAG,
  MEETINGS_SPACE_NAME,
  plaudSourceTag,
  SUMMARY_PENDING,
} from "./constants";
import { summarizeMeetingTranscript } from "./summarize";
import { formatTranscriptBody, parseTranscriptInput } from "./transcript";

export interface MeetingImportPayload {
  sourceId: string;
  title: string;
  recordedAt: string;
  durationSec?: number;
  participants?: string[];
  transcript: string | Array<{ speaker?: string; startSec?: number; text: string }>;
}

export interface MeetingImportResult {
  note: KnowledgeNote;
  created: boolean;
  summaryStatus: "ok" | "pending";
}

function validatePayload(raw: Record<string, unknown>): MeetingImportPayload {
  if (typeof raw.sourceId !== "string" || !raw.sourceId.trim()) throw new ValidationError("sourceId is required");
  if (typeof raw.title !== "string" || !raw.title.trim()) throw new ValidationError("title is required");
  if (typeof raw.recordedAt !== "string" || !Number.isFinite(Date.parse(raw.recordedAt))) {
    throw new ValidationError("recordedAt must be an ISO timestamp");
  }
  const recordedAt = new Date(raw.recordedAt).toISOString();
  if (recordedAt !== raw.recordedAt.trim()) throw new ValidationError("recordedAt must be an ISO timestamp");

  let durationSec: number | undefined;
  if (raw.durationSec !== undefined) {
    if (typeof raw.durationSec !== "number" || !Number.isFinite(raw.durationSec) || raw.durationSec < 0) {
      throw new ValidationError("durationSec must be a non-negative number");
    }
    durationSec = raw.durationSec;
  }

  let participants: string[] | undefined;
  if (raw.participants !== undefined) {
    if (!Array.isArray(raw.participants) || raw.participants.some((p) => typeof p !== "string")) {
      throw new ValidationError("participants must be a list of text");
    }
    participants = raw.participants.map((p) => p.trim()).filter(Boolean).slice(0, 50);
  }

  const { text, segments } = parseTranscriptInput(raw.transcript);
  if (Buffer.byteLength(text, "utf8") > MEETING_IMPORT_MAX_BYTES) throw new ValidationError("transcript too large");

  const sizeCheck = JSON.stringify({ ...raw, transcript: text });
  if (Buffer.byteLength(sizeCheck, "utf8") > MEETING_IMPORT_MAX_BYTES) throw new ValidationError("payload too large");

  return {
    sourceId: raw.sourceId.trim(),
    title: raw.title.trim().slice(0, 240),
    recordedAt,
    durationSec,
    participants,
    transcript: segments ?? text,
  };
}

export function findMeetingNoteBySourceId(notes: NotesStore, sourceId: string): KnowledgeNote | undefined {
  const tag = plaudSourceTag(sourceId);
  return notes.listNotes().find((note) => note.tags.includes(tag));
}

async function ensureMeetingsSpaceId(notes: NotesStore): Promise<string> {
  const existing = notes.listSpaces().find((space) => space.name === MEETINGS_SPACE_NAME);
  if (existing) return existing.id;
  const space = await notes.createSpace({
    name: MEETINGS_SPACE_NAME,
    description: "Imported meeting transcripts",
  });
  return space.id;
}

function meetingTags(sourceId: string, extra: string[] = []): string[] {
  return [...new Set([MEETING_TAG, plaudSourceTag(sourceId), ...extra])];
}

export async function importMeetingTranscript(
  cfg: Config,
  notes: NotesStore,
  raw: Record<string, unknown>,
  options: { fetchFn?: FetchLike; skipSummary?: boolean } = {},
): Promise<MeetingImportResult> {
  const payload = validatePayload(raw);
  const parsed = parseTranscriptInput(payload.transcript);
  const transcriptBlock = formatTranscriptBody(
    payload.recordedAt,
    payload.durationSec,
    payload.participants,
    parsed.text,
    parsed.segments,
  );

  let summary = SUMMARY_PENDING;
  let summaryStatus: "ok" | "pending" = "pending";
  const llm = llmConfig(cfg);
  if (!options.skipSummary && llm) {
    try {
      summary = await summarizeMeetingTranscript(llm, parsed.text, options.fetchFn);
      summaryStatus = "ok";
    } catch {
      summary = SUMMARY_PENDING;
      summaryStatus = "pending";
    }
  }

  const content = buildMeetingNoteContent(summary, transcriptBlock);
  if (Buffer.byteLength(content, "utf8") > 200_000) throw new ValidationError("transcript too large");
  const spaceId = await ensureMeetingsSpaceId(notes);
  const existing = findMeetingNoteBySourceId(notes, payload.sourceId);

  if (existing) {
    const note = await notes.updateNote(existing.id, {
      title: payload.title,
      content,
      tags: meetingTags(payload.sourceId, existing.tags),
      spaceId,
      sensitive: true,
      expectedVersion: existing.version ?? 0,
    });
    if (!note) throw new ValidationError("note not found");
    return { note, created: false, summaryStatus };
  }

  const note = await notes.createNote({
    title: payload.title,
    content,
    tags: meetingTags(payload.sourceId),
    spaceId,
    sensitive: true,
  });
  return { note, created: true, summaryStatus };
}

export async function summarizeMeetingNote(
  cfg: Config,
  notes: NotesStore,
  noteId: string,
  fetchFn?: FetchLike,
): Promise<KnowledgeNote> {
  const note = notes.getNote(noteId);
  if (!note) throw new ValidationError("note not found");
  if (!note.tags.includes(MEETING_TAG)) throw new ValidationError("not a meeting note");

  const llm = llmConfig(cfg);
  if (!llm) throw new ValidationError("LLM is not configured");

  const transcriptIdx = note.content.indexOf("## Transcript");
  if (transcriptIdx < 0) throw new ValidationError("invalid meeting note");
  const transcriptBody = note.content.slice(transcriptIdx + "## Transcript".length).trim();

  let summary = SUMMARY_PENDING;
  try {
    summary = await summarizeMeetingTranscript(llm, transcriptBody, fetchFn);
  } catch {
    throw new ValidationError("summarization failed");
  }

  const content = buildMeetingNoteContent(summary, transcriptBody);
  const updated = await notes.updateNote(noteId, {
    content,
    expectedVersion: note.version ?? 0,
  });
  if (!updated) throw new ValidationError("note not found");
  return updated;
}
