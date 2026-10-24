import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ValidationError } from "../settings";
import { writeFileAtomic } from "../store";

const NOTES_FILE = "notes.md";
const KNOWLEDGE_FILE = "knowledge.json";
const MAX_BYTES = 200_000;
const MAX_STORE_BYTES = 20_000_000;

export interface KnowledgeNote {
  id: string;
  title: string;
  content: string;
  tags: string[];
  spaceId: string | null;
  sourceUrl: string | null;
  legacy?: boolean;
  createdAt: string;
  updatedAt: string;
  version?: number;
  pinned?: boolean;
  archivedAt?: string | null;
}

export interface NoteRevision extends KnowledgeNote { revisionId: string }
export class NoteConflictError extends Error {}

export interface KnowledgeSource {
  id: string;
  title: string;
  url: string | null;
  excerpt: string;
  tags: string[];
  spaceId: string | null;
  archivedAt?: string | null;
  summary?: string;
  summaryModel?: string;
  summarizedAt?: string;
  originKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeSpace {
  id: string;
  name: string;
  description: string;
  instructions: string;
  references: KnowledgeReference[];
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeReference {
  id: string;
  type: "board" | "calendar";
  targetId: string;
  title: string;
  href: string;
  excerpt: string;
  createdAt: string;
}

interface KnowledgeData {
  notes: KnowledgeNote[];
  sources: KnowledgeSource[];
  spaces: KnowledgeSpace[];
  revisions?: NoteRevision[];
}

const emptyData = (): KnowledgeData => ({ notes: [], sources: [], spaces: [] });

function text(value: unknown, field: string, max: number, required = false): string {
  if (typeof value !== "string") throw new ValidationError(`${field} must be text`);
  const result = value.trim();
  if (required && !result) throw new ValidationError(`${field} is required`);
  if (Buffer.byteLength(result, "utf8") > max) throw new ValidationError(`${field} exceeds ${max} bytes`);
  return result;
}

function markdownContent(value: unknown): string {
  if (typeof value !== "string") throw new ValidationError("content must be text");
  if (Buffer.byteLength(value, "utf8") > MAX_BYTES) throw new ValidationError(`content exceeds ${MAX_BYTES} bytes`);
  return value;
}
function pinned(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new ValidationError("pinned must be boolean");
  return value;
}
function archivedAt(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new ValidationError("archivedAt must be an ISO timestamp or null");
  return value;
}
function tags(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== "string")) throw new ValidationError("tags must be a list of text");
  return [...new Set(value.map((tag) => String(tag).trim().replace(/^#/, "").toLowerCase()).filter(Boolean))].slice(0, 30);
}

function optionalUrl(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new ValidationError(`${field} must be a URL`);
  if (Buffer.byteLength(value, "utf8") > 2_048) throw new ValidationError(`${field} exceeds 2048 bytes`);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ValidationError(`${field} must be a valid URL`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new ValidationError(`${field} must use HTTP or HTTPS`);
  return parsed.toString();
}

export class NotesStore {
  private data: KnowledgeData = emptyData();
  private writeQueue: Promise<void> = Promise.resolve();

  private constructor(private path: string, private knowledgePath: string) {}

  static pathFor(dataDir: string): string {
    return join(dataDir, NOTES_FILE);
  }

  static async open(dataDir: string): Promise<NotesStore> {
    const store = new NotesStore(NotesStore.pathFor(dataDir), join(dataDir, KNOWLEDGE_FILE));
    await store.load();
    return store;
  }

  private async load(): Promise<void> {
    try {
      const raw = await readFile(this.knowledgePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<KnowledgeData>;
      this.data = {
        revisions: Array.isArray(parsed.revisions) ? parsed.revisions : [],
        notes: Array.isArray(parsed.notes) ? parsed.notes : [],
        sources: Array.isArray(parsed.sources) ? parsed.sources : [],
        spaces: Array.isArray(parsed.spaces) ? parsed.spaces.map((space) => ({
          ...space,
          references: Array.isArray(space.references) ? space.references : [],
        })) : [],
      };
    } catch (err: any) {
      if (err?.code !== "ENOENT") throw err;
      const content = await this.readLegacyFile();
      if (content) {
        const now = new Date().toISOString();
        this.data.notes.push({
          id: randomUUID(),
          title: "Main notes",
          content,
          tags: [],
          spaceId: null,
          sourceUrl: null,
          legacy: true,
          createdAt: now,
          updatedAt: now,
        });
      }
      await this.persist();
    }
  }

  private async readLegacyFile(): Promise<string> {
    try {
      return await readFile(this.path, "utf8");
    } catch (err: any) {
      if (err?.code === "ENOENT") return "";
      throw err;
    }
  }

  private async persist(): Promise<void> {
    const write = this.writeQueue.then(() => writeFileAtomic(this.knowledgePath, this.serialize()));
    this.writeQueue = write.catch(() => {});
    await write;
  }

  private async updateData<T>(fn: () => T): Promise<T> {
    const run = this.writeQueue.then(async () => {
      const previous = structuredClone(this.data);
      try {
        const result = fn();
        await writeFileAtomic(this.knowledgePath, this.serialize());
        return result;
      } catch (err) {
        this.data = previous;
        throw err;
      }
    });
    this.writeQueue = run.then(() => {}, () => {});
    return run;
  }

  private serialize(): string {
    const serialized = JSON.stringify(this.data, null, 2);
    if (Buffer.byteLength(serialized, "utf8") > MAX_STORE_BYTES) {
      throw new ValidationError(`knowledge store exceeds ${MAX_STORE_BYTES} bytes`);
    }
    return serialized;
  }

  async read(): Promise<string> {
    const note = this.data.notes.find((item) => item.legacy === true || (item.title === "Main notes" && item.legacy !== false));
    return note?.content ?? "";
  }

  async write(content: string): Promise<void> {
    if (typeof content !== "string") throw new ValidationError("content must be a string");
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > MAX_BYTES) throw new ValidationError(`note exceeds ${MAX_BYTES} bytes`);
    await this.updateData(() => {
      const now = new Date().toISOString();
      const note = this.data.notes.find((item) => item.legacy === true || (item.title === "Main notes" && item.legacy !== false));
      if (note) {
        this.recordRevision(note);
        note.content = content;
        note.updatedAt = now;
      } else {
        this.data.notes.push({
          id: randomUUID(),
          title: "Main notes",
          content,
          tags: [],
          spaceId: null,
          sourceUrl: null,
          legacy: true,
          createdAt: now,
          updatedAt: now,
        });
      }
    });
  }

  async addSpaceReference(
    spaceId: string,
    input: Omit<KnowledgeReference, "id" | "createdAt" | "href">,
  ): Promise<KnowledgeReference> {
    return this.updateData(() => {
      const space = this.data.spaces.find((item) => item.id === spaceId);
      if (!space) throw new ValidationError("space not found");
      const targetId = text(input.targetId, "targetId", 300, true);
      const type = input.type;
      if (type !== "board" && type !== "calendar") throw new ValidationError("reference type is invalid");
      const existing = space.references.find((item) => item.type === type && item.targetId === targetId);
      if (existing) return existing;
      const reference: KnowledgeReference = {
        id: randomUUID(),
        type,
        targetId,
        title: text(input.title, "title", 240, true),
        href: type === "board" ? "/board" : "/calendar",
        excerpt: text(input.excerpt ?? "", "excerpt", 8_000),
        createdAt: new Date().toISOString(),
      };
      space.references.push(reference);
      space.updatedAt = reference.createdAt;
      return reference;
    });
  }

  async removeSpaceReference(spaceId: string, referenceId: string): Promise<boolean> {
    return this.updateData(() => {
      const space = this.data.spaces.find((item) => item.id === spaceId);
      if (!space) return false;
      const index = space.references.findIndex((reference) => reference.id === referenceId);
      if (index < 0) return false;
      space.references.splice(index, 1);
      space.updatedAt = new Date().toISOString();
      return true;
    });
  }

  /** Append a line (agents); preserves existing markdown. */
  async append(line: string): Promise<string> {
    const addition = String(line ?? "").trim();
    if (!addition) throw new ValidationError("text is required");
    return this.updateData(() => {
      const now = new Date().toISOString();
      let note = this.data.notes.find((item) => item.legacy === true || (item.title === "Main notes" && item.legacy !== false));
      if (!note) {
        note = {
          id: randomUUID(),
          title: "Main notes",
          content: "",
          tags: [],
          spaceId: null,
          sourceUrl: null,
          legacy: true,
          createdAt: now,
          updatedAt: now,
        };
        this.data.notes.push(note);
      }
      this.recordRevision(note);
      note.content = note.content ? `${note.content.replace(/\n?$/, "\n")}${addition}\n` : `${addition}\n`;
      note.updatedAt = now;
      if (Buffer.byteLength(note.content, "utf8") > MAX_BYTES) throw new ValidationError(`note exceeds ${MAX_BYTES} bytes`);
      return note.content;
    });
  }

  listNotes(query = ""): KnowledgeNote[] {
    const needle = query.trim().toLowerCase();
    return this.data.notes
      .filter((note) => !needle || `${note.title}\n${note.content}\n${note.tags.join(" ")}`.toLowerCase().includes(needle))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getNote(id: string): KnowledgeNote | undefined {
    return this.data.notes.find((note) => note.id === id);
  }

  async createNote(input: Record<string, unknown>): Promise<KnowledgeNote> {
    const title = text(input.title ?? "Untitled", "title", 240, true);
    const content = markdownContent(input.content ?? "");
    const sourceUrl = optionalUrl(input.sourceUrl, "sourceUrl");
    return this.updateData(() => {
      const now = new Date().toISOString();
      const note: KnowledgeNote = {
        id: randomUUID(), title, content, tags: tags(input.tags), legacy: false, version: 1,
        pinned: pinned(input.pinned), archivedAt: archivedAt(input.archivedAt),
        spaceId: this.spaceId(input.spaceId), sourceUrl, createdAt: now, updatedAt: now,
      };
      this.data.notes.push(note);
      return note;
    });
  }

  async updateNote(id: string, input: Record<string, unknown>): Promise<KnowledgeNote | undefined> {
    return this.updateData(() => {
      const note = this.data.notes.find((item) => item.id === id);
      if (!note) return undefined;
      if (input.expectedVersion !== undefined && input.expectedVersion !== (note.version ?? 0)) {
        throw new NoteConflictError("This note changed elsewhere. Your draft is still here; reload the latest version before merging your changes.");
      }
      this.recordRevision(note);
      if (input.title !== undefined) note.title = text(input.title, "title", 240, true);
      if (input.content !== undefined) note.content = markdownContent(input.content);
      if (input.tags !== undefined) note.tags = tags(input.tags);
      if (input.spaceId !== undefined) note.spaceId = this.spaceId(input.spaceId);
      if (input.sourceUrl !== undefined) note.sourceUrl = optionalUrl(input.sourceUrl, "sourceUrl");
      if (input.pinned !== undefined) note.pinned = pinned(input.pinned);
      if (input.archivedAt !== undefined) note.archivedAt = archivedAt(input.archivedAt);
      note.updatedAt = new Date().toISOString();
      return note;
    });
  }

  private recordRevision(note: KnowledgeNote) {
    const revisions = this.data.revisions ?? [];
    revisions.push({ ...structuredClone(note), revisionId: randomUUID() });
    const other = revisions.filter((revision) => revision.id !== note.id);
    this.data.revisions = [...other, ...revisions.filter((revision) => revision.id === note.id).slice(-20)];
    note.version = (note.version ?? 0) + 1;
  }

  noteHistory(id: string): NoteRevision[] {
    return structuredClone((this.data.revisions ?? []).filter((revision) => revision.id === id).reverse());
  }

  async restoreNote(id: string, revisionId: string, expectedVersion: number): Promise<KnowledgeNote | undefined> {
    const revision = this.noteHistory(id).find((item) => item.revisionId === revisionId);
    if (!revision) throw new ValidationError("Revision not found");
    return this.updateNote(id, {
      title: revision.title, content: revision.content, tags: revision.tags,
      spaceId: revision.spaceId && this.data.spaces.some((space) => space.id === revision.spaceId) ? revision.spaceId : null,
      sourceUrl: revision.sourceUrl, expectedVersion,
      pinned: revision.pinned ?? false, archivedAt: revision.archivedAt ?? null,
    });
  }

  async deleteNote(id: string): Promise<boolean> {
    return this.updateData(() => {
      const index = this.data.notes.findIndex((item) => item.id === id);
      if (index < 0) return false;
      this.data.notes.splice(index, 1);
      this.data.revisions = (this.data.revisions ?? []).filter((revision) => revision.id !== id);
      return true;
    });
  }

  listSources(query = ""): KnowledgeSource[] {
    const needle = query.trim().toLowerCase();
    return this.data.sources
      .filter((source) => !needle || `${source.title}\n${source.url}\n${source.excerpt}\n${source.summary ?? ""}\n${source.tags.join(" ")}`.toLowerCase().includes(needle))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getSource(id: string): KnowledgeSource | undefined {
    return this.data.sources.find((source) => source.id === id);
  }

  async createSource(input: Record<string, unknown>): Promise<KnowledgeSource> {
    const url = optionalUrl(input.url, "url");
    const title = text(input.title ?? (url ? new URL(url).hostname : ""), "title", 240, true);
    const excerpt = text(input.excerpt ?? "", "excerpt", 20_000);
    return this.updateData(() => {
      const now = new Date().toISOString();
      const source: KnowledgeSource = {
        id: randomUUID(), title, url, excerpt, tags: tags(input.tags),
        spaceId: this.spaceId(input.spaceId), createdAt: now, updatedAt: now,
      };
      this.data.sources.push(source);
      return source;
    });
  }

  async captureSource(input: Record<string, unknown>): Promise<{ source: KnowledgeSource; duplicate: boolean }> {
    const url = optionalUrl(input.url, "url");
    if (!url) throw new ValidationError("url is required");
    const normalized = new URL(url);
    normalized.hash = "";
    if (normalized.username || normalized.password) throw new ValidationError("URL credentials are not allowed");
    const title = text(input.title ?? normalized.hostname, "title", 240, true);
    const excerpt = text(input.excerpt ?? "", "excerpt", 20_000);
    return this.updateData(() => {
      const existing = this.data.sources.find((source) => source.url === normalized.href);
      if (existing) return { source: existing, duplicate: true };
      const now = new Date().toISOString();
      const source: KnowledgeSource = {
        id: randomUUID(), title, url: normalized.href, excerpt, tags: tags(input.tags),
        spaceId: this.spaceId(input.spaceId), archivedAt: null, createdAt: now, updatedAt: now,
      };
      this.data.sources.push(source);
      return { source, duplicate: false };
    });
  }

  async saveSourceSummary(id: string, summary: string, model: string, excerpt: string): Promise<KnowledgeSource> {
    return this.updateData(() => {
      const source = this.data.sources.find((item) => item.id === id);
      if (!source) throw new ValidationError("source no longer exists");
      if (source.excerpt !== excerpt) throw new ValidationError("Source text changed; summarize it again.");
      source.summary = text(summary, "summary", 20_000, true);
      source.summaryModel = model;
      source.summarizedAt = new Date().toISOString();
      source.updatedAt = source.summarizedAt;
      return source;
    });
  }

  async importSavedSources(items: Array<Omit<KnowledgeSource, "id" | "tags" | "spaceId" | "updatedAt">>): Promise<number> {
    return this.updateData(() => {
      let added = 0;
      for (const item of items) {
        if (!item.originKey || this.data.sources.some((source) => source.originKey === item.originKey)) continue;
        const source = this.data.sources.find((source) => item.url && source.url === item.url);
        if (source) {
          if (!source.summary && item.summary) {
            source.summary = item.summary;
            source.summaryModel = item.summaryModel;
            source.summarizedAt = item.summarizedAt;
          }
          continue;
        }
        this.data.sources.push({
          ...item, id: randomUUID(), tags: [], spaceId: null, updatedAt: item.createdAt,
        });
        added++;
      }
      return added;
    });
  }

  async updateSource(id: string, input: Record<string, unknown>): Promise<KnowledgeSource | undefined> {
    return this.updateData(() => {
      const source = this.data.sources.find((item) => item.id === id);
      if (!source) return undefined;
      if (input.title !== undefined) source.title = text(input.title, "title", 240, true);
      if (input.url !== undefined) {
        source.url = optionalUrl(input.url, "url");
      }
      if (input.excerpt !== undefined) {
        const excerpt = text(input.excerpt, "excerpt", 20_000);
        if (excerpt !== source.excerpt) {
          delete source.summary;
          delete source.summaryModel;
          delete source.summarizedAt;
        }
        source.excerpt = excerpt;
      }
      if (input.archived !== undefined) {
        if (typeof input.archived !== "boolean") throw new ValidationError("archived must be a boolean");
        source.archivedAt = input.archived ? new Date().toISOString() : null;
      }
      if (input.tags !== undefined) source.tags = tags(input.tags);
      if (input.spaceId !== undefined) source.spaceId = this.spaceId(input.spaceId);
      source.updatedAt = new Date().toISOString();
      return source;
    });
  }

  async deleteSource(id: string): Promise<boolean> {
    return this.updateData(() => {
      const index = this.data.sources.findIndex((item) => item.id === id);
      if (index < 0) return false;
      this.data.sources.splice(index, 1);
      return true;
    });
  }

  listSpaces(): KnowledgeSpace[] {
    return [...this.data.spaces].sort((a, b) => a.name.localeCompare(b.name));
  }

  getSpace(id: string): KnowledgeSpace | undefined {
    return this.data.spaces.find((space) => space.id === id);
  }

  async createSpace(input: Record<string, unknown>): Promise<KnowledgeSpace> {
    return this.updateData(() => {
      const now = new Date().toISOString();
      const space: KnowledgeSpace = {
        id: randomUUID(),
        name: text(input.name, "name", 120, true),
        description: text(input.description ?? "", "description", 2_000),
        instructions: text(input.instructions ?? "", "instructions", 4_000),
        references: [],
        createdAt: now,
        updatedAt: now,
      };
      this.data.spaces.push(space);
      return space;
    });
  }

  async updateSpace(id: string, input: Record<string, unknown>): Promise<KnowledgeSpace | undefined> {
    return this.updateData(() => {
      const space = this.data.spaces.find((item) => item.id === id);
      if (!space) return undefined;
      if (input.name !== undefined) space.name = text(input.name, "name", 120, true);
      if (input.description !== undefined) space.description = text(input.description, "description", 2_000);
      if (input.instructions !== undefined) space.instructions = text(input.instructions, "instructions", 4_000);
      space.updatedAt = new Date().toISOString();
      return space;
    });
  }

  async deleteSpace(id: string): Promise<boolean> {
    return this.updateData(() => {
      const index = this.data.spaces.findIndex((item) => item.id === id);
      if (index < 0) return false;
      this.data.spaces.splice(index, 1);
      for (const note of this.data.notes) if (note.spaceId === id) note.spaceId = null;
      for (const source of this.data.sources) if (source.spaceId === id) source.spaceId = null;
      return true;
    });
  }

  search(query: string): { notes: KnowledgeNote[]; sources: KnowledgeSource[]; spaces: KnowledgeSpace[] } {
    return {
      notes: this.listNotes(query),
      sources: this.listSources(query),
      spaces: this.listSpaces().filter((space) => `${space.name}\n${space.description}`.toLowerCase().includes(query.trim().toLowerCase())),
    };
  }

  getSpaceContent(spaceId: string): { space: KnowledgeSpace; notes: KnowledgeNote[]; sources: KnowledgeSource[] } | undefined {
    const space = this.getSpace(spaceId);
    if (!space) return undefined;
    return {
      space,
      notes: this.data.notes.filter((note) => note.spaceId === spaceId),
      sources: this.data.sources.filter((source) => source.spaceId === spaceId),
    };
  }

  exportBackup(): KnowledgeData {
    return structuredClone(this.data);
  }

  async importBackup(input: unknown): Promise<{ notes: number; sources: number; spaces: number; skipped: number }> {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new ValidationError("backup must be an object");
    const backup = input as Partial<KnowledgeData>;
    if (!Array.isArray(backup.notes) || !Array.isArray(backup.sources) || !Array.isArray(backup.spaces)) {
      throw new ValidationError("backup must contain notes, sources, and spaces lists");
    }
    if (backup.notes.length + backup.sources.length + backup.spaces.length > 5_000) throw new ValidationError("backup contains too many records");
    return this.updateData(() => {
      const now = new Date().toISOString();
      const importedSpaceIds = new Map<string, string>();
      let notesAdded = 0;
      let sourcesAdded = 0;
      let spacesAdded = 0;
      let skipped = 0;
      for (const raw of backup.spaces!) {
        if (!raw || typeof raw !== "object") throw new ValidationError("backup contains an invalid space");
        const item = raw as KnowledgeSpace;
        const id = text(item.id, "backup space id", 300, true);
        const existing = this.data.spaces.find((space) => space.id === id);
        if (existing) {
          importedSpaceIds.set(id, existing.id);
          skipped++;
          continue;
        }
        const space: KnowledgeSpace = {
          id,
          name: text(item.name, "space name", 120, true),
          description: text(item.description ?? "", "space description", 2_000),
          instructions: text(item.instructions ?? "", "space instructions", 4_000),
          references: Array.isArray(item.references) ? item.references.map((reference) => {
            if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
              throw new ValidationError("backup contains an invalid reference");
            }
            if (reference.type !== "board" && reference.type !== "calendar") {
              throw new ValidationError("backup reference type is invalid");
            }
            return {
              id: text(reference.id, "reference id", 300, true),
              type: reference.type,
              targetId: text(reference.targetId, "reference targetId", 300, true),
              title: text(reference.title, "reference title", 240, true),
              href: reference.type === "calendar" ? "/calendar" : "/board",
              excerpt: text(reference.excerpt ?? "", "reference excerpt", 8_000),
              createdAt: typeof reference.createdAt === "string" ? reference.createdAt : now,
            };
          }) : [],
          createdAt: typeof item.createdAt === "string" ? item.createdAt : now,
          updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : now,
        };
        this.data.spaces.push(space);
        importedSpaceIds.set(id, id);
        spacesAdded++;
      }
      const existingNoteIds = new Set(this.data.notes.map((note) => note.id));
      const addedNoteIds = new Set<string>();
      for (const raw of backup.notes!) {
        if (!raw || typeof raw !== "object") throw new ValidationError("backup contains an invalid note");
        const item = raw as KnowledgeNote;
        const id = text(item.id, "backup note id", 300, true);
        if (existingNoteIds.has(id)) {
          skipped++;
          continue;
        }
        this.data.notes.push({
          id,
          title: text(item.title, "note title", 240, true),
          content: markdownContent(item.content),
          tags: tags(item.tags),
          spaceId: item.spaceId ? importedSpaceIds.get(item.spaceId) ?? (this.data.spaces.some((space) => space.id === item.spaceId) ? item.spaceId : null) : null,
          sourceUrl: optionalUrl(item.sourceUrl, "sourceUrl"),
          legacy: Boolean(item.legacy),
          createdAt: typeof item.createdAt === "string" ? item.createdAt : now,
          updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : now,
          version: Number.isInteger(item.version) && item.version! >= 0 ? item.version : 0,
          pinned: pinned(item.pinned), archivedAt: archivedAt(item.archivedAt),
        });
        existingNoteIds.add(id);
        addedNoteIds.add(id);
        notesAdded++;
      }
      if (backup.revisions !== undefined && !Array.isArray(backup.revisions)) throw new ValidationError("revisions must be a list");
      for (const item of backup.revisions ?? []) {
        if (!item || typeof item !== "object") throw new ValidationError("Invalid revision");
        if (!addedNoteIds.has(item.id)) continue;
        const revision: NoteRevision = {
          ...(item.legacy === undefined ? {} : { legacy: Boolean(item.legacy) }),
          id: item.id, revisionId: text(item.revisionId, "revision id", 300, true),
          title: text(item.title, "revision title", 240, true), content: markdownContent(item.content),
          tags: tags(item.tags),
          spaceId: item.spaceId && this.data.spaces.some((space) => space.id === item.spaceId) ? item.spaceId : null,
          sourceUrl: optionalUrl(item.sourceUrl, "sourceUrl"),
          createdAt: text(item.createdAt, "revision createdAt", 100, true),
          updatedAt: text(item.updatedAt, "revision updatedAt", 100, true),
          version: Number.isInteger(item.version) && item.version! >= 0 ? item.version : 0,
          pinned: pinned(item.pinned), archivedAt: archivedAt(item.archivedAt),
        };
        const revisions = this.data.revisions ?? [];
        revisions.push(revision);
        this.data.revisions = [...revisions.filter((row) => row.id !== item.id), ...revisions.filter((row) => row.id === item.id).slice(-20)];
      }
      const existingSourceIds = new Set(this.data.sources.map((source) => source.id));
      for (const raw of backup.sources!) {
        if (!raw || typeof raw !== "object") throw new ValidationError("backup contains an invalid source");
        const item = raw as KnowledgeSource;
        const id = text(item.id, "backup source id", 300, true);
        if (existingSourceIds.has(id)) {
          skipped++;
          continue;
        }
        this.data.sources.push({
          id,
          title: text(item.title, "source title", 240, true),
          url: optionalUrl(item.url, "source url"),
          excerpt: text(item.excerpt ?? "", "source excerpt", 20_000),
          summary: item.summary === undefined ? undefined : text(item.summary, "source summary", 20_000),
          summaryModel: item.summaryModel === undefined ? undefined : text(item.summaryModel, "summary model", 240),
          summarizedAt: item.summarizedAt === undefined ? undefined : text(item.summarizedAt, "summary date", 100),
          archivedAt: item.archivedAt ? text(item.archivedAt, "archive date", 100) : null,
          originKey: item.originKey === undefined ? undefined : text(item.originKey, "source origin", 300),
          tags: tags(item.tags),
          spaceId: item.spaceId ? importedSpaceIds.get(item.spaceId) ?? (this.data.spaces.some((space) => space.id === item.spaceId) ? item.spaceId : null) : null,
          createdAt: typeof item.createdAt === "string" ? item.createdAt : now,
          updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : now,
        });
        existingSourceIds.add(id);
        sourcesAdded++;
      }
      return { notes: notesAdded, sources: sourcesAdded, spaces: spacesAdded, skipped };
    });
  }

  private spaceId(value: unknown): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || !this.data.spaces.some((space) => space.id === value)) throw new ValidationError("spaceId is invalid");
    return value;
  }
}
