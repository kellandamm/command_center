import { fetchOpenMeteo } from "../weather/open-meteo";
import { loadingState, panelCard } from "../ui/components";
import type { PanelModule } from "./types";

export const weatherPanel: PanelModule = {
  id: "weather",
  title: "Weather",
  dashboardHtml: panelCard("panel-weather", `
  <div id="weather-status-wrap">${loadingState()}</div>
  <div id="weather-body"></div>`),
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
  var stWrap=document.getElementById("weather-status-wrap");
  var body=document.getElementById("weather-body");
  if(!r.ok){
    if(stWrap)stWrap.innerHTML='<div class="ui-error" role="alert"><p class="ui-error-text bad">'+esc(r.error||"Weather unavailable")+'</p></div>';
    if(body)body.innerHTML="";
    return;
  }
  var w=r.weather;
  var cur=w.current.temperatureC;
  var unit="°C";
  if(stWrap)stWrap.innerHTML='<p class="dim" id="weather-status">'+esc(w.label)+" · "+(w.latitude.toFixed(2))+", "+(w.longitude.toFixed(2))+'</p>';
  var hi=w.today.highC, lo=w.today.lowC;
  var wind=w.current.windKmh;
  if(body)body.innerHTML='<p class="weather-temp">'+(cur!=null?Math.round(cur)+unit:"—")+'</p>'
    +'<p class="dim weather-meta">Today '
    +(hi!=null&&lo!=null?Math.round(lo)+'–'+Math.round(hi)+unit:"")
    +(wind!=null?' · Wind '+Math.round(wind)+' km/h':'')+'</p>';
}
function loadWeather(){return api("/api/weather").then(renderWeather)}
loadWeather();
`;
}
