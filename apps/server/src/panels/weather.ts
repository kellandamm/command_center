import { fetchOpenMeteo } from "../weather/open-meteo";
import type { PanelModule } from "./types";

export const weatherPanel: PanelModule = {
  id: "weather",
  title: "Weather",
  dashboardHtml: `
<section class="card" id="panel-weather">
  <h2 style="margin:0 0 8px">Weather</h2>
  <p class="dim" id="weather-status">Loading…</p>
  <div id="weather-body"></div>
</section>`,
  async handle(ctx, req, res, path) {
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(data));
    };
    if (path === "/api/weather" && req.method === "GET") {
      try {
        const weather = await fetchOpenMeteo(ctx.cfg.weatherLat, ctx.cfg.weatherLon, ctx.cfg.tz);
        json(200, {
          ok: true,
          lat: ctx.cfg.weatherLat,
          lon: ctx.cfg.weatherLon,
          weather,
        });
      } catch (err) {
        json(200, {
          ok: false,
          lat: ctx.cfg.weatherLat,
          lon: ctx.cfg.weatherLon,
          error: err instanceof Error ? err.message : "weather fetch failed",
        });
      }
      return true;
    }
    return false;
  },
};

export function weatherDashboardScript(): string {
  return `
function renderWeather(r){
  var st=document.getElementById("weather-status");
  var body=document.getElementById("weather-body");
  if(!r.ok){
    st.textContent=r.error||"Weather unavailable";
    body.innerHTML="";
    return;
  }
  var w=r.weather;
  var cur=w.current.temperatureC;
  var unit="°C";
  st.textContent=w.label+" · "+(w.latitude.toFixed(2))+", "+(w.longitude.toFixed(2));
  var hi=w.today.highC, lo=w.today.lowC;
  var wind=w.current.windKmh;
  body.innerHTML='<p style="font-size:1.6rem;margin:.2em 0">'+(cur!=null?Math.round(cur)+unit:"—")+'</p>'
    +'<p class="dim" style="margin:0">Today '
    +(hi!=null&&lo!=null?Math.round(lo)+'–'+Math.round(hi)+unit:"")
    +(wind!=null?' · Wind '+Math.round(wind)+' km/h':'')+'</p>';
}
function loadWeather(){return api("/api/weather").then(renderWeather)}
loadWeather();
`;
}
