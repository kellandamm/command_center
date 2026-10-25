import type { DailyBriefingRecord } from "../daily-briefing/types";
import { weatherCodeLabel } from "../weather/open-meteo";

function fahrenheit(c: number): number {
  return Math.round((c * 9) / 5 + 32);
}

export function briefingDigestLines(rec: DailyBriefingRecord): string[] {
  const lines: string[] = [];
  const cal = rec.sources.calendar;
  if (cal.status === "ok" && cal.data?.events.length) {
    const n = cal.data.events.length;
    const first = cal.data.events[0]!.summary;
    lines.push(n === 1 ? `1 event today: ${first}` : `${n} events today; next: ${first}`);
  } else if (cal.status === "empty") {
    lines.push("No calendar events in today's window.");
  }
  const weather = rec.sources.weather;
  if (weather.status === "ok" && weather.data?.weather) {
    const w = weather.data.weather;
    if (w.today.highC != null && w.today.lowC != null) {
      lines.push(`Weather: ${fahrenheit(w.today.lowC)}–${fahrenheit(w.today.highC)}°F, ${weatherCodeLabel(w.today.weatherCode)}`);
    } else if (w.current.temperatureC != null) {
      lines.push(`Weather: ${fahrenheit(w.current.temperatureC)}°F now, ${w.label}`);
    }
  }
  const topics = rec.sources.topics;
  if (topics.status === "ok" && topics.data?.items.length) {
    const headlines = topics.data.items
      .filter((item) => item.status === "ok" && item.summary)
      .slice(0, 2)
      .map((item) => item.keyword);
    if (headlines.length) lines.push(`Topics: ${headlines.join(", ")}`);
  }
  if (!lines.length) lines.push("Your daily briefing is ready.");
  return lines.slice(0, 3);
}
