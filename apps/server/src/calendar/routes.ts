import type { IncomingMessage, ServerResponse } from "node:http";
import type { CalendarWorkspace } from "./workspace";
import { object } from "./store";
import { exportCalendar } from "./export";
import { ValidationError } from "../settings";

export async function handleCalendarRoutes(
  calendar: CalendarWorkspace, req: IncomingMessage, res: ServerResponse, path: string,
  owner: boolean, readBody: (req: IncomingMessage, limit?: number) => Promise<unknown>,
): Promise<boolean> {
  if (!path.startsWith("/api/calendars") && !path.startsWith("/api/calendar-events") && !path.startsWith("/api/google-calendar")) return false;
  const json = (status: number, data: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(data));
    return true;
  };
  const method = req.method ?? "GET";
  if (method === "GET" && path === "/api/calendars") return json(200, { ...calendar.status(), canManage: owner });
  if (method === "GET" && path === "/api/google-calendar/calendars") {
    return json(200, await calendar.googleCalendars());
  }
  if (method === "GET" && path === "/api/google-calendar/connect") {
    if (!owner) return json(403, { error: "Only a verified owner can connect Google Calendar." });
    const authorization = calendar.google.beginAuthorization();
    const secure = req.headers["x-forwarded-proto"] === "https" || (req.socket as { encrypted?: boolean }).encrypted;
    res.writeHead(302, {
      location: authorization.url, "cache-control": "no-store",
      "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "x-frame-options": "DENY",
      "set-cookie": `cc_google_oauth_state=${encodeURIComponent(authorization.state)}; Path=/api/google-calendar/callback; HttpOnly; SameSite=Lax; Max-Age=600${secure ? "; Secure" : ""}`,
    });
    res.end();
    return true;
  }
  if (method === "GET" && path === "/api/google-calendar/callback") {
    if (!owner) return json(403, { error: "Only a verified owner can finish Google Calendar sign-in." });
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const state = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code") ?? "";
    const cookie = (req.headers.cookie ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith("cc_google_oauth_state="))?.slice("cc_google_oauth_state=".length);
    let cookieState = "";
    try { cookieState = decodeURIComponent(cookie ?? ""); } catch { /* invalid cookie is rejected below */ }
    const secure = req.headers["x-forwarded-proto"] === "https" || (req.socket as { encrypted?: boolean }).encrypted;
    const clearCookie = `cc_google_oauth_state=; Path=/api/google-calendar/callback; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
    if (url.searchParams.has("error") || !/^[A-Za-z0-9_-]{43}$/.test(state) || !code || code.length > 4096 || state !== cookieState) {
      res.writeHead(302, {
        location: "/settings/calendars?google=failed", "cache-control": "no-store",
        "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "x-frame-options": "DENY",
        "set-cookie": clearCookie,
      });
      res.end();
      return true;
    }
    try {
      await calendar.google.finishAuthorization(state, code);
    } catch (error) {
      console.error("Google OAuth callback failed:", error instanceof Error ? error.message : "unknown error");
      res.writeHead(302, {
        location: "/settings/calendars?google=failed", "cache-control": "no-store",
        "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "x-frame-options": "DENY",
        "set-cookie": clearCookie,
      });
      res.end();
      return true;
    }
    res.writeHead(302, {
      location: "/settings/calendars?google=connected", "cache-control": "no-store",
      "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "x-frame-options": "DENY",
      "set-cookie": clearCookie,
    });
    res.end();
    return true;
  }
  if (method === "POST" && path === "/api/google-calendar/calendars") {
    if (!owner) return json(403, { error: "Only a verified owner can select Google calendars." });
    const body = object(await readBody(req));
    return json(200, { selected: await calendar.google.selectCalendars(body.calendarIds) });
  }
  if (method === "DELETE" && path === "/api/google-calendar") {
    if (!owner) return json(403, { error: "Only a verified owner can disconnect Google Calendar." });
    await calendar.google.disconnect();
    return json(200, { ok: true });
  }
  const eventMatch = path.match(/^\/api\/calendar-events\/([a-zA-Z0-9_-]+)$/);
  if (eventMatch && method === "GET") {
    const event = await calendar.event(eventMatch[1]!);
    return json(event ? 200 : 404, event ? { event } : { error: "Event not found" });
  }
  const match = path.match(/^\/api\/calendars\/([a-zA-Z0-9-]+)(?:\/(export\.ics|import|sharing))?$/);
  if (match?.[2] === "export.ics" && method === "GET") {
    const entry = calendar.store.get(match[1]!);
    if (entry?.kind !== "native") return json(404, { error: "Native calendar not found" });
    res.writeHead(200, {
      "content-type": "text/calendar; charset=utf-8", "cache-control": "no-store",
      "content-disposition": 'attachment; filename="command-center-calendar.ics"',
    });
    res.end(exportCalendar(calendar.store, entry.id));
    return true;
  }
  if (!owner) return json(403, { error: "Calendar changes require a verified owner login through Cloudflare Access. Machine/admin tokens cannot modify calendars." });
  if (method === "POST" && path === "/api/calendars") {
    const entry = await calendar.create(await readBody(req, 10_000));
    return json(201, { calendar: entry });
  }
  if (path === "/api/calendar-events" && method === "POST") {
    const event = await calendar.saveEvent(await readBody(req, 30_000));
    return json(201, { event });
  }
  if (eventMatch && method === "PUT") {
    const event = await calendar.saveEvent(await readBody(req, 30_000), eventMatch[1]!);
    return json(200, { event });
  }
  if (eventMatch && method === "DELETE") {
    const body = object(await readBody(req));
    await calendar.deleteEvent(eventMatch[1]!, body.expectedSyncVersion ?? body.expectedVersion);
    return json(200, { ok: true });
  }
  if (match) {
    const id = match[1]!, action = match[2];
    if (!action && method === "PUT") return json(200, { calendar: await calendar.store.update(id, await readBody(req)) });
    if (!action && method === "DELETE") {
      const body = object(await readBody(req));
      await calendar.remove(id, body.expectedVersion);
      return json(200, { ok: true });
    }
    if (action === "import" && method === "POST") {
      const body = object(await readBody(req, 1_200_000));
      if (typeof body.ics !== "string") throw new ValidationError("ics text is required");
      return json(200, await calendar.importIcs(id, body.ics));
    }
    if (action === "sharing" && ["POST", "DELETE"].includes(method)) {
      const body = object(await readBody(req));
      if (method === "POST") {
        const key = await calendar.store.publish(id, body.expectedVersion);
        return json(201, { path: `/feeds/calendars/${encodeURIComponent(id)}.ics?key=${key}` });
      }
      await calendar.store.unpublish(id, body.expectedVersion);
      return json(200, { ok: true });
    }
  }
  return json(405, { error: "Calendar operation not supported" });
}
