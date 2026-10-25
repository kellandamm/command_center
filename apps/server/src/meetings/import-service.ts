import type { Config } from "../config";
import { llmConfig } from "../config";
import type { FetchLike } from "../llm/provider";
import type { KnowledgeNote, NotesStore } from "../notes/store";
import { NoteConflictError } from "../notes/store";
import { ValidationError } from "../settings";
import { buildMeetingNoteContent } from "./content";
import {
  MEETING_IMPORT_MAX_BYTES,
  MEETING_TAG,
  MEETINGS_SPACE_NAME,
  meetingImportLockKey,
  meetingImportVersionTag,
  NOTE_BODY_MAX_BYTES,
  parseMeetingImportVersion,
  plaudSourceIdFromTags,
  plaudSourceTag,
  SUMMARY_PENDING,
  TRANSCRIPT_SECTION,
} from "./constants";
import { withMeetingImportLock } from "./import-lock";
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

export class MeetingEditedLocallyError extends Error {
  constructor() {
    super("edited locally");
  }
}

function parseRecordedAt(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) throw new ValidationError("recordedAt is required");
  const ms = Date.parse(raw.trim());
  if (!Number.isFinite(ms)) throw new ValidationError("invalid recordedAt");
  return new Date(ms).toISOString();
}

function validatePayload(raw: Record<string, unknown>): MeetingImportPayload {
  if (typeof raw.sourceId !== "string" || !raw.sourceId.trim()) throw new ValidationError("sourceId is required");
  if (typeof raw.title !== "string" || !raw.title.trim()) throw new ValidationError("title is required");
  const recordedAt = parseRecordedAt(raw.recordedAt);

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

function meetingTags(sourceId: string, existing: string[] = [], importVersion?: number): string[] {
  const base = existing.filter((tag) => !tag.startsWith("meeting-import-ver:"));
  const tags = [...new Set([MEETING_TAG, plaudSourceTag(sourceId), ...base])];
  if (importVersion !== undefined) tags.push(meetingImportVersionTag(importVersion));
  return tags;
}

function noteEditedSinceImport(note: KnowledgeNote): boolean {
  const importedVersion = parseMeetingImportVersion(note.tags);
  if (importedVersion === null) return false;
  return (note.version ?? 0) > importedVersion;
}

function assertNoteBodyFits(transcriptBlock: string): void {
  const pending = buildMeetingNoteContent(SUMMARY_PENDING, transcriptBlock);
  if (Buffer.byteLength(pending, "utf8") > NOTE_BODY_MAX_BYTES) {
    throw new ValidationError("note too large");
  }
}

async function persistImport(
  cfg: Config,
  notes: NotesStore,
  payload: MeetingImportPayload,
  options: { fetchFn?: FetchLike; skipSummary?: boolean },
): Promise<MeetingImportResult> {
  const parsed = parseTranscriptInput(payload.transcript);
  const transcriptBlock = formatTranscriptBody(
    payload.recordedAt,
    payload.durationSec,
    payload.participants,
    parsed.text,
    parsed.segments,
  );
  assertNoteBodyFits(transcriptBlock);

  let summary = SUMMARY_PENDING;
  let summaryStatus: "ok" | "pending" = "pending";
  const llm = llmConfig(cfg);
  if (!options.skipSummary && llm) {
    try {
      summary = await summarizeMeetingTranscript(llm, parsed.text, options.fetchFn);
      summaryStatus = "ok";
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      summary = SUMMARY_PENDING;
      summaryStatus = "pending";
    }
  }

  const content = buildMeetingNoteContent(summary, transcriptBlock);
  if (Buffer.byteLength(content, "utf8") > NOTE_BODY_MAX_BYTES) throw new ValidationError("note too large");

  const spaceId = await ensureMeetingsSpaceId(notes);
  const existing = findMeetingNoteBySourceId(notes, payload.sourceId);

  if (existing) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const current = notes.getNote(existing.id) ?? existing;
      if (noteEditedSinceImport(current)) throw new MeetingEditedLocallyError();
      const importVersion = (current.version ?? 0) + 1;
      try {
        const note = await notes.updateNote(current.id, {
          title: payload.title,
          content,
          tags: meetingTags(payload.sourceId, current.tags, importVersion),
          spaceId,
          sensitive: true,
          expectedVersion: current.version ?? 0,
        });
        if (!note) throw new ValidationError("note not found");
        return { note, created: false, summaryStatus };
      } catch (err) {
        if (err instanceof NoteConflictError && attempt < 3) continue;
        throw err;
      }
    }
    throw new ValidationError("import failed");
  }

  const note = await notes.createNote({
    title: payload.title,
    content,
    tags: meetingTags(payload.sourceId),
    spaceId,
    sensitive: true,
  });
  const importVersion = (note.version ?? 0) + 1;
  const stamped = await notes.updateNote(note.id, {
    tags: meetingTags(payload.sourceId, note.tags, importVersion),
    expectedVersion: note.version ?? 0,
  });
  return { note: stamped ?? note, created: true, summaryStatus };
}

export async function importMeetingTranscript(
  cfg: Config,
  notes: NotesStore,
  raw: Record<string, unknown>,
  options: { fetchFn?: FetchLike; skipSummary?: boolean } = {},
): Promise<MeetingImportResult> {
  const payload = validatePayload(raw);
  return withMeetingImportLock(meetingImportLockKey(payload.sourceId), () => persistImport(cfg, notes, payload, options));
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

  const transcriptIdx = note.content.indexOf(TRANSCRIPT_SECTION);
  if (transcriptIdx < 0) throw new ValidationError("invalid meeting note");
  const transcriptBody = note.content.slice(transcriptIdx + TRANSCRIPT_SECTION.length).trim();

  let summary = SUMMARY_PENDING;
  try {
    summary = await summarizeMeetingTranscript(llm, transcriptBody, fetchFn);
  } catch {
    throw new ValidationError("summarization failed");
  }

  const content = buildMeetingNoteContent(summary, transcriptBody);
  const sourceKey = plaudSourceIdFromTags(note.tags);
  const importedVersion = parseMeetingImportVersion(note.tags);
  const syncedWithImport = importedVersion !== null && (note.version ?? 0) === importedVersion;
  const importVersion = (note.version ?? 0) + 1;
  try {
    const updated = await notes.updateNote(noteId, {
      content,
      tags: sourceKey && syncedWithImport ? meetingTags(sourceKey, note.tags, importVersion) : note.tags,
      expectedVersion: note.version ?? 0,
    });
    if (!updated) throw new ValidationError("note not found");
    return updated;
  } catch (err) {
    if (err instanceof NoteConflictError) throw new MeetingEditedLocallyError();
    throw err;
  }
}
