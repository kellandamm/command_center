import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

export function renderNoteMarkdown(content: string): string {
  return sanitizeHtml(marked.parse(content, { async: false, gfm: true }), {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      "del", "input",
    ],
    allowedAttributes: {
      a: ["href", "title"],
      code: ["class"],
      input: ["type", "checked", "disabled"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    transformTags: {
      input: (_tagName, attributes) => ({
        tagName: "input",
        attribs: { type: "checkbox", disabled: "", ...(attributes.checked !== undefined ? { checked: "" } : {}) },
      }),
    },
  });
}
