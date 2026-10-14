import type { CalendarEvent } from "../calendar/parse-ics";
import type { GithubActivitySnapshot } from "../github/activity";
import type { StoredItem } from "../feeds/store";
import type { TodoistTask } from "../todoist/client";
import type { WeatherSnapshot } from "../weather/open-meteo";

export type SourceStatus = "ok" | "empty" | "error" | "not_configured";

export interface SourceBlock<T> {
  status: SourceStatus;
  message?: string;
  data?: T;
}

export interface DailyBriefingNews {
  items: StoredItem[];
  itemCount: number;
}

export interface DailyBriefingTodoist {
  overdue: TodoistTask[];
  today: TodoistTask[];
}

export interface DailyBriefingAi {
  content: string;
  itemCount: number;
}

export interface DailyBriefingSources {
  news: SourceBlock<DailyBriefingNews>;
  ai: SourceBlock<DailyBriefingAi>;
  todoist: SourceBlock<DailyBriefingTodoist>;
  weather: SourceBlock<{ weather: WeatherSnapshot; lat: number; lon: number }>;
  calendar: SourceBlock<{ events: CalendarEvent[] }>;
  github: SourceBlock<{ activity: GithubActivitySnapshot }>;
}

export interface DailyBriefingRecord {
  day: string;
  generatedAt: string;
  trigger: "schedule" | "manual";
  sources: DailyBriefingSources;
}
