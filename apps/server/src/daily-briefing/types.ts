import type { BoardCard } from "../board/types";
import type { CardMoveEvent } from "../board/types";
import type { CalendarEvent } from "../calendar/parse-ics";
import type { GithubActivitySnapshot } from "../github/activity";
import type { TodoistTask } from "../todoist/client";
import type { WeatherSnapshot } from "../weather/open-meteo";
import type { Win } from "../wins/types";

export type SourceStatus = "ok" | "empty" | "error" | "not_configured";

export interface SourceBlock<T> {
  status: SourceStatus;
  message?: string;
  data?: T;
}

export interface DailyBriefingTodoist {
  overdue: TodoistTask[];
  today: TodoistTask[];
}

export interface DailyBriefingBoard {
  blocked: BoardCard[];
  moved: CardMoveEvent[];
  wins: Win[];
}

export interface DailyBriefingSources {
  todoist: SourceBlock<DailyBriefingTodoist>;
  weather: SourceBlock<{ weather: WeatherSnapshot; lat: number; lon: number }>;
  calendar: SourceBlock<{ events: CalendarEvent[] }>;
  github: SourceBlock<{ activity: GithubActivitySnapshot }>;
  board: SourceBlock<DailyBriefingBoard>;
}

export interface DailyBriefingRecord {
  day: string;
  generatedAt: string;
  trigger: "schedule" | "manual";
  sources: DailyBriefingSources;
}
