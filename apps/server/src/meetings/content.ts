import { NOTE_BODY_MAX_BYTES, SUMMARY_PENDING, SUMMARY_SECTION, TRANSCRIPT_SECTION } from "./constants";

const SUMMARY_TRUNCATED_MARKER = "\n\n_(Summary truncated to fit note size.)_";

export function buildMeetingNoteContent(summary: string, transcriptBlock: string): string {
  const summaryBody = summary.trim() || SUMMARY_PENDING;
  return `${SUMMARY_SECTION}\n\n${summaryBody}\n\n${TRANSCRIPT_SECTION}\n\n${transcriptBlock}`;
}

export function noteContentByteLength(summary: string, transcriptBlock: string): number {
  return Buffer.byteLength(buildMeetingNoteContent(summary, transcriptBlock), "utf8");
}

/** Truncate summary text so the full meeting note stays within storage limits. */
export function capSummaryForNoteBudget(summary: string, transcriptBlock: string): string {
  let body = summary.trim() || SUMMARY_PENDING;
  if (noteContentByteLength(body, transcriptBlock) <= NOTE_BODY_MAX_BYTES) return body;

  let truncated = body;
  while (truncated.length > 0) {
    const candidate = `${truncated}${SUMMARY_TRUNCATED_MARKER}`;
    if (noteContentByteLength(candidate, transcriptBlock) <= NOTE_BODY_MAX_BYTES) return candidate;
    truncated = truncated.slice(0, Math.max(0, Math.floor(truncated.length * 0.85)));
  }
  return SUMMARY_PENDING;
}

export function finalizeMeetingNoteContent(summary: string, transcriptBlock: string): string {
  const capped = capSummaryForNoteBudget(summary, transcriptBlock);
  let content = buildMeetingNoteContent(capped, transcriptBlock);
  if (Buffer.byteLength(content, "utf8") > NOTE_BODY_MAX_BYTES) {
    content = buildMeetingNoteContent(SUMMARY_PENDING, transcriptBlock);
  }
  return content;
}

export function extractSummaryFromContent(content: string): string {
  const match = content.match(
    new RegExp(`^${SUMMARY_SECTION}\\s*\\n+([\\s\\S]*?)\\n+${TRANSCRIPT_SECTION}`, "m"),
  );
  if (!match) return "";
  return match[1]!.trim();
}

export function isSummaryPending(content: string): boolean {
  const summary = extractSummaryFromContent(content);
  return !summary || summary === SUMMARY_PENDING;
}
