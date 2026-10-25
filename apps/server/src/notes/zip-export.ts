import { zip } from "../read-later/zip";
import type { KnowledgeNote, KnowledgeSpace } from "./store";
import { isNoteSensitive } from "./sensitive";
import { safeExportFileName } from "./zip-vault";

function exportPathForNote(note: KnowledgeNote, spacesById: Map<string, KnowledgeSpace>, usedPaths: Set<string>): string | null {
  if (isNoteSensitive(note)) return null;
  const space = note.spaceId ? spacesById.get(note.spaceId) : undefined;
  const base = safeExportFileName(note.title);
  let path = space ? `${safeExportFileName(space.name)}/${base}.md` : `${base}.md`;
  let counter = 2;
  while (usedPaths.has(path.toLowerCase())) {
    path = space ? `${safeExportFileName(space.name)}/${base} (${counter}).md` : `${base} (${counter}).md`;
    counter += 1;
  }
  usedPaths.add(path.toLowerCase());
  return path;
}

function noteMarkdownFile(note: KnowledgeNote): string {
  const header = [
    "---",
    `title: ${JSON.stringify(note.title)}`,
    `tags: ${JSON.stringify(note.tags)}`,
    `sourceUrl: ${JSON.stringify(note.sourceUrl)}`,
    `spaceId: ${JSON.stringify(note.spaceId)}`,
    "---",
    "",
  ].join("\n");
  return `${header}${note.content}`;
}

export function buildNotesZipExport(notes: KnowledgeNote[], spaces: KnowledgeSpace[]): { zip: Buffer; exported: number; skippedSensitive: number } {
  const spacesById = new Map(spaces.map((space) => [space.id, space]));
  const usedPaths = new Set<string>();
  const files: Array<{ name: string; data: Buffer }> = [];
  let skippedSensitive = 0;
  for (const note of notes) {
    if (isNoteSensitive(note)) {
      skippedSensitive += 1;
      continue;
    }
    const path = exportPathForNote(note, spacesById, usedPaths);
    if (!path) continue;
    files.push({ name: path, data: Buffer.from(noteMarkdownFile(note), "utf8") });
  }
  return { zip: zip(files), exported: files.length, skippedSensitive };
}
