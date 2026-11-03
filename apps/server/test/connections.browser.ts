import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { connectionsPage } from "../src/ui/connections-page";
import { DEFAULT_SETTINGS } from "../src/settings";

test("owner connection forms handle secrets, errors, disconnect and mobile layout", { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let saved = false, disabled = false, failSave = true;
    const payload = () => ({
      writable: true,
      connections: [{
        id: "brave", label: "Brave Search", disabled, updatedAt: saved ? "2026-11-03T12:00:00Z" : null,
        configured: saved && !disabled, hasSavedSettings: saved || disabled, lastCheck: null,
        usage: "Web searches for Daily Briefing topics.", fallback: "Keyword digests also require AI.",
        missingFields: saved && !disabled ? [] : ["braveSearchApiKey"],
        fields: [{ name: "braveSearchApiKey", secret: true, configured: saved && !disabled, source: disabled ? "disabled" : saved ? "saved" : "unset" }],
      }],
    });
    await page.route("**/*", async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (url.hostname !== "connections.test") return route.abort();
      if (url.pathname === "/settings/connections") return route.fulfill({ contentType: "text/html", body: connectionsPage() });
      if (url.pathname === "/api/settings") return route.fulfill({ json: { settings: DEFAULT_SETTINGS } });
      if (url.pathname === "/api/connections") return route.fulfill({ json: payload() });
      if (url.pathname === "/api/connections/brave/test") return route.fulfill({ json: { ok: false, message: "Provider unavailable", checkedAt: "2026-11-03T12:30:00Z" } });
      if (url.pathname === "/api/connections/brave") {
        if (req.method() === "PUT") {
          if (failSave) return route.fulfill({ status: 400, json: { error: "Could not save connection" } });
          const body = req.postDataJSON();
          if (body.values?.braveSearchApiKey) saved = true;
          if (typeof body.disabled === "boolean") disabled = body.disabled;
        }
        if (req.method() === "DELETE") { saved = false; disabled = false; }
        return route.fulfill({ json: payload() });
      }
      return route.fulfill({ status: 404, json: { error: "not found" } });
    });
    await page.goto("https://connections.test/settings/connections");
    await page.getByRole("button", { name: "Manage Brave Search", exact: true }).click();
    const input = page.getByLabel("API key", { exact: true });
    await input.waitFor();
    await page.getByText("Used by: Web searches for Daily Briefing topics.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Test access" }).isDisabled(), true);
    assert.equal(await input.getAttribute("type"), "password");
    await input.fill("do-not-echo-this");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await page.getByText("Could not save connection", { exact: true }).waitFor();
    assert.equal(await input.inputValue(), "do-not-echo-this");
    failSave = false;
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await page.getByText("Source: saved", { exact: true }).waitFor();
    assert.equal(await input.inputValue(), "");
    assert.ok(!(await page.locator("body").innerText()).includes("do-not-echo-this"));
    await page.getByRole("checkbox", { name: "Replace saved credential" }).check();
    await input.fill("unsaved-key");
    await page.getByRole("button", { name: "Test access" }).click();
    await page.getByText("Save your changes first. The access check uses effective settings, not unsaved fields.", { exact: true }).waitFor();
    await input.fill("");
    await page.getByRole("button", { name: "Test access" }).click();
    await page.getByText("Not ready: Provider unavailable", { exact: true }).waitFor();
    page.on("dialog", (dialog) => dialog.accept());
    await page.getByText("Advanced actions", { exact: true }).click();
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await page.getByText("Disconnected", { exact: true }).waitFor();
    await page.getByText("Advanced actions", { exact: true }).click();
    await page.getByRole("button", { name: "Restore deployment defaults" }).click();
    await page.getByText("Source: unset", { exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("connection values render safely and saving one service preserves other drafts", { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let saved = false;
    const payload = () => ({
      writable: true,
      connections: [
        {
          id: "llm", label: "AI summarizer", configured: true, disabled: false, hasSavedSettings: false,
          usage: "Notes and Read Later.", fallback: "AI features require all fields.", lastCheck: null, updatedAt: null,
          fields: [
            { name: "llmBaseUrl", secret: false, configured: true, source: "environment", value: "https://models.example/v1" },
            { name: "llmModel", secret: false, configured: true, source: "environment", value: "<img src=x onerror=alert(1)>" },
            { name: "llmApiKey", secret: true, configured: true, source: "environment", value: null },
          ],
        },
        {
          id: "brave", label: "Brave Search", configured: saved, disabled: false, hasSavedSettings: saved,
          usage: "Daily Briefing topics.", fallback: "Search requires a key.", lastCheck: null, updatedAt: null,
          fields: [{ name: "braveSearchApiKey", secret: true, configured: saved, source: saved ? "saved" : "unset", value: null }],
        },
      ],
    });

    await page.route("**/*", async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (url.hostname !== "connections.test") return route.abort();
      if (url.pathname === "/settings/connections") return route.fulfill({ contentType: "text/html", body: connectionsPage() });
      if (url.pathname === "/api/settings") return route.fulfill({ json: { settings: DEFAULT_SETTINGS } });
      if (url.pathname === "/api/connections") return route.fulfill({ json: payload() });
      if (url.pathname === "/api/connections/brave" && req.method() === "PUT") {
        saved = true;
        return route.fulfill({ json: payload() });
      }
      return route.fulfill({ status: 404, json: { error: "not found" } });
    });
    await page.goto("https://connections.test/settings/connections");
    const llm = page.locator('[data-connection-id="llm"]'), brave = page.locator('[data-connection-id="brave"]');
    assert.equal(await llm.locator("form").isHidden(), true);
    await llm.getByRole("button", { name: "Manage AI summarizer" }).click();
    await llm.getByText("Current: https://models.example/v1", { exact: true }).waitFor();
    await llm.getByText("Current: <img src=x onerror=alert(1)>", { exact: true }).waitFor();
    assert.equal(await llm.locator("img").count(), 0);
    await llm.getByLabel("Model", { exact: true }).fill("keep-this-draft");
    await brave.getByRole("button", { name: "Manage Brave Search" }).click();
    await brave.getByLabel("API key", { exact: true }).fill("new-brave-secret");
    await brave.getByRole("button", { name: "Save changes", exact: true }).click();
    await brave.getByText("Source: saved", { exact: true }).waitFor();
    assert.equal(await llm.getByLabel("Model", { exact: true }).inputValue(), "keep-this-draft");
    assert.equal(await brave.getByLabel("API key", { exact: true }).inputValue(), "");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("connection conflicts retain secret drafts until review; pending submissions are single-flight and Cancel clears secrets", { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined });
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    let revision = "v1", writes = 0, conflict = true, release: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const payload = () => ({ writable: true, connections: [{ id: "brave", label: "Brave Search", revision, disabled: false, configured: true, hasSavedSettings: true, usage: "Daily briefing search.", fallback: "Requires a key.", fields: [{ name: "braveSearchApiKey", secret: true, configured: true, source: "saved", value: null }] }] });
    await page.route("**/*", async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (url.hostname !== "connections.test") return route.abort();
      if (url.pathname === "/settings/connections") return route.fulfill({ contentType: "text/html", body: connectionsPage() });
      if (url.pathname === "/api/settings") return route.fulfill({ json: { settings: DEFAULT_SETTINGS } });
      if (url.pathname === "/api/connections") return route.fulfill({ json: payload() });
      if (url.pathname === "/api/connections/brave" && request.method() === "PUT") {
        writes++;
        if (conflict) { conflict = false; revision = "v2"; return route.fulfill({ status: 409, json: { error: "Settings changed elsewhere. Review the current settings." } }); }
        assert.equal(request.postDataJSON().expectedRevision, "v2");
        await wait; revision = "v3"; return route.fulfill({ json: payload() });
      }
      return route.fulfill({ status: 404 });
    });
    await page.goto("http://connections.test/settings/connections#brave");
    await page.getByRole("checkbox", { name: "Replace saved credential" }).check();
    const input = page.getByLabel("API key", { exact: true }); await input.fill("secret-draft");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await page.getByRole("button", { name: "Keep draft against reviewed version" }).waitFor();
    assert.equal(await input.inputValue(), "secret-draft");
    assert.equal(await page.getByRole("button", { name: "Save changes", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "Keep draft against reviewed version" }).click();
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await page.locator("form").evaluate((form: HTMLFormElement) => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    release!(); await page.getByText("Connection settings saved. Use Test access to check access.", { exact: true }).waitFor();
    assert.equal(writes, 2); assert.equal(await input.inputValue(), "");
    await page.getByRole("checkbox", { name: "Replace saved credential" }).check(); await input.fill("cancel-this-secret");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await input.inputValue(), ""); assert.equal(await input.isHidden(), true);
    assert.ok(!(await page.locator("body").innerText()).includes("secret-draft"));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
