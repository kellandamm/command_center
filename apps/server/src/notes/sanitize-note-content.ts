import sanitizeHtml from "sanitize-html";

/** Strip raw HTML from imported Markdown while keeping Markdown syntax. */
export function sanitizeImportedMarkdown(content: string): string {
  const withoutScripts = content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  return sanitizeHtml(withoutScripts, {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: "discard",
  });
}
