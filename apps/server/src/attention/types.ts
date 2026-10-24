export type AttentionItemKind = "card" | "note" | "source" | "win";

export interface AttentionItem {
  id: string;
  kind: AttentionItemKind;
  title: string;
  href: string;
  reason: string;
  pinned?: boolean;
}

export interface AttentionSection {
  id: "due" | "continue" | "on-this-day" | "rediscover";
  title: string;
  items: AttentionItem[];
}

export interface TimelineEvent {
  at: string;
  kind: "note" | "card";
  refId: string;
  title: string;
}
