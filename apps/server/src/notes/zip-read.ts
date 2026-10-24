import yauzl, { type Entry, type ZipFile } from "yauzl";
import type { NotesZipLimits } from "./zip-limits";
import {
  assertSafeZipEntryPath,
  isAllowedAttachmentZipPath,
  isMarkdownZipPath,
  isUnderAttachmentsDir,
  isZipSymlinkEntry,
  shouldSkipZipPath,
} from "./zip-path";
import { ValidationError } from "../settings";

export interface ZipReadEntry {
  path: string;
  data: Buffer;
  kind: "markdown" | "attachment";
}

export interface ZipReadResult {
  entries: ZipReadEntry[];
  skippedAttachments: string[];
  skippedOther: string[];
}

function openZipBuffer(buffer: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: false }, (err, zipfile) => {
      if (err || !zipfile) reject(err ?? new Error("failed to open zip"));
      else resolve(zipfile);
    });
  });
}

function openEntryStream(zipfile: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err || !stream) reject(err ?? new Error("failed to open zip entry"));
      else resolve(stream);
    });
  });
}

async function readEntryStream(
  stream: NodeJS.ReadableStream,
  maxBytes: number,
  onChunk: (chunk: Buffer) => void,
): Promise<number> {
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) throw new ValidationError("zip entry exceeds size limit");
    onChunk(buf);
  }
  return total;
}

export async function readNotesZip(buffer: Buffer, limits: NotesZipLimits): Promise<ZipReadResult> {
  if (buffer.length > limits.maxCompressedBytes) {
    throw new ValidationError("zip archive exceeds compressed size limit");
  }
  const zipfile = await openZipBuffer(buffer);
  const entries: ZipReadEntry[] = [];
  const skippedAttachments: string[] = [];
  const skippedOther: string[] = [];
  let entryCount = 0;
  let totalUncompressed = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      zipfile.on("entry", (entry: Entry) => {
        void (async () => {
          try {
            if (entry.fileName.endsWith("/")) {
              zipfile.readEntry();
              return;
            }
            entryCount += 1;
            if (entryCount > limits.maxEntries) {
              throw new ValidationError("zip archive contains too many entries");
            }
            if (isZipSymlinkEntry(entry.externalFileAttributes)) {
              throw new ValidationError("zip archive must not contain symlink entries");
            }
            const safePath = assertSafeZipEntryPath(entry.fileName);
            if (shouldSkipZipPath(safePath)) {
              skippedOther.push(safePath);
              zipfile.readEntry();
              return;
            }
            const compressedSize = entry.compressedSize;
            if (compressedSize > limits.maxCompressedBytes) {
              throw new ValidationError("zip entry compressed size exceeds limit");
            }
            if (compressedSize > 0 && entry.uncompressedSize > 0) {
              const ratio = entry.uncompressedSize / compressedSize;
              if (ratio > limits.maxCompressionRatio) {
                throw new ValidationError("zip entry compression ratio exceeds limit");
              }
            }

            const isMarkdown = isMarkdownZipPath(safePath);
            const isAttachment = isUnderAttachmentsDir(safePath) || (!isMarkdown && isAllowedAttachmentZipPath(safePath));
            if (!isMarkdown && !isAttachment) {
              skippedOther.push(safePath);
              zipfile.readEntry();
              return;
            }
            if (isAttachment) {
              skippedAttachments.push(safePath);
              zipfile.readEntry();
              return;
            }

            const stream = await openEntryStream(zipfile, entry);
            const chunks: Buffer[] = [];
            const entryBytes = await readEntryStream(stream, limits.maxEntryBytes, (chunk) => {
              chunks.push(chunk);
            });
            totalUncompressed += entryBytes;
            if (totalUncompressed > limits.maxUncompressedBytes) {
              throw new ValidationError("zip archive exceeds total uncompressed size limit");
            }
            if (entryBytes > 0 && compressedSize > 0) {
              const streamedRatio = entryBytes / compressedSize;
              if (streamedRatio > limits.maxCompressionRatio) {
                throw new ValidationError("zip entry compression ratio exceeds limit while reading");
              }
            }
            entries.push({ path: safePath, data: Buffer.concat(chunks), kind: "markdown" });
            zipfile.readEntry();
          } catch (err) {
            reject(err);
          }
        })();
      });
      zipfile.on("end", () => resolve());
      zipfile.on("error", reject);
      zipfile.readEntry();
    });
  } finally {
    zipfile.close();
  }

  return { entries, skippedAttachments, skippedOther };
}
