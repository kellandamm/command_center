import { chromium, type Browser } from "playwright-core";
import { assertPublicUrl } from "./ssrf";
import { cleanHtmlForLLM } from "./sanitize";
import type { ScrapedPage } from "@homepage/agent-core";

const MAX_HTML = 600_000;

/**
 * One headless Chromium for the process. Each page gets a fresh, throwaway
 * context (no cookies, no storage, nothing signed in) and every request it
 * makes, including sub-requests and redirects, is checked against the SSRF
 * guard before it leaves the machine.
 */
export class Scraper {
  private browser: Browser | null = null;

  private async get(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    this.browser = await chromium.launch({
      headless: true,
      args: ["--disable-dev-shm-usage", "--no-first-run", "--disable-extensions", "--disable-gpu"],
    });
    return this.browser;
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => {});
    this.browser = null;
  }

  async scrape(url: string, loadDelayMs: number, signal?: AbortSignal): Promise<ScrapedPage> {
    await assertPublicUrl(url);
    const browser = await this.get();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      javaScriptEnabled: true,
      acceptDownloads: false,
      serviceWorkers: "block",
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    });
    const abort = () => void context.close().catch(() => {});
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const verdicts = new Map<string, Promise<boolean>>();
      await context.route("**/*", async (route) => {
        const req = route.request();
        const type = req.resourceType();
        if (type === "image" || type === "media" || type === "font") return route.abort();
        const target = req.url();
        if (!/^https?:/i.test(target)) return route.abort();
        let host: string;
        try {
          host = new URL(target).host;
        } catch {
          return route.abort();
        }
        let ok = verdicts.get(host);
        if (!ok) {
          ok = assertPublicUrl(target).then(() => true, () => false);
          verdicts.set(host, ok);
        }
        return (await ok) ? route.continue() : route.abort();
      });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(Math.min(Math.max(loadDelayMs, 0), 8000));
      const finalUrl = page.url();
      await assertPublicUrl(finalUrl);
      const title = (await page.title()).slice(0, 300);
      // Rewrite relative links/images to absolute so the model never has to guess an origin.
      const raw = await page.evaluate(() => {
        for (const a of document.querySelectorAll<HTMLAnchorElement>("a[href]")) a.setAttribute("href", a.href);
        for (const i of document.querySelectorAll<HTMLImageElement>("img[src]")) i.setAttribute("src", i.currentSrc || i.src);
        return document.body?.innerHTML ?? "";
      });
      const html = cleanHtmlForLLM(raw).slice(0, MAX_HTML);
      return { url, finalUrl, title, html };
    } finally {
      signal?.removeEventListener("abort", abort);
      await context.close().catch(() => {});
    }
  }
}
