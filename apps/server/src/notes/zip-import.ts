import { randomUUID } from "node:crypto";
import type { KnowledgeNote, KnowledgeSpace } from "./store";
import { sanitizeImportedMarkdown } from "./sanitize-note-content";
import type { ZipReadResult } from "./zip-read";
import {
  folderMappingForPath,
  normalizeWikiLinks,
  parseYamlFrontmatter,
  titleFromMarkdownPath,
} from "./zip-vault";
export interface ZipImportReport {
  notesAdded: number;
  spacesAdded: number;
  duplicatesRenamed: number;
  skippedAttachments: string[];
  skippedOther: string[];
}

function mergeTags(...groups: Array<string[] | undefined>): string[] {
  return [...new Set(groups.flatMap((g) => g ?? []).map((t) => t.trim().replace(/^#/, "").toLowerCase()).filter(Boolean))].slice(0, 30);
}

function uniqueTitle(
  title: string,
  spaceId: string | null,
  used: Map<string, Set<string>>,
  existing: KnowledgeNote[],
): { title: string; renamed: boolean } {
  const key = spaceId ?? "";
  const titles = used.get(key) ?? new Set(existing.filter((n) => n.spaceId === spaceId).map((n) => n.title.trim().toLowerCase()));
  used.set(key, titles);
  let candidate = title.trim() || "Untitled";
  let renamed = false;
  if (titles.has(candidate.toLowerCase())) {
    renamed = true;
    let n = 2;
    while (titles.has(`${candidate} (${n})`.toLowerCase())) n += 1;
    candidate = `${candidate} (${n})`;
  }
  titles.add(candidate.toLowerCase());
  return { title: candidate.slice(0, 240), renamed };
}

function findOrCreateSpaceId(
  name: string,
  byName: Map<string, string>,
  now: string,
  createdSpaces: KnowledgeSpace[],
): { id: string; created: boolean } {
  const key = name.trim().toLowerCase();
  const existing = byName.get(key);
  if (existing) return { id: existing, created: false };
  const id = randomUUID();
  const space: KnowledgeSpace = {
    id,
    name: name.trim().slice(0, 120),
    description: "",
    instructions: "",
    references: [],
    createdAt: now,
    updatedAt: now,
  };
  createdSpaces.push(space);
  byName.set(key, id);
  return { id, created: true };
}

export function buildZipNotesFromEntries(
  readResult: ZipReadResult,
  data: { notes: KnowledgeNote[]; spaces: KnowledgeSpace[] },
): {
  notes: Array<{ title: string; content: string; tags: string[]; spaceId: string | null }>;
  createdSpaces: KnowledgeSpace[];
  spacesAdded: number;
  duplicatesRenamed: number;
} {
  const now = new Date().toISOString();
  const byName = new Map(data.spaces.map((space) => [space.name.trim().toLowerCase(), space.id]));
  const createdSpaces: KnowledgeSpace[] = [];
  let spacesAdded = 0;
  let duplicatesRenamed = 0;
  const usedTitles = new Map<string, Set<string>>();
  const prepared: Array<{ title: string; content: string; tags: string[]; spaceId: string | null }> = [];

  for (const entry of readResult.entries) {
    const raw = entry.data.toString("utf8");
    const parsed = parseYamlFrontmatter(raw);
    const mapping = folderMappingForPath(entry.path);
    let spaceId: string | null = null;
    if (mapping.spaceName) {
      const space = findOrCreateSpaceId(mapping.spaceName, byName, now, createdSpaces);
      spaceId = space.id;
      if (space.created) spacesAdded += 1;
    }
    const baseTitle = parsed.title?.trim() || titleFromMarkdownPath(entry.path);
    const { title, renamed } = uniqueTitle(baseTitle, spaceId, usedTitles, data.notes);
    if (renamed) duplicatesRenamed += 1;
    let body = normalizeWikiLinks(parsed.body);
    body = sanitizeImportedMarkdown(body);
    const noteTags = mergeTags(parsed.tags, mapping.extraTags);
    prepared.push({ title, content: body, tags: noteTags, spaceId });
  }

  return { notes: prepared, createdSpaces, spacesAdded, duplicatesRenamed };
}
