import { Editor, Node, nodeInputRule, nodePasteRule } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { marked } from "marked";

declare global {
  interface Window {
    notesEditor: {
      load: (content: string) => boolean;
      format: (kind: string) => void;
    };
  }
}

const source = document.getElementById("knowledge-body") as HTMLTextAreaElement;
const container = document.getElementById("knowledge-rich")!;
const warning = document.getElementById("knowledge-editor-warning")!;
const fieldset = document.getElementById("knowledge-fields") as HTMLFieldSetElement;
const insertion = document.getElementById("knowledge-insert-menu")!;
const commands = [["heading", "Heading"], ["bullet", "List"], ["task", "Checklist"], ["quote", "Quote"], ["code", "Code block"], ["table", "Table"]];
function slashPosition(): number | null {
  const { $from, empty } = editor.state.selection;
  return empty && $from.parent.type.name === "paragraph" && $from.parent.textContent === "/" && $from.parentOffset === 1 ? $from.pos : null;
}
function showInsertion() {
  insertion.hidden = fieldset.disabled || slashPosition() === null || document.getElementById("knowledge-writing")?.dataset.mode !== "write";
}
for (const [kind, label] of commands) {
  const button = document.createElement("button");
  button.type = "button"; button.className = "ghost"; button.textContent = label!;
  button.onclick = () => {
    const position = slashPosition();
    insertion.hidden = true;
    if (fieldset.disabled || position === null) return;
    editor.chain().deleteRange({ from: position - 1, to: position }).run();
    window.notesEditor.format(kind!);
  };
  insertion.append(button);
}
insertion.addEventListener("keydown", (event) => {
  const buttons = Array.from(insertion.querySelectorAll("button")), index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (event.key === "Escape") { event.preventDefault(); insertion.hidden = true; editor.commands.focus(); }
  if (["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(event.key)) {
    event.preventDefault();
    buttons[(index + (["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : buttons.length - 1)) % buttons.length]?.focus();
  }
});
const WikiLink = Node.create({
  name: "wikiLink", inline: true, group: "inline", atom: true,
  addAttributes: () => ({ title: { default: "" } }),
  parseHTML: () => [{ tag: "span[data-wiki-link]" }],
  renderHTML: ({ node }) => ["span", { "data-wiki-link": node.attrs.title }, `[[${node.attrs.title}]]`],
  renderText: ({ node }) => `[[${node.attrs.title}]]`,
  markdownTokenizer: {
    name: "wikiLink", level: "inline", start: (text) => text.indexOf("[["),
    tokenize: (text) => {
      const match = /^\[\[([^\]\n]+)\]\]/.exec(text);
      return match ? { type: "wikiLink", raw: match[0], text: match[1] } : undefined;
    },
  },
  parseMarkdown: (token) => ({ type: "wikiLink", attrs: { title: token.text } }),
  renderMarkdown: (node) => `[[${node.attrs?.title ?? ""}]]`,
  addInputRules() {
    return [nodeInputRule({ find: /\[\[([^\]\n]+)\]\]$/, type: this.type, getAttributes: (match) => ({ title: match[1] }) })];
  },
  addPasteRules() {
    return [nodePasteRule({ find: /\[\[([^\]\n]+)\]\]/g, type: this.type, getAttributes: (match) => ({ title: match[1] }) })];
  },
});
function createEditor(content = ""): Editor {
  return new Editor({
    element: container,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: false }, underline: false }),
      Markdown, WikiLink, TableKit, TaskList, TaskItem.configure({ nested: true }),
    ],
    content, contentType: "markdown",
    editable: !fieldset.disabled,
    editorProps: {
      attributes: { role: "textbox", "aria-label": "Note document", "aria-multiline": "true", "aria-description": "Type / in an empty paragraph to insert a block. Use Arrow Down to choose." },
      handleKeyDown: (_view, event) => {
        if (insertion.hidden) return false;
        if (event.key === "ArrowDown") { insertion.querySelector("button")?.focus(); return true; }
        if (event.key === "Escape") { insertion.hidden = true; return true; }
        return false;
      },
    },
    onSelectionUpdate: () => { if (slashPosition() === null) insertion.hidden = true; },
    onUpdate: () => {
      if (document.getElementById("knowledge-writing")?.dataset.mode !== "write") return;
      source.value = editor.getMarkdown();
      source.dispatchEvent(new Event("input", { bubbles: true }));
      showInsertion();
    },
  });
}
let editor = createEditor();

window.notesEditor = {
  load(content) {
    insertion.hidden = true;
    let unsupported = /^(---|\+\+\+)\s*\n|^\[\^[^\]]+\]:/m.test(content);
    marked.walkTokens(marked.lexer(content), (token) => {
      if (token.type === "html" || token.type === "image") unsupported = true;
    });
    if (unsupported) {
      warning.textContent = "This note uses markup that formatted editing cannot preserve yet. Edit in Source; your original content is unchanged.";
      return false;
    }
    try {
      // History belongs to this document, never the previously selected note.
      editor.destroy();
      container.replaceChildren();
      editor = createEditor(content);
      warning.textContent = "";
      return true;
    } catch {
      warning.textContent = "This document could not be opened safely in Write. Use Source to edit the original Markdown.";
      return false;
    }
  },
  format(kind) {
    const chain = editor.chain().focus();
    switch (kind) {
      case "heading": chain.toggleHeading({ level: 2 }).run(); break;
      case "bold": chain.toggleBold().run(); break;
      case "italic": chain.toggleItalic().run(); break;
      case "bullet": chain.toggleBulletList().run(); break;
      case "task": chain.toggleTaskList().run(); break;
      case "quote": chain.toggleBlockquote().run(); break;
      case "code": chain.toggleCodeBlock().run(); break;
      case "undo": chain.undo().run(); break;
      case "redo": chain.redo().run(); break;
      case "table": chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); break;
      case "link": {
        const url = prompt("Link URL (https://...)");
        if (url === null) return;
        if (!url.trim()) { chain.unsetLink().run(); return; }
        try {
          const parsed = new URL(url);
          if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
          chain.extendMarkRange("link").setLink({ href: parsed.href }).run();
        } catch { warning.textContent = "Enter a valid HTTP or HTTPS link without embedded credentials."; }
        break;
      }
    }
  },
};
const observe = () => {
  if (!editor.isDestroyed) editor.setEditable(!fieldset.disabled, false);
  if (fieldset.disabled) insertion.hidden = true;
};
new MutationObserver(observe).observe(fieldset, { attributes: true, attributeFilter: ["disabled"] });
observe();
