import { XMLParser } from "fast-xml-parser";
import { createHash } from "node:crypto";

export interface OpmlFeed {
  title: string;
  xmlUrl: string;
  htmlUrl?: string;
}

export interface OpmlFolder {
  name: string;
  feeds: OpmlFeed[];
  folders: OpmlFolder[];
}

export interface OpmlDocument {
  folders: OpmlFolder[];
  /** Feeds at document root (no folder). */
  feeds: OpmlFeed[];
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text" });
const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

function outlineTitle(o: Record<string, unknown>): string {
  const t = o["@_text"] ?? o["@_title"];
  return String(t ?? "Untitled").trim() || "Untitled";
}

function parseOutline(node: Record<string, unknown>): OpmlFolder | OpmlFeed | null {
  const type = String(node["@_type"] ?? "").toLowerCase();
  const xmlUrl = node["@_xmlUrl"] ? String(node["@_xmlUrl"]).trim() : "";
  if (type === "rss" && xmlUrl) {
    return {
      title: outlineTitle(node),
      xmlUrl,
      htmlUrl: node["@_htmlUrl"] ? String(node["@_htmlUrl"]).trim() : undefined,
    };
  }
  const children = arr<Record<string, unknown>>(node.outline as Record<string, unknown> | Record<string, unknown>[]);
  const folder: OpmlFolder = { name: outlineTitle(node), feeds: [], folders: [] };
  for (const ch of children) {
    const parsed = parseOutline(ch);
    if (!parsed) continue;
    if ("xmlUrl" in parsed) folder.feeds.push(parsed);
    else folder.folders.push(parsed);
  }
  if (!folder.name && !children.length && !xmlUrl) return null;
  return folder;
}

export function parseOpml(body: string): OpmlDocument {
  const doc = xml.parse(body);
  const bodyNode = doc.opml?.body ?? doc.body;
  if (!bodyNode) throw new Error("invalid OPML: missing body");
  const root: OpmlDocument = { folders: [], feeds: [] };
  for (const o of arr<Record<string, unknown>>(bodyNode.outline)) {
    const parsed = parseOutline(o);
    if (!parsed) continue;
    if ("xmlUrl" in parsed) root.feeds.push(parsed);
    else root.folders.push(parsed);
  }
  return root;
}

export function exportOpml(tree: { folders: Array<{ name: string; feeds: OpmlFeed[]; folders?: OpmlFolder[] }>; feeds: OpmlFeed[] }, title = "Command center feeds"): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const feedLine = (f: OpmlFeed) =>
    `    <outline text="${esc(f.title)}" title="${esc(f.title)}" type="rss" xmlUrl="${esc(f.xmlUrl)}"${f.htmlUrl ? ` htmlUrl="${esc(f.htmlUrl)}"` : ""}/>`;
  const folderBlock = (folder: { name: string; feeds: OpmlFeed[]; folders?: OpmlFolder[] }, indent: string): string => {
    const inner: string[] = [];
    for (const sub of folder.folders ?? []) inner.push(folderBlock(sub, indent + "  "));
    for (const f of folder.feeds) inner.push(indent + feedLine(f).trim());
    return `${indent}<outline text="${esc(folder.name)}" title="${esc(folder.name)}">\n${inner.join("\n")}\n${indent}</outline>`;
  };
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<opml version="1.0">', "  <head>", `    <title>${esc(title)}</title>`, "  </head>", "  <body>"];
  for (const folder of tree.folders) lines.push(folderBlock(folder, "    "));
  for (const f of tree.feeds) lines.push(`    ${feedLine(f).trim()}`);
  lines.push("  </body>", "</opml>");
  return lines.join("\n");
}

export function feedIdFromUrl(xmlUrl: string): string {
  return createHash("sha256").update(xmlUrl).digest("hex").slice(0, 24);
}

/** Stable id from full folder path (supports nested OPML outlines). */
export function folderIdFromPath(pathSegments: string[]): string {
  const path = pathSegments.map((s) => s.trim()).filter(Boolean);
  return createHash("sha256").update(`folder-path\0${path.join("\0")}`).digest("hex").slice(0, 16);
}

/** @deprecated Use folderIdFromPath for imports; kept for migration tests. */
export function folderIdFromName(name: string): string {
  return folderIdFromPath([name]);
}
