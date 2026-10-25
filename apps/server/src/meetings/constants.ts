export const MEETING_IMPORT_MAX_BYTES = 2_000_000;
export const MEETINGS_SPACE_NAME = "Meetings";
export const MEETING_TAG = "meeting";
export const SUMMARY_PENDING = "_Summary pending._";
export const SUMMARY_SECTION = "## Summary";
export const TRANSCRIPT_SECTION = "## Transcript";

export function plaudSourceTag(sourceId: string): string {
  const normalized = sourceId.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const id = normalized || "unknown";
  return `plaud:${id.slice(0, 120)}`;
}
