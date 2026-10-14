/** WMO weather interpretation codes (subset). See https://open-meteo.com/en/docs */
const WMO_LABELS: Record<number, string> = {
  0: "Clear",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Dense drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  80: "Rain showers",
  81: "Rain showers",
  82: "Violent rain showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Thunderstorm with heavy hail",
};

export function weatherCodeLabel(code: number | null | undefined): string {
  if (code == null || !Number.isFinite(code)) return "Unknown";
  return WMO_LABELS[code] ?? `Code ${code}`;
}

export interface WeatherSnapshot {
  latitude: number;
  longitude: number;
  timezone: string;
  current: {
    temperatureC: number | null;
    weatherCode: number | null;
    windKmh: number | null;
    observedAt: string | null;
  };
  today: {
    highC: number | null;
    lowC: number | null;
    weatherCode: number | null;
  };
  label: string;
}

export async function fetchOpenMeteo(
  lat: number,
  lon: number,
  tz: string,
  fetchFn: typeof fetch = fetch,
): Promise<WeatherSnapshot> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    timezone: tz,
    forecast_days: "1",
    current: "temperature_2m,weather_code,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  const res = await fetchFn(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`);
  const j = (await res.json()) as {
    latitude?: number;
    longitude?: number;
    timezone?: string;
    current?: { temperature_2m?: number; weather_code?: number; wind_speed_10m?: number; time?: string };
    daily?: { weather_code?: number[]; temperature_2m_max?: number[]; temperature_2m_min?: number[] };
  };
  const code = j.current?.weather_code ?? j.daily?.weather_code?.[0] ?? null;
  return {
    latitude: j.latitude ?? lat,
    longitude: j.longitude ?? lon,
    timezone: j.timezone ?? tz,
    current: {
      temperatureC: j.current?.temperature_2m ?? null,
      weatherCode: j.current?.weather_code ?? null,
      windKmh: j.current?.wind_speed_10m ?? null,
      observedAt: j.current?.time ?? null,
    },
    today: {
      highC: j.daily?.temperature_2m_max?.[0] ?? null,
      lowC: j.daily?.temperature_2m_min?.[0] ?? null,
      weatherCode: j.daily?.weather_code?.[0] ?? null,
    },
    label: weatherCodeLabel(code),
  };
}
