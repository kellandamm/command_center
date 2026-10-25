import type { Config } from "../config";
import { llmConfig } from "../config";
import type { FetchLike } from "../llm/provider";
import type { NotesStore } from "../notes/store";
import { NoteConflictError } from "../notes/store";
import { finalizeMeetingNoteContent } from "./content";
import {
  buildMeetingTags,
  MEETING_TAG,
  meetingSummaryStateTag,
  parseMeetingImportVersion,
  parseMeetingSummaryState,
  plaudSourceIdFromTags,
  stripMeetingSummaryStateTags,
  TRANSCRIPT_SECTION,
  noteEditedSinceImport,
} from "./constants";
import { summarizeMeetingTranscript } from "./summarize";

const DEFAULT_MAX_CONCURRENCY = 2;
const DEFAULT_SHUTDOWN_MS = 5_000;

type InFlight = { writeVersion: number; needsRerun: boolean; transcriptFingerprint: string };

function transcriptBlockFromContent(content: string): string {
  const idx = content.indexOf(TRANSCRIPT_SECTION);
  if (idx < 0) return "";
  return content.slice(idx + TRANSCRIPT_SECTION.length).trim();
}

function transcriptFingerprint(block: string): string {
  if (!block) return "";
  return `${block.length}:${block.slice(0, 80)}:${block.slice(-80)}`;
}

function tagsWithSummaryState(tags: string[], state: "pending" | "failed" | null): string[] {
  const base = stripMeetingSummaryStateTags(tags);
  if (!state) return base;
  return [...base, meetingSummaryStateTag(state)];
}

function importSyncedTags(
  tagsSnapshot: string[],
  sourceKey: string | null,
  writeVersion: number,
  summaryState: "failed" | null,
): string[] {
  const importedVersion = parseMeetingImportVersion(tagsSnapshot);
  const syncedWithImport = importedVersion !== null && writeVersion === importedVersion;
  const importVersion = writeVersion + 1;
  if (sourceKey && syncedWithImport) {
    const next = buildMeetingTags(sourceKey, stripMeetingSummaryStateTags(tagsSnapshot), importVersion);
    if (summaryState) next.push(meetingSummaryStateTag(summaryState));
    return next;
  }
  return tagsWithSummaryState(tagsSnapshot, summaryState);
}

export class MeetingSummaryQueue {
  private cfg: Config | null = null;
  private notes: NotesStore | null = null;
  private fetchFn?: FetchLike;
  private readonly maxConcurrency: number;
  private readonly shutdownWaitMs: number;
  private running = 0;
  private readonly waitQueue: string[] = [];
  private readonly inFlight = new Map<string, InFlight>();
  private readonly activeJobs = new Set<string>();
  private shuttingDown = false;
  private readonly tasks = new Set<Promise<void>>();

  constructor(options?: { maxConcurrency?: number; shutdownWaitMs?: number }) {
    this.maxConcurrency = options?.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
    this.shutdownWaitMs = options?.shutdownWaitMs ?? DEFAULT_SHUTDOWN_MS;
  }

  attach(cfg: Config, notes: NotesStore, fetchFn?: FetchLike): void {
    this.cfg = cfg;
    this.notes = notes;
    this.fetchFn = fetchFn;
  }

  /** Queue or refresh a background summary for this note (one job per note at a time). */
  schedule(noteId: string, writeVersion: number): void {
    if (this.shuttingDown) return;
    const notes = this.notes;
    const note = notes?.getNote(noteId);
    const block = note ? transcriptBlockFromContent(note.content) : "";
    const fingerprint = transcriptFingerprint(block);

    const existing = this.inFlight.get(noteId);
    if (existing) {
      existing.writeVersion = writeVersion;
      const transcriptChanged = fingerprint !== existing.transcriptFingerprint;
      existing.transcriptFingerprint = fingerprint;
      if (this.activeJobs.has(noteId) && transcriptChanged) existing.needsRerun = true;
      if (this.activeJobs.has(noteId)) return;
      if (!this.waitQueue.includes(noteId)) {
        this.waitQueue.push(noteId);
        void this.pump();
      }
      return;
    }
    this.inFlight.set(noteId, { writeVersion, needsRerun: false, transcriptFingerprint: fingerprint });
    this.waitQueue.push(noteId);
    void this.pump();
  }

  resumePending(): void {
    const notes = this.notes;
    if (!notes) return;
    for (const note of notes.listNotes()) {
      if (!note.tags.includes(MEETING_TAG)) continue;
      if (parseMeetingSummaryState(note.tags) !== "pending") continue;
      if (noteEditedSinceImport(note)) {
        void this.clearPendingTag(note.id, note.version ?? 0, note.tags);
        continue;
      }
      if (!transcriptBlockFromContent(note.content)) continue;
      this.schedule(note.id, note.version ?? 0);
    }
  }

  async waitUntilIdle(): Promise<void> {
    while (this.running > 0 || this.waitQueue.length > 0 || this.activeJobs.size > 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const pending = [...this.tasks];
    if (pending.length) await Promise.all(pending);
  }

  async shutdown(waitMs = this.shutdownWaitMs): Promise<void> {
    this.shuttingDown = true;
    const deadline = Date.now() + waitMs;
    while ((this.running > 0 || this.tasks.size > 0) && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
  }

  private pump(): void {
    while (!this.shuttingDown && this.running < this.maxConcurrency && this.waitQueue.length > 0) {
      const noteId = this.waitQueue.shift()!;
      if (!this.inFlight.has(noteId) || this.activeJobs.has(noteId)) continue;
      this.running += 1;
      this.activeJobs.add(noteId);
      const task = this.runJob(noteId)
        .finally(() => {
          this.running -= 1;
          this.activeJobs.delete(noteId);
          this.tasks.delete(task);
          const flight = this.inFlight.get(noteId);
          if (flight?.needsRerun) {
            flight.needsRerun = false;
            if (!this.waitQueue.includes(noteId)) this.waitQueue.push(noteId);
          } else {
            this.inFlight.delete(noteId);
          }
          this.pump();
        });
      this.tasks.add(task);
    }
  }

  private async clearPendingTag(noteId: string, expectedVersion: number, tags: string[]): Promise<void> {
    const notes = this.notes;
    if (!notes || parseMeetingSummaryState(tags) !== "pending") return;
    try {
      await notes.updateNote(noteId, {
        tags: tagsWithSummaryState(tags, null),
        expectedVersion,
      });
    } catch (err) {
      if (!(err instanceof NoteConflictError)) throw err;
    }
  }

  private async markFailed(
    noteId: string,
    writeVersion: number,
    tagsSnapshot: string[],
    sourceKey: string | null,
  ): Promise<void> {
    const notes = this.notes;
    if (!notes) return;
    try {
      await notes.updateNote(noteId, {
        tags: importSyncedTags(tagsSnapshot, sourceKey, writeVersion, "failed"),
        expectedVersion: writeVersion,
      });
    } catch (err) {
      if (!(err instanceof NoteConflictError)) throw err;
    }
  }

  private async runJob(noteId: string): Promise<void> {
    const cfg = this.cfg;
    const notes = this.notes;
    const flight = this.inFlight.get(noteId);
    if (!cfg || !notes || !flight) return;

    let writeVersion = flight.writeVersion;

    try {
      const noteAtStart = notes.getNote(noteId);
      if (!noteAtStart) return;

      const llm = llmConfig(cfg);
      if (!llm) {
        console.error("meeting-summary:no_llm");
        const tagsSnapshot = [...noteAtStart.tags];
        await this.markFailed(noteId, writeVersion, tagsSnapshot, plaudSourceIdFromTags(tagsSnapshot));
        return;
      }

      const transcriptBlock = transcriptBlockFromContent(noteAtStart.content);
      if (!transcriptBlock) {
        console.error("meeting-summary:no_transcript");
        const tagsSnapshot = [...noteAtStart.tags];
        await this.markFailed(noteId, writeVersion, tagsSnapshot, plaudSourceIdFromTags(tagsSnapshot));
        return;
      }

      let summaryText = "";
      let llmOk = false;
      try {
        summaryText = await summarizeMeetingTranscript(llm, transcriptBlock, this.fetchFn);
        llmOk = true;
      } catch {
        llmOk = false;
      }

      const flightNow = this.inFlight.get(noteId);
      if (!flightNow) return;
      writeVersion = flightNow.writeVersion;

      const live = notes.getNote(noteId);
      if (!live || (live.version ?? 0) !== writeVersion) {
        if (live) await this.clearPendingTag(noteId, live.version ?? 0, live.tags);
        return;
      }

      const tagsSnapshot = [...live.tags];
      const sourceKey = plaudSourceIdFromTags(tagsSnapshot);

      if (!llmOk) {
        await this.markFailed(noteId, writeVersion, tagsSnapshot, sourceKey);
        return;
      }

      const content = finalizeMeetingNoteContent(summaryText, transcriptBlock);
      const nextTags = importSyncedTags(tagsSnapshot, sourceKey, writeVersion, null);

      await notes.updateNote(noteId, {
        content,
        tags: nextTags,
        expectedVersion: writeVersion,
      });
    } catch (err) {
      if (err instanceof NoteConflictError) return;
      console.error("meeting-summary:job_error");
      const live = notes.getNote(noteId);
      if (live && (live.version ?? 0) === writeVersion) {
        await this.markFailed(noteId, writeVersion, [...live.tags], plaudSourceIdFromTags(live.tags));
      }
    }
  }
}

let defaultQueue: MeetingSummaryQueue | undefined;

export function getMeetingSummaryQueue(): MeetingSummaryQueue {
  if (!defaultQueue) defaultQueue = new MeetingSummaryQueue();
  return defaultQueue;
}

export function resetMeetingSummaryQueueForTests(): void {
  defaultQueue = new MeetingSummaryQueue();
}
