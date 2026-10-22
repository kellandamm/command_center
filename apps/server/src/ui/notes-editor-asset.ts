import { readFile } from "node:fs/promises";

declare const NOTES_EDITOR_SCRIPT: string;

export async function notesEditorScript(): Promise<string> {
  if (typeof NOTES_EDITOR_SCRIPT !== "undefined") return NOTES_EDITOR_SCRIPT;
  // Development runs the same browser bundle produced by the server build.
  return readFile(new URL("../../dist/notes-editor.js", import.meta.url), "utf8");
}
