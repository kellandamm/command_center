import sanitizeHtml from "sanitize-html";

function stripTags(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, " ").trim();
}

/** Lightweight readability-style extraction without extra dependencies. */
export function extractArticleText(html: string, contentType = ""): string {
  const lower = contentType.toLowerCase();
  if (!lower.includes("html") && !/<[a-z][\s\S]*>/i.test(html)) {
    return stripTags(html).slice(0, 40_000);
  }
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const candidates: string[] = [];
  for (const pattern of [
    /<article[^>]*>([\s\S]*?)<\/article>/gi,
    /<main[^>]*>([\s\S]*?)<\/main>/gi,
    /<div[^>]+class="[^"]*\bpost-content\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
  ]) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(withoutNoise))) candidates.push(match[1]!);
  }
  const bodyMatch = withoutNoise.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) candidates.push(bodyMatch[1]!);
  candidates.push(withoutNoise);
  const best = candidates
    .map((chunk) => stripTags(chunk))
    .sort((a, b) => b.length - a.length)[0] ?? "";
  return best.slice(0, 40_000);
}
