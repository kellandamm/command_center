export interface NotesZipLimits {
  /** Max uploaded ZIP size (compressed bytes). */
  maxCompressedBytes: number;
  /** Max total uncompressed bytes across all entries while streaming. */
  maxUncompressedBytes: number;
  /** Max uncompressed bytes for a single entry. */
  maxEntryBytes: number;
  /** Max number of file entries in one archive. */
  maxEntries: number;
  /** Reject entries whose uncompressed/compressed ratio exceeds this (zip bomb guard). */
  maxCompressionRatio: number;
}

export const DEFAULT_NOTES_ZIP_LIMITS: NotesZipLimits = {
  maxCompressedBytes: 25 * 1024 * 1024,
  maxUncompressedBytes: 100 * 1024 * 1024,
  maxEntryBytes: 2 * 1024 * 1024,
  maxEntries: 5_000,
  maxCompressionRatio: 100,
};

function parsePositiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) throw new Error(`${name} must be a positive integer`);
  return n;
}

function parsePositiveNumber(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) throw new Error(`${name} must be a positive number`);
  return n;
}

export function notesZipLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): NotesZipLimits {
  return {
    maxCompressedBytes: parsePositiveInt(env.NOTES_ZIP_MAX_COMPRESSED_BYTES, DEFAULT_NOTES_ZIP_LIMITS.maxCompressedBytes, "NOTES_ZIP_MAX_COMPRESSED_BYTES"),
    maxUncompressedBytes: parsePositiveInt(env.NOTES_ZIP_MAX_UNCOMPRESSED_BYTES, DEFAULT_NOTES_ZIP_LIMITS.maxUncompressedBytes, "NOTES_ZIP_MAX_UNCOMPRESSED_BYTES"),
    maxEntryBytes: parsePositiveInt(env.NOTES_ZIP_MAX_ENTRY_BYTES, DEFAULT_NOTES_ZIP_LIMITS.maxEntryBytes, "NOTES_ZIP_MAX_ENTRY_BYTES"),
    maxEntries: parsePositiveInt(env.NOTES_ZIP_MAX_ENTRIES, DEFAULT_NOTES_ZIP_LIMITS.maxEntries, "NOTES_ZIP_MAX_ENTRIES"),
    maxCompressionRatio: parsePositiveNumber(env.NOTES_ZIP_MAX_COMPRESSION_RATIO, DEFAULT_NOTES_ZIP_LIMITS.maxCompressionRatio, "NOTES_ZIP_MAX_COMPRESSION_RATIO"),
  };
}

