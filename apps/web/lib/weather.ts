import { weatherLabel, type WeatherSnapshot } from "@liendo/shared";

const DAVENPORT = { latitude: 41.5236, longitude: -90.5776 };
const CACHE_TTL_MS = 10 * 60 * 1000;

let cache: { at: number; data: WeatherSnapshot } | null = null;

export async function getWeather(): Promise<WeatherSnapshot | null> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(DAVENPORT.latitude));
    url.searchParams.set("longitude", String(DAVENPORT.longitude));
    url.searchParams.set("current", "temperature_2m,weather_code");
    url.searchParams.set("temperature_unit", "fahrenheit");
    url.searchParams.set("timezone", "America/Chicago");
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return cache?.data ?? null;
    const body = (await res.json()) as {
      current?: { temperature_2m?: number; weather_code?: number };
    };
    const code = body.current?.weather_code ?? 0;
    const data: WeatherSnapshot = {
      temperatureF: Math.round(body.current?.temperature_2m ?? 0),
      weatherCode: code,
      label: weatherLabel(code),
      fetchedAt: new Date().toISOString(),
    };
    cache = { at: Date.now(), data };
    return data;
  } catch {
    return cache?.data ?? null;
  }
}
