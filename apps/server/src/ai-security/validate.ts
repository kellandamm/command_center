import { ValidationError } from "../settings";
import type { AiSecurityItem, AiSecurityRoundup } from "./types";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MIN_ITEMS = 6;
const MAX_ITEMS = 10;
const TITLE_MAX = 200;
const SUMMARY_MIN = 20;
const SUMMARY_MAX = 500;
const URL_MAX = 2048;

function isValidCalendarDay(day: string): boolean {
  if (!DAY_RE.test(day)) return false;
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d!;
}

function sentenceCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const parts = trimmed.split(/[.!?]+/).map((p) => p.trim()).filter(Boolean);
  return parts.length;
}

function parseHttpUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ValidationError("sourceUrl must be a valid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new ValidationError("sourceUrl must use http or https");
  }
  if (raw.length > URL_MAX) throw new ValidationError(`sourceUrl must be at most ${URL_MAX} characters`);
  return u;
}

function parseItem(raw: unknown, index: number): AiSecurityItem {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ValidationError(`items[${index}] must be an object`);
  }
  const o = raw as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title.trim() : "";
  if (!title || title.length > TITLE_MAX) {
    throw new ValidationError(`items[${index}].title is required (max ${TITLE_MAX} characters)`);
  }
  const summary = typeof o.summary === "string" ? o.summary.trim() : "";
  if (summary.length < SUMMARY_MIN || summary.length > SUMMARY_MAX) {
    throw new ValidationError(`items[${index}].summary must be ${SUMMARY_MIN}–${SUMMARY_MAX} characters`);
  }
  const sc = sentenceCount(summary);
  if (sc < 1 || sc > 2) {
    throw new ValidationError(`items[${index}].summary must be 1–2 sentences`);
  }
  const sourceUrl = typeof o.sourceUrl === "string" ? o.sourceUrl.trim() : "";
  parseHttpUrl(sourceUrl);
  const date = typeof o.date === "string" ? o.date.trim() : "";
  if (!isValidCalendarDay(date)) {
    throw new ValidationError(`items[${index}].date must be YYYY-MM-DD`);
  }
  return { title, summary, sourceUrl, date };
}

/** Validate inbound publish payload at the trust boundary. */
export function parsePublishPayload(body: unknown): Omit<AiSecurityRoundup, "publishedAt"> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ValidationError("body must be an object");
  }
  const o = body as Record<string, unknown>;
  const weekOf = typeof o.weekOf === "string" ? o.weekOf.trim() : "";
  if (!isValidCalendarDay(weekOf)) {
    throw new ValidationError("weekOf must be YYYY-MM-DD (Monday of the covered week)");
  }
  if (!Array.isArray(o.items)) throw new ValidationError("items must be an array");
  if (o.items.length < MIN_ITEMS || o.items.length > MAX_ITEMS) {
    throw new ValidationError(`items must contain ${MIN_ITEMS}–${MAX_ITEMS} entries`);
  }
  const items = o.items.map((it, i) => parseItem(it, i));
  return { weekOf, items };
}

export function assertStoredRoundup(rec: AiSecurityRoundup): void {
  parsePublishPayload(rec);
  if (typeof rec.publishedAt !== "string" || Number.isNaN(Date.parse(rec.publishedAt))) {
    throw new ValidationError("publishedAt must be a valid ISO timestamp");
  }
}
