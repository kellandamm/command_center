import { basename, dirname } from "node:path";

const NOTION_HEX_SUFFIX = /\s+[0-9a-f]{32}$/i;

export function stripNotionHexFromBasename(name: string): string {
  const withoutExt = name.replace(/\.(md|markdown)$/i, "");
  const stripped = withoutExt.replace(NOTION_HEX_SUFFIX, "").trim();
  return stripped || withoutExt.trim() || "Untitled";
}

export function titleFromMarkdownPath(zipPath: string): string {
  const file = basename(zipPath);
  const raw = file.replace(/\.(md|markdown)$/i, "");
  return stripNotionHexFromBasename(raw);
}

export function normalizeWikiLinks(content: string): string {
  return content.replace(/\[\[([^\]|]+)\|[^\]]+\]\]/g, "[[$1]]");
}

export interface ParsedFrontmatter {
  title?: string;
  tags?: string[];
  body: string;
}

export function parseYamlFrontmatter(content: string): ParsedFrontmatter {
  if (!content.startsWith("---\n")) return { body: content };
  const end = content.indexOf("\n---\n", 4);
  if (end < 0) return { body: content };
  const header = content.slice(4, end);
  const body = content.slice(end + 5);
  let title: string | undefined;
  const tagList: string[] = [];
  for (const line of header.split("\n")) {
    const titleMatch = /^title:\s*(.+)$/.exec(line);
    if (titleMatch) {
      const raw = titleMatch[1]!.trim();
      try {
        title = JSON.parse(raw) as string;
      } catch {
        title = raw.replace(/^['"]|['"]$/g, "");
      }
      continue;
    }
    const tagsMatch = /^tags:\s*(.+)$/.exec(line);
    if (tagsMatch) {
      const raw = tagsMatch[1]!.trim();
      if (raw.startsWith("[")) {
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed)) tagList.push(...parsed.map(String));
        } catch { /* shortcut: ignore malformed tags line */ }
      } else {
        tagList.push(raw.replace(/^['"]|['"]$/g, ""));
      }
    }
  }
  return { title, tags: tagList.length ? tagList : undefined, body };
}

export interface FolderMapping {
  spaceName: string | null;
  extraTags: string[];
}

export function folderMappingForPath(zipPath: string): FolderMapping {
  const dir = dirname(zipPath);
  if (dir === "." || dir === "") return { spaceName: null, extraTags: [] };
  const segments = dir.split("/").filter(Boolean);
  if (!segments.length) return { spaceName: null, extraTags: [] };
  const [spaceName, ...rest] = segments;
  return {
    spaceName,
    extraTags: rest.map((part) => part.toLowerCase()),
  };
}

export function safeExportFileName(title: string): string {
  const cleaned = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "Untitled";
  return cleaned.slice(0, 120);
}
