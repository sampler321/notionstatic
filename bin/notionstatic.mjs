#!/usr/bin/env node
// notionstatic: freeze a published Notion site and serve it from Cloudflare.
import { rename, rm, mkdir, writeFile, access } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { findProject, loadProject } from "../src/project.mjs";
import { log } from "../src/log.mjs";

const HELP = `notionstatic <command> [options]

  deploy            snapshot Notion, validate, apply theme, test locally, upload and go live
    --check-live      also test the preview URL before going live and the live URL after
                      (auto-rollback if that fails); slower
    --skip-snapshot   reuse the current snapshot (e.g. after changing only the theme)
    --force           deploy even if validation or the local test reports problems
  snapshot          crawl Notion into the project (validated before it replaces the current one)
  build             apply theme/custom CSS to the current snapshot
  dev               preview locally (http://localhost:8787)
  test [url]        smoke test a running copy (default: local preview of the current snapshot)
  rollback          restore the previous snapshot and deploy it
  compare <ref-url> [--mobile] [--visual]
                    measure the Astro build against a reference (e.g. a Notion-app version's
                    preview URL): every block's position/size; --visual adds pixel diffs
  status            show project, snapshot and theme info
  init <notion-url> create notionstatic.config.mjs in the current folder

  --project <dir>   project folder (default: current folder, else the last one used)`;

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

async function project() {
  const dir = findProject(opt("--project"));
  if (!dir) throw new Error("no notionstatic.config.mjs here (run `notionstatic init <notion-url>` or pass --project <dir>)");
  return loadProject(dir);
}

async function doSnapshot(p) {
  const { snapshot } = await import("../src/snapshot.mjs");
  const { validate } = await import("../src/validate.mjs");
  log.head(`Snapshot ${p.config.source}`);
  await snapshot(p);
  log.head("Validate");
  const { problems, stats } = await validate(p.staging, existsSync(p.site) ? p.site : null, { renderer: p.config.renderer });
  log.step(`${stats.pages} pages, ${stats.images} images, ${stats.records} records${stats.chunks ? `, ${stats.chunks} code chunks` : ""}`);
  if (problems.length) {
    problems.forEach((x) => log.fail(x));
    if (!flag("--force")) throw new Error("snapshot incomplete; the live copy was left untouched (rerun, or --force)");
    log.warn("--force: using it anyway");
  } else log.ok("snapshot complete");
  // Swap: current -> previous, staging -> current.
  await rm(p.previous, { recursive: true, force: true });
  if (existsSync(p.site)) await rename(p.site, p.previous);
  await rename(p.staging, p.site);
  log.ok("snapshot swapped in (previous kept for rollback)");
}

async function doBuild(p) {
  const { build } = await import("../src/build.mjs");
  log.head(p.config.renderer === "astro" ? "Build (Astro)" : "Theme");
  const site = await build(p);
  if (p.config.renderer === "astro") await (await import("../src/astro.mjs")).buildAstro(p);
  return site;
}
// Where a deployed copy reports which build it is serving.
const stampPath = (p) => (p.config.renderer === "astro" ? "/_ns/build.json" : "/_data/site.json");

async function localTest(p) {
  const { devServer } = await import("../src/wrangler.mjs");
  const { smoke } = await import("../src/smoke.mjs");
  log.head("Test locally");
  const server = await devServer(p);
  try {
    await mkdir(p.reports, { recursive: true });
    return await smoke(p, server.url, { shots: p.reports });
  } finally { await server.stop(); }
}

// A fresh version has nothing cached at Cloudflare's edge: load one page fully first.
async function warmUp(p, url, built) {
  for (let i = 0; i < 40; i++) {
    const s = await fetch(url + stampPath(p), { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    if (s?.built === built) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  const { openBrowser } = await import("../src/browser.mjs");
  const { ctx, page } = await openBrowser({ headless: true });
  try {
    await page.goto(url + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector(".notion-topbar [role=button] svg.magnifyingGlass, .ns-content", { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(3000);
  } finally { await ctx.close(); }
}

async function liveTest(p, url, built, label = "Test live") {
  const { smoke } = await import("../src/smoke.mjs");
  log.head(`${label} ${url}`);
  // Wait until the new version is the one being served.
  for (let i = 0; i < 40; i++) {
    const s = await fetch(url + stampPath(p), { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    if (s?.built === built) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return smoke(p, url);
}

async function doDeploy(p) {
  const { wrangler, whoami } = await import("../src/wrangler.mjs");
  if (!whoami(p)) throw new Error("not logged in to Cloudflare: run `npx wrangler login` first");
  if (!flag("--skip-snapshot")) await doSnapshot(p);
  if (!existsSync(join(p.site, "_data/manifest.json"))) throw new Error("no snapshot yet: run without --skip-snapshot");
  if (flag("--skip-snapshot")) {
    // The current snapshot gets the same checks a fresh one would (files can go missing on disk).
    const { validate } = await import("../src/validate.mjs");
    const { problems } = await validate(p.site, null, { renderer: p.config.renderer });
    if (problems.length) {
      problems.forEach((x) => log.fail(x));
      if (!flag("--force")) throw new Error("current snapshot is incomplete; run `notionstatic deploy` for a fresh one");
    }
  }
  const site = await doBuild(p);
  const failures = await localTest(p);
  if (failures.length) {
    if (!flag("--force")) {
      if (!flag("--skip-snapshot") && existsSync(p.previous)) {
        await rm(p.site + ".failed", { recursive: true, force: true });
        await rename(p.site, p.site + ".failed");
        await rename(p.previous, p.site);
        log.warn(`restored the previous snapshot; the failed one is in ${p.site}.failed`);
      }
      throw new Error(`${failures.length} local test failure(s); nothing was deployed (screenshots: ${p.reports})`);
    }
    log.warn("--force: deploying despite test failures");
  }
  log.head("Upload");
  // Upload the version without serving it, test it on its own preview URL (a fresh hostname,
  // so nothing is cached), and only then send production traffic to it.
  const up = wrangler(p, ["versions", "upload", "--message", `notionstatic ${new Date().toISOString()}`], { capture: true });
  const version = up.match(/Worker Version ID: (\S+)/)?.[1];
  const preview = up.match(/Version Preview URL: (\S+)/)?.[1];
  if (!version) throw new Error(`upload failed:\n${up.slice(-800)}`);
  log.ok(`uploaded version ${version}`);
  if (preview && flag("--check-live")) {
    await warmUp(p, preview, site.built);
    const pre = await liveTest(p, preview, site.built, "Test preview");
    if (pre.length && !flag("--force")) throw new Error(`${pre.length} preview test failure(s); production was not touched (version ${version} stays unused)`);
  } else if (flag("--check-live")) log.warn("no preview URL (preview URLs disabled for this Worker); testing after going live");

  log.head("Go live");
  const out = wrangler(p, ["versions", "deploy", `${version}@100%`, "--message", "notionstatic deploy", "-y"], { capture: true });
  const url = p.config.domain ? `https://${[].concat(p.config.domain)[0]}` : (out + up).match(/https:\/\/(?![0-9a-f]{8}-)[\w.-]+\.workers\.dev/)?.[0] || (preview && preview.replace(/^https:\/\/[0-9a-f]{8}-/, "https://"));
  log.ok(`version ${version} is live at ${url}`);
  if (!url) return;
  if (!flag("--check-live")) {
    await writeFile(join(p.dir, ".notionstatic/last-deploy.json"), JSON.stringify({ url, version, at: new Date().toISOString() }));
    log.head(`Done: ${url}`);
    return;
  }
  // Production can take a minute or two to switch everywhere; retry before calling it broken.
  let live = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    live = await liveTest(p, url, site.built);
    if (!live.length) break;
    if (attempt < 3) { log.warn(`live check ${attempt}/3 failed, waiting 60s for Cloudflare to finish rolling out`); await new Promise((r) => setTimeout(r, 60000)); }
  }
  if (live.length) {
    log.fail(`${live.length} live test failure(s); rolling back to the previous Cloudflare version`);
    try { wrangler(p, ["rollback", "--message", "notionstatic: live test failed", "-y"], { capture: true }); log.warn("rolled back"); }
    catch (e) { log.fail(`rollback failed: ${e.message.split("\n")[0]}`); }
    throw new Error("live test failed");
  }
  await writeFile(join(p.dir, ".notionstatic/last-deploy.json"), JSON.stringify({ url, version, at: new Date().toISOString() }));
  log.head(`Done: ${url}`);
}

// One run per project at a time: runs share the Chrome profile and swap site/.
function lock(p) {
  const f = join(p.dir, ".notionstatic/lock");
  mkdirSync(join(p.dir, ".notionstatic"), { recursive: true });
  try {
    const pid = Number(readFileSync(f, "utf8"));
    if (pid && pid !== process.pid) { try { process.kill(pid, 0); throw new Error(`another notionstatic run (pid ${pid}) is using this project`); } catch (e) { if (e.code !== "ESRCH") throw e; } }
  } catch (e) { if (e.code !== "ENOENT") throw e; }
  writeFileSync(f, String(process.pid));
  process.on("exit", () => { try { if (readFileSync(f, "utf8") === String(process.pid)) unlinkSync(f); } catch {} });
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));
}

async function main() {
  if (!cmd || cmd === "help" || flag("--help")) return console.log(HELP);
  if (cmd === "init") {
    const url = args[1];
    if (!url) throw new Error("usage: notionstatic init <published-notion-url>");
    if (existsSync("notionstatic.config.mjs")) throw new Error("notionstatic.config.mjs already exists here");
    const name = (new URL(url).pathname.slice(1).replace(/-?[0-9a-f]{32}$/, "") || "notion-site").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
    await writeFile("notionstatic.config.mjs", `// notionstatic project config. Run \`notionstatic deploy\` after editing in Notion or here.
export default {
  source: ${JSON.stringify(url)},
  worker: ${JSON.stringify(name)},      // Cloudflare Worker name (becomes ${name}.<account>.workers.dev)
  // domain: "example.com",           // custom domain on your Cloudflare account (optional)
  theme: {
    mode: "light",                    // "light" | "dark" | "system"
    // background: "#FAF7F2",
    // surface: "#FFFDF9",            // cards, menus, popups
    // font: { family: "Ubuntu", google: "Ubuntu:ital,wght@0,400;0,500;0,700;1,400;1,700" },
    // imageRadius: 12,
    headerWidth: "content",           // "content" | "full"
    hide: ["share", "duplicate", "more", "getNotion"],
  },
  // css: "custom.css",               // extra CSS, injected after the theme
  // head: "head.html",               // extra HTML at the end of <head> (analytics, meta tags)
  // body: "body.html",               // extra HTML at the end of <body>
};
`);
    return log.ok("created notionstatic.config.mjs; edit it, then run `notionstatic deploy`");
  }
  const p = await project();
  log.step(`project ${p.dir}`);
  if (cmd !== "status") lock(p);
  if (cmd === "snapshot") return doSnapshot(p);
  if (cmd === "build") return doBuild(p);
  if (cmd === "deploy") return doDeploy(p);
  if (cmd === "dev") {
    const { devServer } = await import("../src/wrangler.mjs");
    await doBuild(p);
    const s = await devServer(p, { port: Number(opt("--port")) || 8787 });
    log.ok(`preview at ${s.url} (Ctrl+C to stop)`);
    await new Promise((r) => s.child.once("exit", r));
    return;
  }
  if (cmd === "test") {
    const url = args[1]?.startsWith("http") ? args[1].replace(/\/$/, "") : null;
    const failures = url ? await (await import("../src/smoke.mjs")).smoke(p, url) : await localTest(p);
    if (failures.length) throw new Error(`${failures.length} failure(s)`);
    return log.ok("all good");
  }
  if (cmd === "compare") {
    const ref = args[1]?.replace(/\/$/, "");
    if (!ref?.startsWith("http")) throw new Error("usage: notionstatic compare <reference-url> [--mobile] [--visual]");
    const { compare, serve } = await import("../src/compare.mjs");
    const { pageIdsOf } = await import("../src/project.mjs");
    const m = JSON.parse(await (await import("node:fs/promises")).readFile(join(p.site, "_data/manifest.json"), "utf8"));
    const paths = pageIdsOf(m).map((id) => Object.keys(m.pages).filter((k) => k.endsWith(id.replace(/-/g, ""))).sort((a, b) => b.length - a.length)[0]).filter(Boolean);
    const s = await serve(p.dist);
    let off = 0, total = 0;
    try {
      for (const path of paths) {
        const r = await compare(ref + path, s.url + path, { mobile: flag("--mobile"), limit: Number(opt("--limit")) || 3, profile: p.profile });
        total += r.total; off += r.bad;
        (r.bad ? log.warn : log.ok)(`${path.slice(0, 60)}: ${r.matched}/${r.total} blocks, ${r.bad} off by >2px, height ${r.refHeight} vs ${r.ourHeight}`);
        for (const x of r.rows) log.step(x.missing ? `missing ${x.t} ${x.id.slice(0, 8)}` : `${x.t} ${x.id.slice(0, 8)} dx${x.dx} dy${x.dy} dw${x.dw} dh${x.dh}`);
      }
    } finally { s.close(); }
    if (flag("--visual")) {
      const { visual } = await import("../src/visual.mjs");
      await visual(p.dir, ref, paths, { out: join(p.reports, "visual") });
      log.step(`side-by-side images in ${join(p.reports, "visual")}`);
    }
    return log.head(`${total - off}/${total} blocks within 2px`);
  }
  if (cmd === "rollback") {
    if (!existsSync(p.previous)) throw new Error("no previous snapshot to roll back to");
    const tmp = p.site + ".rollback";
    await rename(p.site, tmp); await rename(p.previous, p.site); await rename(tmp, p.previous);
    log.ok("previous snapshot restored (the newer one is kept as previous)");
    args.push("--skip-snapshot");
    return doDeploy(p);
  }
  if (cmd === "status") {
    const read = async (f) => JSON.parse(await (await import("node:fs/promises")).readFile(f, "utf8"));
    const m = await read(join(p.site, "_data/manifest.json")).catch(() => null);
    const d = await read(join(p.dir, ".notionstatic/last-deploy.json")).catch(() => null);
    console.log(JSON.stringify({ source: p.config.source, worker: p.config.worker, snapshot: m && { created: m.created, pages: m.visited?.length }, lastDeploy: d, theme: p.config.theme }, null, 2));
    return;
  }
  throw new Error(`unknown command "${cmd}"\n\n${HELP}`);
}

main().catch((e) => { log.fail(e.message); process.exit(1); });
