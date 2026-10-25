export type QuickAddKind = "task" | "event";

export interface QuickAddItem {
  kind: QuickAddKind;
  title: string;
  due?: string;
  start?: string;
  end?: string;
  durationMinutes?: number;
  notes?: string;
}

export interface QuickAddCommitItem extends QuickAddItem {
  calendarId?: string;
}

export interface QuickAddCommitResult {
  kind: QuickAddKind;
  title: string;
  url: string;
  id: string;
}
