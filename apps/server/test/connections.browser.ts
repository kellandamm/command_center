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
        id: "brave", label: "Brave Search", disabled, updatedAt: null,
        fields: [{ name: "braveSearchApiKey", secret: true, configured: saved && !disabled, source: disabled ? "disabled" : saved ? "saved" : "unset" }],
      }],
    });
    await page.route("**/*", async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (url.hostname !== "connections.test") return route.abort();
      if (url.pathname === "/settings/connections") return route.fulfill({ contentType: "text/html", body: connectionsPage() });
      if (url.pathname === "/api/settings") return route.fulfill({ json: { settings: DEFAULT_SETTINGS } });
      if (url.pathname === "/api/connections") return route.fulfill({ json: payload() });
      if (url.pathname === "/api/connections/brave/test") return route.fulfill({ json: { ok: false, message: "Provider unavailable" } });
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
    const input = page.getByLabel("API key", { exact: true });
    await input.waitFor();
    assert.equal(await input.getAttribute("type"), "password");
    await input.fill("do-not-echo-this");
    await page.getByRole("button", { name: "Save / reconnect" }).click();
    await page.getByText("Could not save connection", { exact: true }).waitFor();
    assert.equal(await input.inputValue(), "do-not-echo-this");
    failSave = false;
    await page.getByRole("button", { name: "Save / reconnect" }).click();
    await page.getByText("Source: saved", { exact: true }).waitFor();
    assert.equal(await input.inputValue(), "");
    assert.ok(!(await page.locator("body").innerText()).includes("do-not-echo-this"));
    await page.getByRole("button", { name: "Test connection" }).click();
    await page.getByText("Not ready: Provider unavailable", { exact: true }).waitFor();
    page.on("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await page.getByText("Disconnected", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Remove saved settings" }).click();
    await page.getByText("Source: unset", { exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
