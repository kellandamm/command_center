import sanitizeHtml from "sanitize-html";

/** Strip raw HTML from imported Markdown while keeping Markdown syntax. */
export function sanitizeImportedMarkdown(content: string): string {
  return sanitizeHtml(content, {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: "discard",
  });
}
