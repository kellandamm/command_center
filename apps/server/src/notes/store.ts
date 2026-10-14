import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../store";

const NOTES_FILE = "notes.md";
const MAX_BYTES = 200_000;

export class NotesStore {
  private constructor(private path: string) {}

  static pathFor(dataDir: string): string {
    return join(dataDir, NOTES_FILE);
  }

  static async open(dataDir: string): Promise<NotesStore> {
    return new NotesStore(NotesStore.pathFor(dataDir));
  }

  async read(): Promise<string> {
    try {
      return await readFile(this.path, "utf8");
    } catch (err: any) {
      if (err?.code === "ENOENT") return "";
      throw err;
    }
  }

  async write(content: string): Promise<void> {
    if (typeof content !== "string") throw new Error("content must be a string");
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > MAX_BYTES) throw new Error(`note exceeds ${MAX_BYTES} bytes`);
    await writeFileAtomic(this.path, content);
  }
}
