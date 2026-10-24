import { ValidationError } from "../settings";

/** Max serialized scene JSON accepted from clients (after sanitization). */
export const MAX_WHITEBOARD_SCENE_BYTES = 2_000_000;
/** Max embedded file blobs kept in a scene. */
export const MAX_WHITEBOARD_FILES = 24;
/** Per-file data URL cap (base64 payload). */
export const MAX_WHITEBOARD_FILE_BYTES = 400_000;
/** Max bytes for an element `link` or serialized `customData`. */
export const MAX_ELEMENT_LINK_BYTES = 2_048;

const ALLOWED_EMBEDDED_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,/i;

export interface SanitizedWhiteboardScene {
  type: "excalidraw";
  version: number;
  source: string;
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function allowedEmbeddedDataUrl(dataURL: string): boolean {
  if (!ALLOWED_EMBEDDED_IMAGE.test(dataURL)) return false;
  return Buffer.byteLength(dataURL, "utf8") <= MAX_WHITEBOARD_FILE_BYTES;
}

function allowedElementLink(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || Buffer.byteLength(trimmed, "utf8") > MAX_ELEMENT_LINK_BYTES) return undefined;
  if (trimmed.startsWith("//")) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "mailto:") return parsed.toString();
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      if (parsed.username || parsed.password) return undefined;
      return parsed.toString();
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function sanitizeElement(el: Record<string, unknown>): Record<string, unknown> {
  const out = { ...el };
  if ("link" in out) {
    if (typeof out.link !== "string" || Buffer.byteLength(out.link, "utf8") > MAX_ELEMENT_LINK_BYTES) {
      delete out.link;
    } else {
      const safe = allowedElementLink(out.link);
      if (safe) out.link = safe;
      else delete out.link;
    }
  }
  if ("customData" in out) {
    const cd = out.customData;
    const size = typeof cd === "string"
      ? Buffer.byteLength(cd, "utf8")
      : Buffer.byteLength(JSON.stringify(cd), "utf8");
    if (size > MAX_ELEMENT_LINK_BYTES) delete out.customData;
  }
  return out;
}

function sanitizeFiles(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return {};
  const out: Record<string, unknown> = {};
  let kept = 0;
  for (const [id, file] of Object.entries(raw)) {
    if (kept >= MAX_WHITEBOARD_FILES) break;
    if (!isRecord(file)) continue;
    const dataURL = typeof file.dataURL === "string" ? file.dataURL : "";
    if (!dataURL || !allowedEmbeddedDataUrl(dataURL)) continue;
    out[id] = { ...file, dataURL };
    kept += 1;
  }
  return out;
}

/** Validate Excalidraw scene JSON and strip unsafe / oversized embedded assets. */
export function sanitizeWhiteboardScene(raw: unknown): SanitizedWhiteboardScene {
  if (!isRecord(raw)) throw new ValidationError("scene must be an object");
  const elements = raw.elements;
  if (!Array.isArray(elements)) throw new ValidationError("scene.elements must be an array");
  if (elements.length > 8_000) throw new ValidationError("scene has too many elements");
  const files = sanitizeFiles(raw.files);
  const keptFileIds = new Set(Object.keys(files));
  const filteredElements = elements
    .filter((el) => {
      if (!isRecord(el)) return false;
      if (el.type === "image" && typeof el.fileId === "string" && !keptFileIds.has(el.fileId)) return false;
      return true;
    })
    .map((el) => sanitizeElement(el as Record<string, unknown>));
  const appState = isRecord(raw.appState) ? { ...raw.appState } : {};
  // shortcut: never persist collaboration / live session state
  delete appState.collaborators;
  delete appState.isCollaborating;
  const scene: SanitizedWhiteboardScene = {
    type: "excalidraw",
    version: typeof raw.version === "number" && Number.isFinite(raw.version) ? raw.version : 2,
    source: typeof raw.source === "string" ? raw.source.slice(0, 120) : "command-center",
    elements: filteredElements,
    appState,
    files,
  };
  const bytes = Buffer.byteLength(JSON.stringify(scene), "utf8");
  if (bytes > MAX_WHITEBOARD_SCENE_BYTES) {
    throw new ValidationError(`scene exceeds ${MAX_WHITEBOARD_SCENE_BYTES} bytes`);
  }
  return scene;
}
