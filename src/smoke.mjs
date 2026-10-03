// Smoke test a served copy (local `wrangler dev` or production). Returns a list of failures;
// an empty list means every page rendered correctly with the configured theme.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { openBrowser } from "./browser.mjs";
import { log } from "./log.mjs";
import { pageIdsOf } from "./project.mjs";

const IGNORE = /Statsig|StatsigUser|Failed to load resource|ResizeObserver loop|allow-same-origin/;
const val = (rec) => rec?.value?.value || rec?.value;
const plain = (rt) => (Array.isArray(rt) ? rt.map((x) => (typeof x?.[0] === "string" ? x[0] : "")).join("") : "");
const hexToRgb = (h) => { const m = h.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i); return m ? `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})` : null; };

export async function smoke(p, base, opts = {}) {
  return p.config.renderer === "astro" ? smokeAstro(p, base, opts) : smokeNotion(p, base, opts);
}

// Static Astro build: every page is plain HTML, so checks are about content and theme.
async function smokeAstro(p, base, { pages: onlyPages, shots } = {}) {
  const m = JSON.parse(await readFile(join(p.site, "_data/manifest.json"), "utf8"));
  const api = JSON.parse(await readFile(join(p.site, "_data/api.json"), "utf8"));
  const blocks = {};
  for (const r of api) for (const [id, rec] of Object.entries(r.res?.recordMap?.block || {})) {
    const v = val(rec); if (v && (!blocks[id] || (v.version ?? 0) >= (blocks[id].version ?? 0))) blocks[id] = v;
  }
  const theme = p.config.theme;
  const failures = [];
  const fail = (s) => { failures.push(s); log.fail(s); };
  const ids = (onlyPages || pageIdsOf(m)).slice();
  if (!ids.length) return ["snapshot has no pages"];
  const words = Object.values(blocks).filter((b) => b.type === "text").flatMap((b) => plain(b.properties?.title).split(/\W+/)).filter((w) => w.length >= 6);
  const word = words.sort((a, b) => b.length - a.length)[Math.floor(words.length / 3)] || "design";

  const { ctx, page } = await openBrowser({ headless: true });
  let errors = [], bad = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
  // Third-party embeds (Google Drive, ...) log their own notices; only our page's errors count.
  page.on("console", (msg) => { if (msg.type() === "error" && !/Failed to load resource|report-only|Content Security Policy/.test(msg.text()) && !/^https?:\/\/(?!localhost)/.test(msg.location()?.url || "") ) errors.push(msg.text().slice(0, 160)); });
  page.on("response", (r) => { if (r.url().startsWith(base) && r.status() >= 400) bad.push(`${r.status()} ${r.url().replace(base, "")}`.slice(0, 160)); });
  try {
    for (const id of ids) {
      const hex = id.replace(/-/g, "");
      // Main URL of the page ("/" for the root; other URLs are redirects).
      const path = id === m.root ? "/" : Object.keys(m.pages).filter((k) => k.endsWith(hex)).sort((a, b) => b.length - a.length)[0] || `/${hex}`;
      const name = plain(blocks[id]?.properties?.title) || id;
      errors = []; bad = [];
      const res = await page.goto(base + path, { waitUntil: "load", timeout: 60000 }).catch(() => null);
      if (!res || res.status() !== 200) { fail(`${name}: HTTP ${res?.status() ?? "error"} for ${path}`); continue; }
      await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo({ top: y, behavior: "instant" }); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo({ top: 0, behavior: "instant" }); });
      await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 15000 }).catch(() => {});
      const r = await page.evaluate(() => {
        const leaf = document.querySelector(".ns-content .ns-leaf");
        const frame = document.querySelector(".ns-image-frame");
        const crumb = document.querySelector(".ns-crumbs"), pc = document.querySelector(".ns-content");
        let offset = null;
        if (crumb && pc) { const w = document.createTreeWalker(crumb, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.data.trim() ? 1 : 3) }); const n = w.nextNode(); if (n) { const rg = document.createRange(); rg.selectNodeContents(n); offset = Math.round(rg.getBoundingClientRect().left - (pc.getBoundingClientRect().left + parseFloat(getComputedStyle(pc).paddingLeft) + 8)); } }
        return {
          title: document.title, h1: document.querySelector("h1.ns-title")?.textContent || "",
          blocks: document.querySelectorAll(".ns-content [data-block-id]").length,
          // Visible images must have rendered; hidden ones (closed tabs/toggles) are checked over HTTP below.
          broken: [...document.images].filter((i) => i.offsetParent && !i.naturalWidth).map((i) => i.getAttribute("src").slice(0, 80)),
          srcs: [...new Set([...document.images].map((i) => i.src))],
          remote: [...document.images].filter((i) => /^https?:/.test(i.getAttribute("src"))).length,
          bg: getComputedStyle(document.body).backgroundColor,
          font: leaf ? getComputedStyle(leaf).fontFamily : "",
          radius: frame ? getComputedStyle(frame).borderTopLeftRadius : null,
          scripts: [...document.scripts].filter((s) => s.src).length,
          offset,
        };
      });
      const missing = [];
      for (const src of r.srcs) if (src.startsWith(base)) { const st = await fetch(src, { method: "HEAD" }).then((x) => x.status).catch(() => 0); if (st !== 200) missing.push(`${st} ${src.replace(base, "")}`); }
      const problems = [];
      if (missing.length) problems.push(`${missing.length} image file(s) missing: ${missing[0]}`);
      const kids = (blocks[id]?.content || []).filter((c) => blocks[c] && blocks[c].alive !== false).length;
      if (r.h1.trim() !== name.trim()) problems.push(`heading "${r.h1}"`);
      if (!r.title.includes(name.slice(0, 20))) problems.push(`title "${r.title}"`);
      if (kids && r.blocks < kids) problems.push(`${r.blocks} blocks rendered, page has ${kids}`);
      if (r.broken.length) problems.push(`${r.broken.length} broken image(s): ${r.broken[0]}`);
      if (r.remote) problems.push(`${r.remote} image(s) still loaded from the internet`);
      if (theme.background && hexToRgb(theme.background) && r.bg !== hexToRgb(theme.background)) problems.push(`background ${r.bg}`);
      if (theme.font && r.font && !r.font.replace(/"/g, "").startsWith(theme.font.family)) problems.push(`font ${r.font.slice(0, 40)}`);
      if (theme.imageRadius != null && r.radius && r.radius !== `${theme.imageRadius}px`) problems.push(`image radius ${r.radius}`);
      if (theme.headerWidth === "content" && r.offset != null && Math.abs(r.offset) > 3) problems.push(`header off by ${r.offset}px`);
      if (errors.length) problems.push(`errors: ${errors.join(" | ")}`);
      if (bad.length) problems.push(`requests failed: ${[...new Set(bad)].slice(0, 4).join(", ")}`);
      if (problems.length) fail(`${name}: ${problems.join("; ")}`); else log.ok(name);
      if (shots) await page.screenshot({ path: join(shots, `${hex}.png`) });
    }
    // Interactive features (every page that has them): database toolbar, image viewer, properties toggle.
    for (const id of ids) {
      const hex = id.replace(/-/g, "");
      const path = id === m.root ? "/" : Object.keys(m.pages).filter((k) => k.endsWith(hex)).sort((a, b) => b.length - a.length)[0];
      await page.goto(base + path, { waitUntil: "load" });
      const name = plain(blocks[id]?.properties?.title) || id;
      const has = await page.evaluate(() => ({ db: !!document.querySelector(".ns-gallery-head .ns-db-tools"), img: !!document.querySelector("img[data-zoom]"), props: !!document.querySelector("[data-props-toggle]") }));
      const bad = [];
      if (has.db) {
        const before = await page.locator(".ns-card:not(.is-hidden)").count();
        await page.click('[data-db="search"]'); await page.keyboard.type("zzzqqq");
        if (await page.locator(".ns-card:not(.is-hidden)").count() !== 0) bad.push("database search does not filter");
        await page.keyboard.press("Escape");
        if (await page.locator(".ns-card:not(.is-hidden)").count() !== before) bad.push("database search does not reset");
        await page.click('[data-db="sort"]');
        if (!(await page.locator(".ns-pop").count())) bad.push("sort menu does not open");
        await page.keyboard.press("Escape");
      }
      if (has.img) {
        await page.locator("img[data-zoom]").first().click();
        if (!(await page.locator(".ns-lightbox").count())) bad.push("image viewer does not open");
        await page.keyboard.press("Escape");
      }
      if (has.props) {
        await page.click("[data-props-toggle]");
        if (await page.locator(".ns-prop-extra[hidden]").count()) bad.push("more-properties toggle does not expand");
      }
      if (bad.length) fail(`${name}: ${bad.join("; ")}`);
    }
    log.ok("interactive features (database toolbar, image viewer, properties)");
    // 404 page exists and is a real 404.
    const nf = await page.goto(base + "/this-page-does-not-exist-" + Date.now(), { waitUntil: "load" }).catch(() => null);
    if (!nf || nf.status() !== 404) fail(`unknown paths return ${nf?.status()} instead of 404`); else log.ok("404 page");
    // Search (Pagefind) through the real UI.
    await page.goto(base + "/", { waitUntil: "load" });
    await page.click(".ns-search-btn");
    await page.keyboard.type(word, { delay: 30 });
    const hits = await page.waitForFunction(() => document.querySelectorAll(".ns-si-hit").length, null, { timeout: 10000 }).then((h) => h.jsonValue()).catch(() => 0);
    if (!hits) fail(`search for "${word}" returned nothing`); else log.ok(`search "${word}": ${hits} result(s)`);
  } finally { await ctx.close(); }

  const mob = await openBrowser({ headless: true, mobile: true });
  try {
    await mob.page.goto(base + "/", { waitUntil: "load" });
    const overflow = await mob.page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (overflow > 1) fail(`mobile: page scrolls sideways by ${overflow}px`);
    await mob.page.tap(".ns-search-btn");
    await mob.page.keyboard.type(word, { delay: 30 });
    const hits = await mob.page.waitForFunction(() => document.querySelectorAll(".ns-si-hit").length, null, { timeout: 10000 }).then((h) => h.jsonValue()).catch(() => 0);
    if (!hits) fail("mobile: search returned nothing"); else log.ok("mobile search");
    if (shots) await mob.page.screenshot({ path: join(shots, "mobile-home.png") });
  } finally { await mob.ctx.close(); }
  return failures;
}

async function smokeNotion(p, base, { pages: onlyPages, shots } = {}) {
  const m = JSON.parse(await readFile(join(p.site, "_data/manifest.json"), "utf8"));
  const api = JSON.parse(await readFile(join(p.site, "_data/api.json"), "utf8"));
  const blocks = {};
  for (const r of api) for (const [id, rec] of Object.entries(r.res?.recordMap?.block || {})) {
    const v = val(rec); if (v && (!blocks[id] || (v.version ?? 0) >= (blocks[id].version ?? 0))) blocks[id] = v;
  }
  const theme = p.config.theme;
  const failures = [];
  const fail = (s) => { failures.push(s); log.fail(s); };
  const ids = (onlyPages || pageIdsOf(m)).slice();
  if (!ids.length) return ["snapshot has no pages"];

  // A distinctive word from the content, for the search test.
  const words = Object.values(blocks).filter((b) => b.type === "text").flatMap((b) => plain(b.properties?.title).split(/\W+/)).filter((w) => w.length >= 6);
  const word = words.sort((a, b) => b.length - a.length)[Math.floor(words.length / 3)] || "design";

  const { ctx, page } = await openBrowser({ headless: true });
  let errors = [], bad = [];
  page.on("pageerror", (e) => { if (!IGNORE.test(e.message)) errors.push(e.message.slice(0, 160)); });
  page.on("response", (r) => { if (r.url().startsWith(base) && r.status() >= 400) bad.push(`${r.status()} ${r.url().replace(base, "")}`.slice(0, 160)); });
  try {
    for (const id of ids) for (let attempt = 0; attempt < 2; attempt++) {
      const hex = id.replace(/-/g, "");
      const path = Object.keys(m.pages).filter((k) => k.endsWith(hex)).sort((a, b) => b.length - a.length)[0] || `/${hex}`;
      errors = []; bad = [];
      const name = plain(blocks[id]?.properties?.title) || id;
      await page.goto(base + path, { waitUntil: "domcontentloaded", timeout: 60000 });
      const ok = await page.waitForSelector(".notion-page-content, .notion-collection_view_page-block", { timeout: 30000 }).then(() => true, () => false);
      if (!ok) { if (attempt === 0) { log.warn(`${name}: did not render, retrying`); continue; } fail(`${name}: page did not render`); break; }
      // Wait for the app to finish booting (a fresh deploy is slower: nothing is cached yet).
      await page.waitForSelector(".notion-topbar [role=button] svg.magnifyingGlass", { timeout: 20000 }).catch(() => {});
      await page.waitForFunction(() => ![...document.querySelectorAll("iframe[src*='file-preview']")].some((f) => getComputedStyle(f).visibility === "hidden" || !f.offsetHeight), null, { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1500);
      // Scroll through so lazy images load, then check every image actually decoded.
      await page.evaluate(async () => {
        const sc = document.querySelector(".notion-frame .notion-scroller") || document.scrollingElement;
        for (let y = 0; y < sc.scrollHeight; y += 500) { sc.scrollTo({ top: y, behavior: "instant" }); await new Promise((r) => setTimeout(r, 200)); }
        sc.scrollTo({ top: 0, behavior: "instant" });
      });
      await page.waitForTimeout(1500);
      const r = await page.evaluate(() => {
        const imgs = [...document.querySelectorAll(".notion-frame img")].filter((i) => i.getBoundingClientRect().width > 40);
        const text = document.querySelector(".notion-page-content [data-content-editable-leaf], .notion-page-content .notion-text-block [contenteditable], .notion-page-content .notion-text-block");
        const blockImg = document.querySelector(".notion-image-block img");
        return {
          title: document.title,
          dark: document.body.classList.contains("dark") || !!document.querySelector(".notion-dark-theme"),
          broken: imgs.filter((i) => !i.complete || !i.naturalWidth).map((i) => i.src.slice(0, 80)),
          bg: getComputedStyle(document.querySelector(".notion-app-inner") || document.body).backgroundColor,
          font: text ? getComputedStyle(text).fontFamily : "",
          radius: blockImg ? getComputedStyle(blockImg).borderTopLeftRadius : null,
          hiddenEmbeds: [...document.querySelectorAll(".notion-embed-block iframe, iframe[src*='file-preview']")].filter((f) => getComputedStyle(f).visibility === "hidden" || !f.offsetHeight).length,
          chrome: [...document.querySelectorAll('.notion-topbar [aria-label="Share site to socials"], .notion-topbar [aria-label="More actions"]')].filter((e) => e.offsetWidth).length,
          getNotion: [...document.querySelectorAll(".notion-topbar [role=button]")].filter((b) => /^Get Notion/.test(b.textContent.trim()) && b.offsetWidth).length,
          searchIcon: !!document.querySelector(".notion-topbar [role=button] svg.magnifyingGlass"),
          // Header text should start where the page text starts (headerWidth: "content").
          headerOffset: (() => {
            const bar = document.querySelector(".notion-topbar > div"), pc = document.querySelector(".notion-frame .notion-page-content");
            if (!bar || !pc) return null;
            const w = document.createTreeWalker(bar.firstElementChild || bar, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.data.trim() ? 1 : 3) });
            const n = w.nextNode(); if (!n) return null;
            const rg = document.createRange(); rg.selectNodeContents(n);
            return Math.round(rg.getBoundingClientRect().left - (pc.getBoundingClientRect().left + parseFloat(getComputedStyle(pc).paddingLeft) + 8));
          })(),
        };
      });
      const problems = [];
      if (blocks[id] && name && !r.title.includes(name.slice(0, 20))) problems.push(`title "${r.title}"`);
      if (r.broken.length) problems.push(`${r.broken.length} broken image(s)`);
      if (r.hiddenEmbeds) problems.push(`${r.hiddenEmbeds} embed(s) not shown`);
      if (theme.mode === "light" && r.dark) problems.push("dark theme active");
      if (theme.background && hexToRgb(theme.background) && r.bg !== hexToRgb(theme.background)) problems.push(`background ${r.bg}`);
      if (theme.font && r.font && !r.font.replace(/"/g, "").startsWith(theme.font.family)) problems.push(`font ${r.font.slice(0, 40)}`);
      if (theme.imageRadius != null && r.radius && r.radius !== `${theme.imageRadius}px`) problems.push(`image radius ${r.radius}`);
      if ((theme.hide || []).includes("share") && r.chrome) problems.push("Notion buttons visible");
      if ((theme.hide || []).includes("getNotion") && r.getNotion) problems.push('"Get Notion" visible');
      if (!r.searchIcon) problems.push("search button missing");
      if (theme.headerWidth === "content" && r.headerOffset != null && Math.abs(r.headerOffset) > 3) problems.push(`header off by ${r.headerOffset}px`);
      if (errors.length) problems.push(`errors: ${errors.join(" | ")}`);
      if (bad.length) problems.push(`requests failed: ${[...new Set(bad)].slice(0, 4).join(", ")}`);
      if (problems.length && attempt === 0) { log.warn(`${name}: ${problems.join("; ")} (retrying once)`); continue; }
      if (problems.length) fail(`${name}: ${problems.join("; ")}`);
      else log.ok(name);
      if (shots) await page.screenshot({ path: join(shots, `${hex}.png`) });
      break;
    }

    // Desktop search through the real UI.
    const rootHex = m.root.replace(/-/g, "");
    const rootPath = Object.keys(m.pages).filter((k) => k.endsWith(rootHex)).sort((a, b) => b.length - a.length)[0];
    await page.goto(base + rootPath, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".notion-topbar [role=button] svg.magnifyingGlass", { timeout: 30000 });
    await page.waitForTimeout(1000);
    await page.click('.notion-topbar [role=button]:has(svg.magnifyingGlass)').catch(() => page.keyboard.press("Meta+k"));
    await page.waitForSelector("[role=dialog] input, [role=dialog] [contenteditable]", { timeout: 10000 }).catch(() => {});
    await page.keyboard.type(word, { delay: 40 });
    await page.waitForFunction(() => /Search results \(\d+\)/.test(document.querySelector("[role=dialog]")?.innerText || ""), null, { timeout: 10000 }).catch(() => {});
    const hits = await page.evaluate(() => (document.querySelector("[role=dialog]")?.innerText || "").match(/Search results \((\d+)\)/)?.[1]);
    if (!hits) fail(`search for "${word}" returned nothing`); else log.ok(`search "${word}": ${hits} result(s)`);
  } finally { await ctx.close(); }

  // Mobile: page renders and the header search opens Notion's search sheet.
  const mob = await openBrowser({ headless: true, mobile: true });
  try {
    await mob.page.goto(base + "/", { waitUntil: "domcontentloaded" });
    const ok = await mob.page.waitForSelector(".notion-page-content", { timeout: 30000 }).then(() => true, () => false);
    if (!ok) fail("mobile: home did not render");
    else if (theme.hide?.includes("more")) {
      const btn = 'header.notion-topbar-mobile [aria-label="More actions"]';
      await mob.page.waitForSelector(btn, { timeout: 20000 });
      await mob.page.waitForTimeout(1500);
      let txt = "";
      for (let attempt = 0; attempt < 2 && !/Best matches/.test(txt); attempt++) {
        if (attempt) { await mob.page.keyboard.press("Escape").catch(() => {}); await mob.page.waitForTimeout(1000); }
        await mob.page.tap(btn);
        await mob.page.waitForSelector(".notion-overlay-container input", { timeout: 10000 }).catch(() => {});
        await mob.page.keyboard.type(word, { delay: 40 });
        await mob.page.waitForFunction(() => /Best matches/.test(document.querySelector(".notion-overlay-container")?.innerText || ""), null, { timeout: 10000 }).catch(() => {});
        txt = await mob.page.evaluate(() => document.querySelector(".notion-overlay-container")?.innerText || "");
      }
      if (!/Best matches/.test(txt)) fail("mobile: header search did not open search"); else log.ok("mobile search");
      if (shots) await mob.page.screenshot({ path: join(shots, "mobile-search.png") });
    } else log.ok("mobile home");
  } finally { await mob.ctx.close(); }
  return failures;
}
