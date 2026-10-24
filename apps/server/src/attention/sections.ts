import { DONE, type BoardCard } from "../board/types";
import type { KnowledgeNote, KnowledgeSource } from "../notes/store";
import type { Win } from "../wins/types";
import { pickRediscover, daysBetween, type StaleCandidate } from "./rediscover";
import { buildSessions, sessionPrimaryItem, sessionReason } from "./sessions";
import { applyPinnedFirst, takeSectionItems } from "./rank";
import type { AttentionItem, AttentionSection, TimelineEvent } from "./types";

const SECTION_LIMIT = 3;

function cardItem(card: BoardCard, reason: string): AttentionItem {
  return { id: `card:${card.id}`, kind: "card", title: card.title, href: "/agent?view=board", reason };
}

function noteItem(note: KnowledgeNote, reason: string): AttentionItem {
  return { id: `note:${note.id}`, kind: "note", title: note.title, href: "/notes", reason };
}

function sourceItem(source: KnowledgeSource, reason: string): AttentionItem {
  return { id: `source:${source.id}`, kind: "source", title: source.title, href: `/library/${encodeURIComponent(source.id)}`, reason };
}

function winItem(win: Win, reason: string): AttentionItem {
  return { id: `win:${win.id}`, kind: "win", title: win.title, href: "/agent?view=wins", reason };
}

function dueReason(card: BoardCard, todayYmd: string): string {
  if (!card.dueDate) return "no due date";
  if (card.dueDate < todayYmd) {
    const days = Math.round(
      (Date.parse(`${todayYmd}T12:00:00Z`) - Date.parse(`${card.dueDate}T12:00:00Z`)) / 86_400_000,
    );
    return days <= 1 ? "overdue" : `overdue by ${days} days`;
  }
  if (card.dueDate === todayYmd) return "due today";
  const diff = Math.round((Date.parse(`${card.dueDate}T12:00:00Z`) - Date.parse(`${todayYmd}T12:00:00Z`)) / 86_400_000);
  return diff === 1 ? "due tomorrow" : `due in ${diff} days`;
}

function anniversaryReason(createdAt: string, todayYmd: string, tz: string): string {
  const created = new Date(createdAt);
  const today = new Date(`${todayYmd}T12:00:00Z`);
  const years = today.getUTCFullYear() - created.getUTCFullYear();
  if (years >= 1) return years === 1 ? "created 1 year ago today" : `created ${years} years ago today`;
  const label = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(created);
  return `from ${label}`;
}

function matchesOnThisDay(createdAt: string, todayYmd: string, tz: string): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "numeric", day: "numeric", year: "numeric" });
  const parts = (d: Date) => {
    const p = fmt.formatToParts(d);
    const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
    return { month: get("month"), day: get("day"), year: get("year") };
  };
  const today = parts(new Date(`${todayYmd}T12:00:00Z`));
  const created = parts(new Date(createdAt));
  if (created.month === today.month && created.day === today.day && created.year !== today.year) return true;
  const weekAgo = new Date(`${todayYmd}T12:00:00Z`);
  weekAgo.setUTCDate(weekAgo.getUTCDate() - 7);
  const monthAgo = new Date(`${todayYmd}T12:00:00Z`);
  monthAgo.setUTCMonth(monthAgo.getUTCMonth() - 1);
  const sameDay = (a: Date, b: Date) => {
    const pa = parts(a);
    const pb = parts(b);
    return pa.month === pb.month && pa.day === pb.day;
  };
  return sameDay(new Date(createdAt), weekAgo) || sameDay(new Date(createdAt), monthAgo);
}

export interface ComposeInput {
  todayYmd: string;
  tz: string;
  nowMs: number;
  cards: BoardCard[];
  notes: KnowledgeNote[];
  sources: KnowledgeSource[];
  wins: Win[];
  timeline: TimelineEvent[];
  pinned: string[];
  hidden: Set<string>;
  isSnoozed: (id: string) => boolean;
}

export function composeAttentionSections(input: ComposeInput): AttentionSection[] {
  const used = new Set<string>();
  const sections: AttentionSection[] = [];

  const take = (items: AttentionItem[]) => {
    const visible = items.filter((i) => !input.isSnoozed(i.id) && !used.has(i.id));
    const ranked = applyPinnedFirst(visible, input.pinned);
    const picked = takeSectionItems(ranked, SECTION_LIMIT);
    for (const i of picked) used.add(i.id);
    return picked;
  };

  const dueCards = input.cards
    .filter((c) => c.column !== DONE && c.dueDate && c.dueDate <= input.todayYmd)
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : 0));
  sections.push({
    id: "due",
    title: "Due or overdue",
    items: take(dueCards.map((c) => cardItem(c, dueReason(c, input.todayYmd)))),
  });

  const sessions = buildSessions(input.timeline).sort((a, b) => b.end.localeCompare(a.end));
  const continueItems: AttentionItem[] = [];
  for (const session of sessions) {
    const primary = sessionPrimaryItem(session);
    const id = primary.kind === "note" ? `note:${primary.refId}` : `card:${primary.refId}`;
    if (used.has(id)) continue;
    const reason = sessionReason(session, input.todayYmd, input.tz);
    if (primary.kind === "note") {
      const note = input.notes.find((n) => n.id === primary.refId);
      if (note) continueItems.push(noteItem(note, reason));
    } else {
      const card = input.cards.find((c) => c.id === primary.refId);
      if (card) continueItems.push(cardItem(card, reason));
    }
  }
  sections.push({ id: "continue", title: "Continue working", items: take(continueItems) });

  const onThisDay: AttentionItem[] = [];
  for (const note of input.notes) {
    if (input.hidden.has(`note:${note.id}`)) continue;
    if (!matchesOnThisDay(note.createdAt, input.todayYmd, input.tz)) continue;
    onThisDay.push(noteItem(note, anniversaryReason(note.createdAt, input.todayYmd, input.tz)));
  }
  for (const source of input.sources) {
    if (input.hidden.has(`source:${source.id}`)) continue;
    if (!matchesOnThisDay(source.createdAt, input.todayYmd, input.tz)) continue;
    onThisDay.push(sourceItem(source, anniversaryReason(source.createdAt, input.todayYmd, input.tz)));
  }
  for (const win of input.wins) {
    if (input.hidden.has(`win:${win.id}`)) continue;
    if (!matchesOnThisDay(win.at, input.todayYmd, input.tz)) continue;
    onThisDay.push(winItem(win, anniversaryReason(win.at, input.todayYmd, input.tz)));
  }
  sections.push({ id: "on-this-day", title: "On this day", items: take(onThisDay) });

  const stale: StaleCandidate[] = [];
  for (const note of input.notes) {
    const id = `note:${note.id}`;
    if (input.hidden.has(id)) continue;
    const days = daysBetween(note.updatedAt, input.nowMs);
    if (days >= 90) stale.push({ id, title: note.title, href: "/notes", untouchedDays: days });
  }
  for (const source of input.sources) {
    const id = `source:${source.id}`;
    if (input.hidden.has(id)) continue;
    const days = daysBetween(source.updatedAt, input.nowMs);
    if (days >= 90) stale.push({ id, title: source.title, href: `/library/${encodeURIComponent(source.id)}`, untouchedDays: days });
  }
  const rediscover = pickRediscover(stale, input.todayYmd, 12).map((c) => ({
    id: c.id,
    kind: c.id.startsWith("note:") ? "note" as const : "source" as const,
    title: c.title,
    href: c.href,
    reason: `untouched for ${c.untouchedDays} days`,
  }));
  sections.push({ id: "rediscover", title: "Rediscover", items: take(rediscover) });

  return sections;
}
