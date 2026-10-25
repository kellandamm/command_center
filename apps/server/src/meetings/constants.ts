/** Max transcript bytes accepted on import (aligned with note body storage). */
export const MEETING_IMPORT_MAX_BYTES = 190_000;
export const MEETINGS_SPACE_NAME = "Meetings";
export const MEETING_TAG = "meeting";
export const MEETING_IMPORT_VERSION_TAG_PREFIX = "meeting-import-ver:";
export const SUMMARY_PENDING = "_Summary pending._";
export const SUMMARY_SECTION = "## Summary";
export const TRANSCRIPT_SECTION = "## Transcript";

export function plaudSourceTag(sourceId: string): string {
  const normalized = sourceId.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const id = normalized || "unknown";
  return `plaud:${id.slice(0, 120)}`;
}

export function meetingImportVersionTag(version: number): string {
  return `${MEETING_IMPORT_VERSION_TAG_PREFIX}${version}`;
}

export function parseMeetingImportVersion(tags: string[]): number | null {
  const tag = tags.find((item) => item.startsWith(MEETING_IMPORT_VERSION_TAG_PREFIX));
  if (!tag) return null;
  const value = Number(tag.slice(MEETING_IMPORT_VERSION_TAG_PREFIX.length));
  return Number.isInteger(value) ? value : null;
}
