export type TaskSource = "board" | "todoist";

export interface DayPlanCapacity {
  availableMinutes: number;
  meetingMinutes: number;
  blockedTaskMinutes: number;
  unscheduledTaskMinutes: number;
  overByMinutes: number;
}

export interface DayPlanTaskRef {
  source: TaskSource;
  id: string;
  title: string;
  priority: number;
  dueDay: string | null;
  estimateMinutes: number | null;
  scheduled: boolean;
}

export interface DayPlanMustDo {
  slot: number;
  source: TaskSource;
  refId: string;
  title: string;
  userLocked: boolean;
  completedAt: string | null;
}

export interface DayPlanItem {
  id: string;
  kind: "meeting" | "block" | "break" | "task";
  source: TaskSource | null;
  refId: string | null;
  title: string;
  startIso: string | null;
  endIso: string | null;
  sortOrder: number;
  completedAt: string | null;
}

export interface DayPlanSourceFlags {
  calendarUnavailable: boolean;
  todoistUnavailable: boolean;
}

export interface DayPlanSnapshot {
  day: string;
  timezone: string;
  workStart: string;
  workEnd: string;
  generatedAt: string;
  generatedBy: "deterministic" | "llm";
  theme: string | null;
  capacity: DayPlanCapacity;
  sources: DayPlanSourceFlags;
  mustDos: DayPlanMustDo[];
  items: DayPlanItem[];
  alternates: DayPlanTaskRef[];
  rolledToTomorrow: DayPlanTaskRef[];
}
