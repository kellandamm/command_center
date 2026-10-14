import sanitizeHtml from "sanitize-html";

const STRIP = { allowedTags: [], allowedAttributes: {} };

/** Plain text from article fields for LLM input (untrusted). */
export function articlePlainForLlm(opts: { title: string; summary?: string; contentHtml?: string; link?: string }, max = 12_000): string {
  const raw = opts.contentHtml || opts.summary || opts.title;
  const plain = sanitizeHtml(raw, STRIP).replace(/\s+/g, " ").trim();
  const head = `Title: ${opts.title}\n${opts.link ? `URL: ${opts.link}\n` : ""}\n`;
  return (head + plain).slice(0, max);
}

/** Sanitize model output for HTML display (plain text only). */
export function sanitizeSummaryText(text: string, max = 4000): string {
  return sanitizeHtml(text, STRIP).replace(/\s+/g, " ").trim().slice(0, max);
}
