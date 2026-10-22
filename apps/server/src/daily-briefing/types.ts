import type { CalendarEvent } from "../calendar/parse-ics";
import type { WeatherSnapshot } from "../weather/open-meteo";

export type SourceStatus = "ok" | "empty" | "error" | "not_configured";

export interface SourceBlock<T> {
  status: SourceStatus;
  message?: string;
  data?: T;
}

export interface BriefingArticle {
  title: string;
  url: string;
  excerpt: string;
}

export interface BriefingTopic {
  keyword: string;
  status: SourceStatus;
  summary?: string;
  message?: string;
  articles: BriefingArticle[];
}

export interface DailyBriefingSources {
  weather: SourceBlock<{ weather: WeatherSnapshot; lat: number; lon: number }>;
  calendar: SourceBlock<{ events: CalendarEvent[] }>;
  topics: SourceBlock<{ items: BriefingTopic[] }>;
}

export interface DailyBriefingRecord {
  day: string;
  generatedAt: string;
  trigger: "schedule" | "manual";
  sources: DailyBriefingSources;
}
