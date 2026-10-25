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
} from "./constants";
import { summarizeMeetingTranscript } from "./summarize";

const DEFAULT_MAX_CONCURRENCY = 2;
const DEFAULT_SHUTDOWN_MS = 5_000;

type InFlight = { generation: number; transcriptBlock: string; writeVersion: number };

function transcriptBlockFromContent(content: string): string {
  const idx = content.indexOf(TRANSCRIPT_SECTION);
  if (idx < 0) return "";
  return content.slice(idx + TRANSCRIPT_SECTION.length).trim();
}

function tagsWithSummaryState(tags: string[], state: "pending" | "failed" | null): string[] {
  const base = stripMeetingSummaryStateTags(tags);
  if (!state) return base;
  return [...base, meetingSummaryStateTag(state)];
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

  /** Queue or refresh a background summary for this note (deduped per noteId). */
  schedule(noteId: string, transcriptBlock: string, writeVersion: number): void {
    if (this.shuttingDown) return;
    const existing = this.inFlight.get(noteId);
    if (existing) {
      const transcriptChanged = existing.transcriptBlock !== transcriptBlock;
      existing.transcriptBlock = transcriptBlock;
      existing.writeVersion = writeVersion;
      if (transcriptChanged) {
        existing.generation += 1;
        if (!this.waitQueue.includes(noteId)) this.waitQueue.push(noteId);
        void this.pump();
      }
      return;
    }
    this.inFlight.set(noteId, { generation: 1, transcriptBlock, writeVersion });
    this.waitQueue.push(noteId);
    void this.pump();
  }

  resumePending(): void {
    const notes = this.notes;
    if (!notes) return;
    for (const note of notes.listNotes()) {
      if (!note.tags.includes(MEETING_TAG)) continue;
      if (parseMeetingSummaryState(note.tags) !== "pending") continue;
      const block = transcriptBlockFromContent(note.content);
      if (!block) continue;
      this.schedule(note.id, block, note.version ?? 0);
    }
  }

  async waitUntilIdle(): Promise<void> {
    while (this.running > 0 || this.waitQueue.length > 0) {
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
      if (!this.inFlight.has(noteId)) continue;
      this.running += 1;
      const task = this.runJob(noteId)
        .catch(() => {})
        .finally(() => {
          this.running -= 1;
          this.tasks.delete(task);
          this.pump();
        });
      this.tasks.add(task);
    }
  }

  private async runJob(noteId: string): Promise<void> {
    const cfg = this.cfg;
    const notes = this.notes;
    const flight = this.inFlight.get(noteId);
    if (!cfg || !notes || !flight) return;

    const startGen = flight.generation;
    const transcriptBlock = flight.transcriptBlock;

    if (!notes.getNote(noteId)) {
      this.inFlight.delete(noteId);
      return;
    }

    const llm = llmConfig(cfg);
    if (!llm) {
      this.inFlight.delete(noteId);
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
    if (!flightNow || flightNow.generation !== startGen) {
      if (flightNow) this.waitQueue.push(noteId);
      else this.inFlight.delete(noteId);
      return;
    }

    const writeVersion = flightNow.writeVersion;
    const live = notes.getNote(noteId);
    if (!live || (live.version ?? 0) !== writeVersion) {
      this.inFlight.delete(noteId);
      return;
    }

    const tagsSnapshot = [...live.tags];
    const sourceKey = plaudSourceIdFromTags(tagsSnapshot);

    if (!llmOk) {
      try {
        await notes.updateNote(noteId, {
          tags: tagsWithSummaryState(tagsSnapshot, "failed"),
          expectedVersion: writeVersion,
        });
      } catch (err) {
        if (!(err instanceof NoteConflictError)) throw err;
      }
      this.inFlight.delete(noteId);
      return;
    }

    const content = finalizeMeetingNoteContent(summaryText, transcriptBlock);
    const importedVersion = parseMeetingImportVersion(tagsSnapshot);
    const syncedWithImport = importedVersion !== null && writeVersion === importedVersion;
    const importVersion = writeVersion + 1;
    const nextTags =
      sourceKey && syncedWithImport
        ? buildMeetingTags(sourceKey, stripMeetingSummaryStateTags(tagsSnapshot), importVersion)
        : tagsWithSummaryState(tagsSnapshot, null);

    try {
      await notes.updateNote(noteId, {
        content,
        tags: nextTags,
        expectedVersion: writeVersion,
      });
    } catch (err) {
      if (err instanceof NoteConflictError) {
        this.inFlight.delete(noteId);
        return;
      }
      throw err;
    }
    this.inFlight.delete(noteId);
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
