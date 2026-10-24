import { posix } from "node:path";
import { ValidationError } from "../settings";

/** Reject zip-slip and other unsafe archive entry names. */
export function assertSafeZipEntryPath(raw: string): string {
  if (!raw || typeof raw !== "string") throw new ValidationError("zip entry path is invalid");
  if (raw.includes("\0")) throw new ValidationError("zip entry path contains null bytes");
  if (raw.includes("\\")) throw new ValidationError("zip entry path must use forward slashes");
  if (/^[a-zA-Z]:/.test(raw)) throw new ValidationError("zip entry path must not include a drive letter");
  if (raw.startsWith("/") || posix.isAbsolute(raw)) throw new ValidationError("zip entry path must be relative");
  const parts = raw.split("/").filter((part) => part.length > 0);
  if (parts.some((part) => part === "..")) throw new ValidationError("zip entry path must not contain .. segments");
  const normalized = parts.join("/");
  if (!normalized) throw new ValidationError("zip entry path is empty");
  return normalized;
}

export function isZipSymlinkEntry(externalFileAttributes: number | undefined): boolean {
  if (externalFileAttributes === undefined) return false;
  const mode = (externalFileAttributes >>> 16) & 0xffff;
  return (mode & 0o170_000) === 0o120_000;
}

const SKIP_DIR_NAMES = new Set([".obsidian", "__macosx", ".git", "node_modules"]);

export function shouldSkipZipPath(normalizedPath: string): boolean {
  const lower = normalizedPath.toLowerCase();
  if (lower.endsWith(".ds_store")) return true;
  if (lower.endsWith(".whiteboard.json")) return true;
  const parts = normalizedPath.split("/");
  return parts.some((part) => SKIP_DIR_NAMES.has(part.toLowerCase()));
}

const MARKDOWN_EXT = /\.(md|markdown)$/i;

export function isMarkdownZipPath(path: string): boolean {
  return MARKDOWN_EXT.test(path);
}

const ATTACHMENT_EXT = /\.(png|jpe?g|gif|webp|svg|pdf|mp3|mp4|wav|zip)$/i;

export function isAllowedAttachmentZipPath(path: string): boolean {
  const base = path.split("/").pop() ?? path;
  if (base.startsWith(".")) return false;
  return ATTACHMENT_EXT.test(base);
}

export function isUnderAttachmentsDir(path: string): boolean {
  const parts = path.split("/");
  return parts.some((part) => part.toLowerCase() === "attachments");
}
