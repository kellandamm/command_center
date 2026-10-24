import type { AttentionItem } from "./types";

export function applyPinnedFirst(items: AttentionItem[], pinnedIds: readonly string[]): AttentionItem[] {
  const pin = new Set(pinnedIds);
  const pinned = items.filter((i) => pin.has(i.id));
  const rest = items.filter((i) => !pin.has(i.id));
  return [...pinned.map((i) => ({ ...i, pinned: true })), ...rest];
}

export function takeSectionItems(items: AttentionItem[], limit = 3): AttentionItem[] {
  return items.slice(0, limit);
}
