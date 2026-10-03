// Layout comparison: reference (the Notion-app copy or notion.site) vs the Astro build.
// Matches blocks by data-block-id and reports position/size differences in px.
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { chromium } from "playwright";

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".woff2": "font/woff2", ".wasm": "application/wasm", ".pf_meta": "application/octet-stream" };

// Static server with Cloudflare-like routing: /About-x -> About-x.html, / -> index.html.
export function serve(dir, port = 0) {
  const server = http.createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const tries = path === "/" ? ["/index.html"] : [path, path + ".html", path + "/index.html"];
    for (const t of tries) {
      try { const f = join(dir, t); if ((await stat(f)).isFile()) { res.writeHead(200, { "content-type": TYPES[extname(f)] || "application/octet-stream" }); return res.end(await readFile(f)); } } catch {}
    }
    res.writeHead(404); res.end("not found");
  });
  return new Promise((r) => server.listen(port, () => r({ url: `http://localhost:${server.address().port}`, close: () => server.close() })));
}

async function measure(page, url, mobile) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".notion-page-content, .ns-content", { timeout: 30000 });
  await page.waitForTimeout(url.includes("localhost") ? 1500 : 6000);
  // Load lazy images everywhere, then return to the top.
  await page.evaluate(async () => {
    const sc = document.querySelector(".notion-frame .notion-scroller") || document.scrollingElement;
    for (let y = 0; y < sc.scrollHeight; y += 700) { sc.scrollTo({ top: y, behavior: "instant" }); await new Promise((r) => setTimeout(r, 120)); }
    sc.scrollTo({ top: 0, behavior: "instant" });
    await Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; setTimeout(r, 4000); }))));
  });
  await page.waitForTimeout(800);
  return page.evaluate(() => {
    const out = {};
    for (const el of document.querySelectorAll("[data-block-id]")) {
      const id = el.getAttribute("data-block-id");
      if (out[id]) continue;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      if (el.closest(".notion-topbar, .ns-topbar")) continue; // breadcrumbs are not content
      out[id] = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), t: (el.className.toString().match(/notion-([a-z_]+)-block/) || el.className.toString().match(/ns-([a-z_-]+)/) || [])[1] || el.tagName };
    }
    const title = document.querySelector(".notion-page-block h1, h1.ns-title");
    if (title) { const r = title.getBoundingClientRect(); out.__title = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), t: "title" }; }
    return out;
  });
}

// A notion.site reference needs real headed Chrome (Cloudflare blocks headless): pass `profile`.
export async function compare(refUrl, ourUrl, { mobile = false, limit = 25, all = false, from = 0, profile } = {}) {
  const opts = mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } };
  let b, newPage;
  if (profile && /\.notion\.site\//.test(refUrl)) {
    const { openBrowser } = await import("./browser.mjs");
    const o = await openBrowser({ profile, mobile });
    b = o.ctx; newPage = () => o.ctx.newPage();
  } else { b = await chromium.launch(); newPage = () => b.newPage(opts); }
  try {
    const ref = await measure(await newPage(), refUrl, mobile);
    const ours = await measure(await newPage(), ourUrl, mobile);
    const rows = [];
    for (const [id, r] of Object.entries(ref)) {
      const o = ours[id];
      if (!o) { rows.push({ id, t: r.t, missing: true, ...r }); continue; }
      const d = { dx: o.x - r.x, dy: o.y - r.y, dw: o.w - r.w, dh: o.h - r.h };
      rows.push({ id, t: r.t, ref: r, ours: o, ...d });
    }
    rows.sort((a, b) => (a.ref?.y ?? a.y) - (b.ref?.y ?? b.y));
    if (from) rows.splice(0, rows.findIndex((r) => (r.ref?.y ?? r.y) >= from));
    const bad = rows.filter((r) => r.missing || Math.max(Math.abs(r.dx), Math.abs(r.dy), Math.abs(r.dw), Math.abs(r.dh)) > (all ? -1 : 2));
    const extra = Object.keys(ours).filter((id) => !ref[id]);
    return { total: rows.length, matched: rows.filter((r) => !r.missing).length, bad: bad.length, rows: bad.slice(0, limit), extra: extra.length, refHeight: Math.max(...Object.values(ref).map((r) => r.y + r.h)), ourHeight: Math.max(...Object.values(ours).map((r) => r.y + r.h)) };
  } finally { await b.close(); }
}

// CLI: node src/compare.mjs <project-dir> <refBase> <path> [--mobile]
if (import.meta.url === `file://${process.argv[1]}`) {
  const [projectDir, refBase, path = "/", ...rest] = process.argv.slice(2);
  const mobile = rest.includes("--mobile");
  const s = await serve(join(projectDir, ".notionstatic/dist"));
  const r = await compare(refBase + path, s.url + path, { mobile, all: rest.includes("--all"), from: Number(rest.find((x) => x.startsWith("--from="))?.slice(7) || 0), limit: Number(rest.find((x) => /^\d+$/.test(x)) || 25) });
  console.log(`${path} ${mobile ? "(mobile)" : ""}: ${r.matched}/${r.total} blocks matched, ${r.bad} off by >2px, page height ref ${r.refHeight} vs ours ${r.ourHeight}`);
  for (const x of r.rows) console.log(x.missing ? `  MISSING ${x.t} ${x.id.slice(0, 8)} at y=${x.y} ${x.w}x${x.h}` : `  ${x.t.padEnd(16)} ${x.id.slice(0, 8)} ref(${x.ref.x},${x.ref.y} ${x.ref.w}x${x.ref.h}) d(x${x.dx} y${x.dy} w${x.dw} h${x.dh})`);
  s.close();
}
