import type { KnowledgeNote } from "../notes/store";
import { isNoteSensitive } from "../notes/sensitive";
import { MEETING_TAG } from "./constants";

export function isMeetingNote(note: Pick<KnowledgeNote, "tags" | "sensitive">): boolean {
  return note.tags.includes(MEETING_TAG) && isNoteSensitive(note);
}

/** Sensitive meeting notes included only when the owner opts in. */
export function meetingNotesForLlmContext(notes: KnowledgeNote[]): KnowledgeNote[] {
  return notes.filter(isMeetingNote);
}

export function noteCitationHref(noteId: string): string {
  return `/notes?note=${encodeURIComponent(noteId)}`;
}
