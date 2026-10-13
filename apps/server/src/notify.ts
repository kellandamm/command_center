/** Fire-and-forget JSON POST to the operator's webhook (Slack/Discord/ntfy-style). Never throws. */
export async function notify(url: string | null, event: { kind: string; message: string; [k: string]: unknown }): Promise<void> {
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // `text`/`content` cover the common webhook shapes without configuration.
      body: JSON.stringify({ ...event, text: event.message, content: event.message }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // A broken webhook must never fail a build.
  }
}
