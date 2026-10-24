import type { KnowledgeNote } from "./store";

/** Whether the note is marked sensitive (excluded from LLM, search body, exports by default). */
export function isNoteSensitive(note: Pick<KnowledgeNote, "sensitive">): boolean {
  return note.sensitive === true;
}

/** Strip body for list/search API responses; title and metadata remain. */
export function redactNoteForCatalog(note: KnowledgeNote): KnowledgeNote {
  if (!isNoteSensitive(note)) return note;
  return { ...note, content: "" };
}

/** Notes safe to include in LLM prompt context. */
export function notesForLlmContext(notes: KnowledgeNote[]): KnowledgeNote[] {
  return notes.filter((note) => !isNoteSensitive(note));
}
