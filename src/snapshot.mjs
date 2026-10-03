// Crawl a published Notion site into the project's staging folder. Visits every page
// reachable from the root with real Chrome and records: HTML shells, Notion's JS/CSS,
// every /api/v3 request/response pair, full-resolution images, HTML embeds, signed files.
// Nothing here touches the live `site/` folder; see validate.mjs + swap in cli.
import { mkdir, writeFile, rm, access, cp } from "node:fs/promises";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, extname, join } from "node:path";
import { openBrowser } from "./browser.mjs";
import { fetchAllChunks, pruneAssets } from "./chunks.mjs";
import { localizeSignedFiles } from "./files.mjs";
import { log } from "./log.mjs";

const sha = (s) => createHash("sha1").update(s).digest("hex").slice(0, 16);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const dash = (id) => id.replace(/-/g, "").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
export const imageKey = (u) => { const url = new URL(u); return decodeURIComponent(url.pathname) + "|" + (url.searchParams.get("id") || ""); };

// App endpoints that carry no page content and are safe to reuse from earlier runs.
const CONTENT = /^(loadCachedPageChunk|loadPageChunk|queryCollection|syncRecordValues|getRecordValues|search|getPublicPageData|getBacklinks|getSignedFileUrls)/;
const SKIP_API = new Set(["ping", "etClient", "getUserAnalyticsSettings", "getSubscriptionBanner", "inAppGetBannerByBlockId", "getAppConfig"]);
const CHALLENGE = /Checking your Browser|Just a moment\.\.\./;

export async function snapshot(p) {
  const { config } = p;
  const ORIGIN = new URL(config.source).origin;
  const OUT = p.staging;
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  // Chunk files are content-hashed and immutable: start from the current ones so a rerun
  // only downloads what a new Notion build added (stale ones are pruned at the end).
  if (existsSync(join(p.site, "_assets"))) await cp(join(p.site, "_assets"), join(OUT, "_assets"), { recursive: true });

  const saved = new Set(), query = {}, pages = {}, images = {}, api = [], pending = new Set(), imageQueue = new Set();
  const layout = {}; // per page: facts only visible in Notion's rendered page (e.g. property order)
  const embeds = [];
  let lastApi = Date.now();
  const write = async (path, buf) => { await mkdir(dirname(join(OUT, path)), { recursive: true }); await writeFile(join(OUT, path), buf); };

  function onResponse(res) {
    const task = (async () => {
      const r = res.request(), u = new URL(r.url()), st = res.status();
      if (u.origin === ORIGIN && u.pathname.startsWith("/api/v3/")) {
        lastApi = Date.now();
        const ep = u.pathname.slice(8);
        if (SKIP_API.has(ep) || st !== 200) return;
        const body = await res.json().catch(() => null);
        if (body) api.push({ ep, req: JSON.parse(r.postData() || "null"), res: body });
        return;
      }
      if (st !== 200) return;
      // HTML embeds: artifact.notionusercontent.com serves the uploaded file wrapped in
      // Notion's frame bridge script. Save the wrapped version; the worker serves it.
      if (u.hostname === "artifact.notionusercontent.com" && r.resourceType() === "document") {
        const s3 = new URL(u.searchParams.get("src") || "https://x/");
        const [id, name] = s3.pathname.split("/").slice(-2);
        if (/^[0-9a-f-]{36}$/.test(id)) { await write(`_artifacts/${id}/${name}`, await res.body()); embeds.push(id); }
        return;
      }
      if (u.origin !== ORIGIN || r.method() !== "GET") return;
      if (u.pathname.startsWith("/image/")) { imageQueue.add(r.url()); return; }
      const type = res.headers()["content-type"] || "";
      if (r.resourceType() === "document") {
        const html = await res.text();
        if (CHALLENGE.test(html) || !html.includes("notion-html")) return;
        const file = `_pages/${sha(u.pathname)}.html`;
        pages[decodeURIComponent(u.pathname)] = file;
        await write(file, html);
        return;
      }
      if (u.search) {
        const key = u.pathname + u.search;
        if (query[key]) return;
        const file = `_q/${sha(key)}${extname(u.pathname)}`;
        query[key] = { file, type };
        await write(file, await res.body());
        return;
      }
      if (saved.has(u.pathname)) return;
      saved.add(u.pathname);
      if (u.pathname.startsWith("/_assets/") && existsSync(join(OUT, u.pathname))) return;
      await write(u.pathname.slice(1), await res.body());
    })().catch((e) => log.warn(`could not save ${res.url().slice(0, 100)}: ${e.message}`));
    pending.add(task);
    task.finally(() => pending.delete(task));
  }

  const { ctx, page } = await openBrowser({ profile: p.profile });
  try {
    page.on("response", onResponse);
    page.on("request", (r) => { if (new URL(r.url()).pathname.startsWith("/image/")) imageQueue.add(r.url()); });

    const settle = async (max = 30000) => {
      const start = Date.now();
      while (Date.now() - start < max) { await sleep(500); if (Date.now() - lastApi > 3000 && pending.size === 0) return; }
    };
    // true = loaded, "private" = Notion says the page isn't public (skip, don't retry), false = failed.
    const load = async (url) => {
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
          const state = await page.waitForFunction(() => {
            if (document.querySelector(".notion-page-content, .notion-collection_view_page-block")) return "ok";
            if (/This page couldn.t be found|You may not have access/.test(document.body?.innerText || "")) return "private";
            return false;
          }, null, { timeout: 45000 }).then((h) => h.jsonValue(), () => false);
          if (state === "ok") return true;
          if (state === "private") return "private";
        } catch (e) { log.warn(`load error: ${e.message.split("\n")[0]}`); }
        const wait = 60000 * (attempt + 1);
        log.warn(`blocked or slow (${await page.title().catch(() => "?")}), retrying in ${wait / 1000}s`);
        await sleep(wait);
      }
      return false;
    };
    const scrollAll = () => page.evaluate(async () => {
      const sc = document.querySelector(".notion-frame .notion-scroller") || document.scrollingElement;
      for (let y = 0; y < sc.scrollHeight; y += 600) { sc.scrollTo(0, y); await new Promise((r) => setTimeout(r, 250)); }
      sc.scrollTo(0, 0);
    });
    // Click things that fetch more data: database view tabs, "Load more", tab blocks.
    const exercise = async () => {
      const n = await page.evaluate(async () => {
        let n = 0;
        for (const s of [".notion-collection-view-tab-button", ".notion-collection_view-block [role=tab]", "[role=tablist] [role=tab]", ".notion-collection-load-more", ".notion-collection-group-load-more"])
          for (const el of document.querySelectorAll(s)) { el.click(); n++; await new Promise((r) => setTimeout(r, 800)); }
        return n;
      });
      if (n) await settle();
    };
    const pageIds = () => {
      const ids = new Set();
      for (const { res } of api) {
        for (const [id, rec] of Object.entries(res.recordMap?.block || {})) {
          const v = rec?.value?.value || rec?.value;
          if (v?.alive !== false && (v?.type === "page" || v?.type === "collection_view_page")) ids.add(id);
        }
        for (const r of Object.values(res.result?.reducerResults || {})) for (const id of r?.blockIds || []) ids.add(id);
      }
      return ids;
    };

    const rootId = dash(config.source.slice(-32));
    const visited = new Set(), failed = [], skipped = [], queue = [rootId];
    while (queue.length && visited.size < config.crawl.maxPages) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      const url = id === rootId ? config.source : `${ORIGIN}/${id.replace(/-/g, "")}`;
      log.step(`page ${visited.size}: ${url.replace(ORIGIN, "")}`);
      const loaded = await load(url);
      if (loaded === "private") { visited.delete(id); skipped.push(id); log.step("  not public, skipped"); continue; }
      if (!loaded) { failed.push(id); continue; }
      await settle(); await scrollAll(); await settle(); await exercise();
      // Database row property order as Notion displays it (not derivable from the data).
      layout[id] = await page.evaluate(() => ({
        properties: [...document.querySelectorAll(".notion-page-block ~ * [role=row], [role=table] [role=row]")]
          .filter((r) => !r.closest(".notion-page-content")).map((r) => r.firstElementChild?.innerText.trim()).filter(Boolean),
      })).catch(() => ({}));
      const finalPath = decodeURIComponent(new URL(page.url()).pathname);
      const shells = Object.values(pages);
      if (!pages[finalPath] && shells.length) pages[finalPath] = shells.at(-1);
      for (const pid of pageIds()) if (!visited.has(pid) && !skipped.includes(pid)) queue.push(pid);
      await sleep(config.crawl.delayMs);
    }

    // One real search, so the worker can answer in exactly Notion's response format.
    await load(config.source); await settle();
    await page.keyboard.press("Meta+k").catch(() => {});
    await sleep(1500);
    await page.keyboard.type("a", { delay: 100 });
    await sleep(5000); await settle();

    // Every image the data references (image blocks, icons, covers), not only those Notion
    // happened to display: hidden tabs and closed toggles never load theirs.
    const latest = {};
    for (const { res } of api) for (const [bid, rec] of Object.entries(res.recordMap?.block || {})) {
      const v = rec?.value?.value || rec?.value;
      if (v && (!latest[bid] || (v.version ?? 0) >= (latest[bid].version ?? 0))) latest[bid] = v;
    }
    const proxied = (src, v) => `${ORIGIN}/image/${encodeURIComponent(src)}?table=block&id=${v.id}&spaceId=${v.space_id || ""}&cache=v2`;
    for (const v of Object.values(latest)) {
      if (v.alive === false) continue;
      const srcs = [];
      if (v.type === "image") srcs.push(v.properties?.source?.[0]?.[0] || v.format?.display_source);
      srcs.push(v.format?.page_icon, v.format?.page_cover);
      for (const src of srcs) if (src && (src.startsWith("attachment:") || /^https?:\/\//.test(src) || src.startsWith("/images/"))) imageQueue.add(proxied(src, v));
    }

    // Full-resolution images, one file per image regardless of requested width.
    const byKey = new Map();
    for (const u of imageQueue) { const k = imageKey(u); if (!byKey.has(k)) byKey.set(k, u); }
    log.step(`images: ${byKey.size}`);
    const externalFailed = [];
    let previousImages = {};
    try { previousImages = JSON.parse(readFileSync(join(p.site, "_data/manifest.json"), "utf8")).images || {}; } catch {}
    for (const [key, u] of byKey) {
      const src = key.slice("/image/".length, key.lastIndexOf("|"));
      const full = new URL(u); full.searchParams.delete("width"); full.searchParams.delete("w");
      // Notion's built-in covers/icons aren't served through the image proxy: fetch them directly.
      if (src.startsWith("/images/")) { full.href = ORIGIN + src; }
      for (let attempt = 0; attempt < 4; attempt++) {
        const res = await ctx.request.get(full.toString(), { timeout: 60000 }).catch(() => null);
        if (res?.ok()) {
          const type = (res.headers()["content-type"] || "application/octet-stream").split(";")[0];
          const ext = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/svg+xml": ".svg" }[type] || "";
          const file = `_img/${sha(key)}${ext}`;
          await write(file, await res.body());
          images[key] = { file, type };
          break;
        }
        await sleep(3000 * (attempt + 1));
      }
      if (!images[key]) {
        // Notion hiccup: reuse the copy from the last good snapshot when there is one (same key = same file).
        const prev = previousImages[key];
        if (prev && existsSync(join(p.site, prev.file))) {
          await mkdir(dirname(join(OUT, prev.file)), { recursive: true });
          await cp(join(p.site, prev.file), join(OUT, prev.file));
          images[key] = prev;
          log.warn(`image download failed, reused the copy from the last snapshot: ${key.slice(0, 70)}`);
          continue;
        }
      }
      if (!images[key]) {
        // An external image that is gone at its source can't be saved; it's a warning, not a blocker.
        if (/^https?:\/\//.test(src)) { externalFailed.push(key); log.warn(`external image unavailable (kept as link): ${src.slice(0, 80)}`); }
        else log.warn(`image failed: ${key.slice(0, 90)}`);
      }
      await sleep(150);
    }

    await Promise.all(pending);
    // Notion's code is only needed when replaying its app; the Astro renderer needs data + media.
    if (config.renderer === "notion") {
      await fetchAllChunks(ctx.request, ORIGIN, join(OUT, "_assets"));
      await pruneAssets(join(OUT, "_assets"), new Set([...saved].filter((s) => s.startsWith("/_assets/")).map((s) => s.slice(9))));
    }

    // Endpoints Notion only calls on some loads: keep the last response and fill gaps.
    let sticky = {};
    try { sticky = JSON.parse(readFileSync(p.sticky, "utf8")); } catch {}
    for (const r of api) if (!CONTENT.test(r.ep)) sticky[r.ep] = r;
    await mkdir(dirname(p.sticky), { recursive: true });
    writeFileSync(p.sticky, JSON.stringify(sticky));
    const seen = new Set(api.map((r) => r.ep));
    const withSticky = [...api, ...Object.values(sticky).filter((r) => !seen.has(r.ep))];
    const apiOut = await localizeSignedFiles(withSticky, ctx.request, OUT);

    const manifest = { origin: ORIGIN, source: config.source, root: rootId, pages, query, images, visited: [...visited], failed, skipped, embeds, imagesExpected: byKey.size, externalFailed, layout, created: new Date().toISOString() };
    await write("_data/manifest.json", JSON.stringify(manifest));
    await write("_data/api.json", JSON.stringify(apiOut));
    log.ok(`snapshot: ${visited.size} pages (${failed.length} failed, ${skipped.length} not public), ${api.length} api records, ${Object.keys(images).length}/${byKey.size} images, ${embeds.length} embeds`);
    return manifest;
  } finally {
    await ctx.close().catch(() => {});
  }
}
