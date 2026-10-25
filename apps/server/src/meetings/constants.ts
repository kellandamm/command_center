/** Max transcript bytes accepted on import (aligned with note body storage). */
export const MEETING_IMPORT_MAX_BYTES = 190_000;
export const NOTE_BODY_MAX_BYTES = 200_000;
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

/** Lock key for imports (normalized Plaud id). */
export function meetingImportLockKey(sourceId: string): string {
  return plaudSourceTag(sourceId);
}

export function plaudSourceIdFromTags(tags: string[]): string | null {
  const tag = tags.find((item) => item.startsWith("plaud:"));
  return tag ? tag.slice("plaud:".length) : null;
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

export const MEETING_SUMMARY_STATE_TAG_PREFIX = "meeting-summary-state:";

export function meetingSummaryStateTag(state: "pending" | "failed"): string {
  return `${MEETING_SUMMARY_STATE_TAG_PREFIX}${state}`;
}

export function parseMeetingSummaryState(tags: string[]): "pending" | "failed" | null {
  const tag = tags.find((item) => item.startsWith(MEETING_SUMMARY_STATE_TAG_PREFIX));
  if (!tag) return null;
  const value = tag.slice(MEETING_SUMMARY_STATE_TAG_PREFIX.length);
  return value === "pending" || value === "failed" ? value : null;
}

export function stripMeetingSummaryStateTags(tags: string[]): string[] {
  return tags.filter((item) => !item.startsWith(MEETING_SUMMARY_STATE_TAG_PREFIX));
}

export function noteEditedSinceImport(note: { version?: number; tags: string[] }): boolean {
  const importedVersion = parseMeetingImportVersion(note.tags);
  if (importedVersion === null) return false;
  return (note.version ?? 0) > importedVersion;
}

export function buildMeetingTags(sourceId: string, existing: string[] = [], importVersion?: number): string[] {
  const base = stripMeetingSummaryStateTags(
    existing.filter((tag) => !tag.startsWith(MEETING_IMPORT_VERSION_TAG_PREFIX)),
  );
  const tags = [...new Set([MEETING_TAG, plaudSourceTag(sourceId), ...base])];
  if (importVersion !== undefined) tags.push(meetingImportVersionTag(importVersion));
  return tags;
}
