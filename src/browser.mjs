// Local Chrome with a project-owned profile. Notion's Cloudflare check blocks headless
// Chrome, so crawling runs headed with the window parked off-screen (a minimized window
// stops painting). Tests against our own copy run headless with a throwaway profile.
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export async function openBrowser({ profile = "", headless = false, mobile = false } = {}) {
  const opts = {
    headless, colorScheme: "light",
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    ...(mobile ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {}),
    args: ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"],
  };
  if (existsSync(CHROME)) opts.executablePath = CHROME;
  else if (!headless) throw new Error("Google Chrome not found in /Applications; it is needed to crawl Notion (headless Chromium gets blocked).");
  const ctx = await chromium.launchPersistentContext(profile, opts);
  const page = ctx.pages()[0] || (await ctx.newPage());
  if (!headless) {
    const cdp = await ctx.newCDPSession(page);
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    await cdp.send("Browser.setWindowBounds", { windowId, bounds: { left: -3000, top: 0, width: 1440, height: 1000, windowState: "normal" } });
  }
  return { ctx, page };
}
