import { readFile } from "node:fs/promises";

declare const WHITEBOARD_EDITOR_SCRIPT: string;

export async function whiteboardEditorScript(): Promise<string> {
  if (typeof WHITEBOARD_EDITOR_SCRIPT !== "undefined") return WHITEBOARD_EDITOR_SCRIPT;
  return readFile(new URL("../../dist/whiteboard-editor.js", import.meta.url), "utf8");
}
