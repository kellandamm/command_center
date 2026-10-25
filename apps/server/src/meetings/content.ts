import { SUMMARY_PENDING, SUMMARY_SECTION, TRANSCRIPT_SECTION } from "./constants";

export function buildMeetingNoteContent(summary: string, transcriptBlock: string): string {
  const summaryBody = summary.trim() || SUMMARY_PENDING;
  return `${SUMMARY_SECTION}\n\n${summaryBody}\n\n${TRANSCRIPT_SECTION}\n\n${transcriptBlock}`;
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
