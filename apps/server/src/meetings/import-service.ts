import type { Config } from "../config";
import { llmConfig } from "../config";
import type { FetchLike } from "../llm/provider";
import type { KnowledgeNote, NotesStore } from "../notes/store";
import { NoteConflictError } from "../notes/store";
import { ValidationError } from "../settings";
import { buildMeetingNoteContent, finalizeMeetingNoteContent } from "./content";
import {
  MEETING_IMPORT_MAX_BYTES,
  MEETING_TAG,
  MEETINGS_SPACE_NAME,
  meetingImportLockKey,
  meetingImportVersionTag,
  NOTE_BODY_MAX_BYTES,
  noteEditedSinceImport,
  parseMeetingImportVersion,
  plaudSourceIdFromTags,
  plaudSourceTag,
  buildMeetingTags,
  meetingSummaryStateTag,
  parseMeetingSummaryState,
  stripMeetingSummaryStateTags,
  SUMMARY_PENDING,
  TRANSCRIPT_SECTION,
} from "./constants";
import { withMeetingImportLock } from "./import-lock";
import { getMeetingSummaryQueue } from "./summary-queue";
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

export type MeetingImportSummaryStatus = "pending" | "done" | "failed" | "skipped";

export interface MeetingImportResult {
  note: KnowledgeNote;
  created: boolean;
  summaryStatus: MeetingImportSummaryStatus;
}

export class MeetingEditedLocallyError extends Error {
  constructor() {
    super("edited locally");
  }
}

type NoteBaseline = { id: string; version: number; tags: string[] };

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

export { noteEditedSinceImport } from "./constants";

function snapshotNote(note: KnowledgeNote): NoteBaseline {
  return { id: note.id, version: note.version ?? 0, tags: [...note.tags] };
}

function assertNoteBaselineUnchanged(notes: NotesStore, baseline: NoteBaseline): void {
  const live = notes.getNote(baseline.id);
  if (!live || (live.version ?? 0) !== baseline.version) throw new MeetingEditedLocallyError();
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

  const existing = findMeetingNoteBySourceId(notes, payload.sourceId);
  let importBaseline: NoteBaseline | undefined;
  if (existing) {
    if (noteEditedSinceImport(existing)) throw new MeetingEditedLocallyError();
    importBaseline = snapshotNote(existing);
  }

  if (importBaseline) {
    const live = notes.getNote(importBaseline.id);
    if (live) {
      if (noteEditedSinceImport(live)) throw new MeetingEditedLocallyError();
      importBaseline = snapshotNote(live);
    }
  }

  const llm = llmConfig(cfg);
  const scheduleBackgroundSummary = !options.skipSummary && Boolean(llm);
  const content = scheduleBackgroundSummary
    ? finalizeMeetingNoteContent(SUMMARY_PENDING, transcriptBlock)
    : buildMeetingNoteContent("", transcriptBlock, { allowEmptySummary: true });

  const spaceId = await ensureMeetingsSpaceId(notes);

  if (existing && importBaseline) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const refreshed = notes.getNote(importBaseline.id);
      if (refreshed) {
        if (noteEditedSinceImport(refreshed)) throw new MeetingEditedLocallyError();
        if ((refreshed.version ?? 0) !== importBaseline.version) importBaseline = snapshotNote(refreshed);
      }
      assertNoteBaselineUnchanged(notes, importBaseline);
      const importVersion = importBaseline.version + 1;
      try {
        const tags = buildMeetingTags(payload.sourceId, importBaseline.tags, importVersion);
        if (scheduleBackgroundSummary) tags.push(meetingSummaryStateTag("pending"));
        const note = await notes.updateNote(importBaseline.id, {
          title: payload.title,
          content,
          tags,
          spaceId,
          sensitive: true,
          expectedVersion: importBaseline.version,
        });
        if (!note) throw new ValidationError("note not found");
        if (scheduleBackgroundSummary) {
          getMeetingSummaryQueue().schedule(note.id, note.version ?? 0);
        }
        const summaryStatus = resolveImportSummaryStatus(note, scheduleBackgroundSummary, Boolean(llm));
        return { note, created: false, summaryStatus };
      } catch (err) {
        if (err instanceof NoteConflictError && attempt < 3) {
          const live = notes.getNote(importBaseline.id);
          if (!live) throw new MeetingEditedLocallyError();
          importBaseline = snapshotNote(live);
          if (noteEditedSinceImport(live)) throw new MeetingEditedLocallyError();
          continue;
        }
        throw err;
      }
    }
    throw new ValidationError("import failed");
  }

  const createTags = buildMeetingTags(payload.sourceId);
  if (scheduleBackgroundSummary) createTags.push(meetingSummaryStateTag("pending"));
  const note = await notes.createNote({
    title: payload.title,
    content,
    tags: createTags,
    spaceId,
    sensitive: true,
  });
  const importVersion = (note.version ?? 0) + 1;
  const stampTags = buildMeetingTags(payload.sourceId, note.tags, importVersion);
  if (scheduleBackgroundSummary) stampTags.push(meetingSummaryStateTag("pending"));
  const stamped = await notes.updateNote(note.id, {
    tags: stampTags,
    expectedVersion: note.version ?? 0,
  });
  const saved = stamped ?? note;
  if (scheduleBackgroundSummary) {
    getMeetingSummaryQueue().schedule(saved.id, saved.version ?? 0);
  }
  const summaryStatus = resolveImportSummaryStatus(saved, scheduleBackgroundSummary, Boolean(llm));
  return { note: saved, created: true, summaryStatus };
}

function resolveImportSummaryStatus(
  note: KnowledgeNote,
  scheduled: boolean,
  llmConfigured: boolean,
): MeetingImportSummaryStatus {
  const state = parseMeetingSummaryState(note.tags);
  if (state === "failed") return "failed";
  if (scheduled) return "pending";
  if (!llmConfigured) return "skipped";
  return "pending";
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

  const baseVersion = note.version ?? 0;
  const tagsSnapshot = [...note.tags];
  const sourceKey = plaudSourceIdFromTags(tagsSnapshot);

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

  const live = notes.getNote(noteId);
  if (!live || (live.version ?? 0) !== baseVersion) throw new MeetingEditedLocallyError();

  const content = finalizeMeetingNoteContent(summary, transcriptBody);
  const importedVersion = parseMeetingImportVersion(tagsSnapshot);
  const syncedWithImport = importedVersion !== null && baseVersion === importedVersion;
  const importVersion = baseVersion + 1;
  try {
    const updated = await notes.updateNote(noteId, {
      content,
      tags:
        sourceKey && syncedWithImport
          ? buildMeetingTags(sourceKey, tagsSnapshot, importVersion)
          : stripMeetingSummaryStateTags(tagsSnapshot),
      expectedVersion: baseVersion,
    });
    if (!updated) throw new ValidationError("note not found");
    return updated;
  } catch (err) {
    if (err instanceof NoteConflictError) throw new MeetingEditedLocallyError();
    throw err;
  }
}
