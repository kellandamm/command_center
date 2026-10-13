import sanitizeHtml from "sanitize-html";

/** Same allowlist the extension uses: keep content and links, drop everything executable or stylistic. */
export function cleanHtmlForLLM(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "h1", "h2", "h3", "h4", "h5", "h6", "p", "a", "em", "strong", "b", "i", "blockquote", "code", "pre",
      "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td", "img", "figure", "figcaption",
      "div", "span", "br", "hr",
    ],
    allowedAttributes: {
      a: ["href", "title"],
      img: ["src", "alt", "title", "width", "height"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    exclusiveFilter: (frame) => !frame.text.trim() && !/^(img|br|hr)$/.test(frame.tag),
  });
}
