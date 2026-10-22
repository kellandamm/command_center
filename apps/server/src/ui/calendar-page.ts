import type { NavLink } from "./layout";
import { page } from "./layout";
import { calendarScript } from "./calendar-script";

export function calendarPage(nav?: NavLink[]): string {
  return page({
    title: "Calendar — Command center",
    active: "/calendar",
    nav,
    body: `<div class="calendar-app">
<header class="calendar-header">
  <div><h1>Calendar</h1><p class="dim">Your calendars, events, and time to focus.</p></div>
  <div class="row"><a class="btn" href="/calendar/event">New event</a><a class="btn ghost" href="/settings/calendars">Calendar settings</a><button type="button" class="ghost" id="cal-refresh">Refresh calendars</button></div>
</header>
<div class="calendar-workspace">
  <aside class="calendar-rail" aria-label="Calendar navigation">
    <div class="calendar-mini-header"><button id="cal-mini-prev" class="ghost" aria-label="Previous mini-calendar month">Prev</button><h2 id="cal-mini-label"></h2><button id="cal-mini-next" class="ghost" aria-label="Next mini-calendar month">Next</button></div>
    <div id="cal-mini" class="calendar-mini" aria-label="Choose a date"></div>
    <label for="cal-search">Search events</label><input id="cal-search" type="search" placeholder="Title, place, or details">
    <h2 class="calendar-rail-heading">Calendars</h2>
    <div id="cal-sources"></div>
    <p class="dim calendar-hint">Add calendars and subscriptions in Settings. Colors identify each calendar.</p>
    <div class="calendar-agenda-head"><h2 id="cal-agenda-title">Agenda</h2><span id="cal-agenda-count" class="dim"></span></div>
    <div id="cal-agenda" class="calendar-agenda"></div>
  </aside>
  <section class="calendar-main" aria-label="Calendar view">
    <div class="calendar-toolbar">
      <div class="row calendar-navigation"><button id="cal-today" class="ghost">Today</button><button id="cal-prev" class="ghost" aria-label="Previous period">Prev</button><button id="cal-next" class="ghost" aria-label="Next period">Next</button><h2 id="cal-week-label" aria-live="polite"></h2></div>
      <div class="calendar-view-switch" role="group" aria-label="Calendar views"><button class="ghost" data-cal-view="day" aria-pressed="false">Day</button><button class="ghost" data-cal-view="week" aria-pressed="true">Week</button><button class="ghost" data-cal-view="month" aria-pressed="false">Month</button></div>
    </div>
    <div class="calendar-status-row"><p id="calendar-status-full" class="dim" role="status">Loading calendars…</p><span id="cal-timezone" class="dim"></span></div>
    <div id="cal-week-grid" class="calendar-view" aria-label="Events"></div>
  </section>
</div>
<dialog id="cal-event-dialog" aria-labelledby="cal-event-title">
  <div class="calendar-detail-header"><span id="cal-event-calendar" class="dim"></span><button id="cal-event-close" class="ghost">Close</button></div>
  <h2 id="cal-event-title"></h2>
  <p id="cal-event-time"></p><p id="cal-event-location" class="dim"></p>
  <p id="cal-event-description"></p><div id="cal-event-link"></div>
  <p id="cal-event-permission" class="dim calendar-hint">Subscribed event · read-only</p>
  <a id="cal-event-edit" class="btn ghost" hidden>Edit event</a>
</dialog>
</div>
<style>
.calendar-app{--calendar-red:#c93d48;--calendar-blue:#2767ad;--calendar-green:#29805c;--calendar-purple:#8150b0;--calendar-orange:#a66217;--calendar-teal:#237b88}
.calendar-app [hidden]{display:none!important}
html.dark .calendar-app{--calendar-red:#f3838b;--calendar-blue:#82b5f0;--calendar-green:#7dcc9e;--calendar-purple:#bd9beb;--calendar-orange:#eab576;--calendar-teal:#7ec7d0}
.calendar-header{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin:0 0 1.5rem}
.calendar-header p{font-size:.8rem;margin:.4rem 0 0}.calendar-header .calendar-eyebrow{font-size:.65rem;letter-spacing:.15em;margin:0 0 .5rem}
.calendar-workspace{display:grid;grid-template-columns:15rem minmax(0,1fr);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;min-height:72vh;background:var(--card)}
.calendar-rail{min-width:0;padding:1rem;background:var(--sidebar);border-right:1px solid var(--border)}
.calendar-mini-header{display:flex;align-items:center;justify-content:space-between;gap:.25rem;margin-bottom:.75rem}
.calendar-mini-header h2{margin:0;font-size:.8rem}.calendar-mini-header button{font-size:.65rem;padding:.15rem .3rem;min-height:1.5rem;border:0}
.calendar-mini{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:.15rem}
.calendar-mini>span{text-align:center;font-size:.65rem;color:var(--dim)}
.calendar-mini button{position:relative;border:0;border-radius:50%;padding:0;min-height:1.65rem;font-size:.7rem;color:var(--fg);background:transparent}
.calendar-mini button:hover{background:var(--accent)}.calendar-mini button.outside{color:var(--dim)}
.calendar-mini button.today{box-shadow:inset 0 0 0 1px var(--calendar-red);color:var(--calendar-red)}
.calendar-mini button[aria-pressed=true]{background:var(--calendar-red);color:var(--background)}
.calendar-mini button.has-events::after{content:"";position:absolute;width:3px;height:3px;border-radius:50%;background:currentColor;bottom:2px;left:calc(50% - 1.5px)}
.calendar-rail-heading{margin:1.5rem 0 .5rem;font-size:.75rem}.calendar-hint{font-size:.7rem;line-height:1.5}
.calendar-source{display:flex;align-items:center;gap:.5rem;margin:.5rem 0;font-weight:400;font-size:.8rem;overflow-wrap:anywhere}
.calendar-source input{accent-color:var(--event-color)}.calendar-dot{width:.55rem;height:.55rem;border-radius:50%;background:var(--event-color);flex-shrink:0}
.calendar-agenda-head{display:flex;justify-content:space-between;align-items:center;gap:.5rem;border-top:1px solid var(--border);padding-top:1.25rem;margin-top:1.25rem}
.calendar-agenda-head h2{margin:0;font-size:.8rem}.calendar-agenda-head span{font-size:.7rem}
.calendar-agenda{max-height:28rem;overflow:auto;margin-top:.5rem}.calendar-agenda-date{font-size:.65rem;text-transform:uppercase;letter-spacing:.05em;margin:1rem 0 .3rem;color:var(--dim)}
.calendar-agenda-event{display:flex;align-items:flex-start;gap:.5rem;width:100%;justify-content:flex-start;text-align:left;background:transparent;color:var(--fg);padding:.5rem .15rem;font-weight:400;min-width:0}
.calendar-agenda-event:hover{background:var(--accent)}.calendar-agenda-event .calendar-dot{margin-top:.35rem}.calendar-agenda-event strong{font-size:.8rem;font-weight:500;display:block;overflow-wrap:anywhere}
.calendar-agenda-event small{font-size:.7rem;color:var(--dim);display:block}
.calendar-main{min-width:0;display:flex;flex-direction:column}
.calendar-toolbar{display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding:1rem;border-bottom:1px solid var(--border);flex-wrap:wrap}
.calendar-navigation{gap:.3rem}.calendar-toolbar button{font-size:.75rem;min-height:2rem;padding:.3rem .6rem}
.calendar-navigation h2{margin:0 0 0 .5rem;font-size:1rem;line-height:1.4}
.calendar-view-switch{display:flex;gap:.2rem}.calendar-view-switch button[aria-pressed=true]{background:var(--primary);color:var(--primary-foreground)}
.calendar-status-row{display:flex;justify-content:space-between;gap:.5rem;align-items:center;padding:.5rem 1rem;font-size:.7rem}.calendar-status-row p{margin:0}
.calendar-view{flex:1;min-width:0;overflow:auto;max-height:75vh}
.calendar-month{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));min-width:35rem}
.calendar-weekday{text-align:center;padding:.65rem .25rem;border-bottom:1px solid var(--border);font-size:.7rem;color:var(--dim)}
.calendar-month-day{min-height:7rem;min-width:0;border-right:1px solid var(--border);border-bottom:1px solid var(--border);padding:.3rem}
.calendar-month-day.outside{background:var(--muted)}.calendar-month-day.selected{box-shadow:inset 0 0 0 1px var(--ring)}
.calendar-date-button{background:transparent;color:var(--fg);border:0;padding:.15rem .4rem;min-height:1.65rem;font-size:.75rem;border-radius:50%}
.calendar-date-button.today,.calendar-time-day.today .calendar-day-number{background:var(--calendar-red);color:var(--background)}
.calendar-event{display:block;background:color-mix(in srgb,var(--event-color) 12%,var(--background));color:var(--event-color);border:1px solid color-mix(in srgb,var(--event-color) 25%,var(--border));border-radius:4px;padding:.15rem .3rem;font-size:.7rem;text-align:left;min-height:1.5rem;line-height:1.35;width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:.15rem 0}
.calendar-event strong{font-weight:600}.calendar-more{background:transparent;color:var(--dim);padding:.15rem;font-size:.65rem;min-height:1.5rem}
.calendar-time{min-width:42rem}.calendar-time.day-view{min-width:17rem}
.calendar-time-head{display:grid;grid-template-columns:3.5rem repeat(var(--day-count),minmax(0,1fr));position:sticky;top:0;z-index:3;background:var(--card)}
.calendar-time-day{display:flex;align-items:center;justify-content:center;gap:.4rem;padding:.65rem .15rem;border-left:1px solid var(--border);border-bottom:1px solid var(--border);font-size:.7rem;color:var(--dim)}
.calendar-day-number{display:inline-grid;place-items:center;font-size:1rem;width:1.8rem;height:1.8rem;border-radius:50%}
.calendar-all-day{display:grid;grid-template-columns:3.5rem repeat(var(--day-count),minmax(0,1fr));border-bottom:1px solid var(--border)}
.calendar-all-day-label{font-size:.65rem;padding:.5rem .2rem;color:var(--dim)}.calendar-all-day-cell{padding:.25rem;border-left:1px solid var(--border);min-width:0}
.calendar-time-body{display:grid;grid-template-columns:3.5rem repeat(var(--day-count),minmax(0,1fr));height:1440px}
.calendar-hours{position:relative}.calendar-hour{position:absolute;right:.5rem;transform:translateY(-50%);font-size:.6rem;color:var(--dim)}
.calendar-time-column{position:relative;border-left:1px solid var(--border);background:repeating-linear-gradient(to bottom,var(--border) 0,var(--border) 1px,transparent 1px,transparent 60px)}
.calendar-time-event{position:absolute;white-space:normal;margin:0;padding:.2rem;min-height:0;overflow:auto;font-size:.65rem}
.calendar-time-event span{display:block;font-size:.6rem}
.calendar-now{position:absolute;left:0;right:0;height:1px;background:var(--calendar-red);z-index:2;pointer-events:none}
.calendar-no-events{padding:.75rem;font-size:.75rem}
#cal-event-dialog{width:min(29rem,calc(100% - 2rem));max-height:85vh;overflow:auto;padding:1.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--fg)}
#cal-event-dialog::backdrop{background:rgba(0,0,0,.4)}.calendar-detail-header{display:flex;align-items:center;justify-content:space-between;gap:.5rem;font-size:.75rem}
#cal-event-title{font-size:1.5rem;line-height:1.3;margin:1.25rem 0;overflow-wrap:anywhere}#cal-event-description{white-space:pre-wrap;overflow-wrap:anywhere}#cal-event-location{white-space:pre-wrap}#cal-event-link a{text-decoration:underline}
@media(max-width:1050px){.calendar-workspace{grid-template-columns:12rem minmax(0,1fr)}.calendar-rail{padding:.75rem}.calendar-navigation h2{font-size:.85rem}}
@media(max-width:700px){.calendar-workspace{grid-template-columns:minmax(0,1fr)}.calendar-rail{border-right:0;border-bottom:1px solid var(--border);display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:.25rem 1rem}.calendar-mini-header,.calendar-mini{grid-column:1}.calendar-rail>label,.calendar-rail>input,.calendar-rail-heading,#cal-sources,.calendar-rail>.calendar-hint{grid-column:2}.calendar-rail>label{grid-row:1;margin:0}.calendar-rail>input{grid-row:2;align-self:start}.calendar-rail-heading{margin:.5rem 0}.calendar-agenda-head,.calendar-agenda{grid-column:1/-1}.calendar-agenda{max-height:12rem}.calendar-toolbar{padding:.75rem}.calendar-view{max-height:65vh}.calendar-status-row{flex-wrap:wrap}}
</style>`,
    script: calendarScript,
  });
}
