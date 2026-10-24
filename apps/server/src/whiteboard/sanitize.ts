import { ValidationError } from "../settings";

/** Max serialized scene JSON accepted from clients (after sanitization). */
export const MAX_WHITEBOARD_SCENE_BYTES = 2_000_000;
/** Max embedded file blobs kept in a scene. */
export const MAX_WHITEBOARD_FILES = 24;
/** Per-file data URL cap (base64 payload). */
export const MAX_WHITEBOARD_FILE_BYTES = 400_000;

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

function remoteDataUrl(value: string): boolean {
  const lower = value.slice(0, 64).toLowerCase();
  return lower.startsWith("http://") || lower.startsWith("https://");
}

function sanitizeFiles(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return {};
  const out: Record<string, unknown> = {};
  let kept = 0;
  for (const [id, file] of Object.entries(raw)) {
    if (kept >= MAX_WHITEBOARD_FILES) break;
    if (!isRecord(file)) continue;
    const dataURL = typeof file.dataURL === "string" ? file.dataURL : "";
    if (dataURL && remoteDataUrl(dataURL)) continue; // shortcut: drop remote image URLs
    if (dataURL.startsWith("data:") && Buffer.byteLength(dataURL, "utf8") > MAX_WHITEBOARD_FILE_BYTES) continue;
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
  const filteredElements = elements.filter((el) => {
    if (!isRecord(el)) return false;
    if (el.type === "image" && typeof el.fileId === "string" && !keptFileIds.has(el.fileId)) return false;
    return true;
  });
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
