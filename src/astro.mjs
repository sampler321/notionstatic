// Build the static site with Astro: snapshot data -> HTML in .notionstatic/dist, plus images,
// fonts, HTML embeds and a Pagefind search index. No JavaScript is needed to render pages.
import { cp, rm, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { log } from "./log.mjs";

const TOOL = join(dirname(fileURLToPath(import.meta.url)), "..");
const RENDERER = join(TOOL, "renderer");

export const distOf = (p) => join(p.dir, ".notionstatic/dist");

export async function buildAstro(p) {
  const dist = distOf(p);
  await rm(dist, { recursive: true, force: true });
  const out = join(RENDERER, ".build", createHash("sha1").update(p.dir).digest("hex").slice(0, 12));
  await rm(out, { recursive: true, force: true });
  // Separate process started in the renderer folder: Astro resolves its caches and the
  // prerender chunks from the working directory, which must see the tool's node_modules.
  const { execFileSync } = await import("node:child_process");
  try {
    execFileSync(process.execPath, [join(TOOL, "node_modules/astro/bin/astro.mjs"), "build", "--silent"], { cwd: RENDERER, env: { ...process.env, NS_PROJECT: p.dir, NS_OUT: out }, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  } catch (e) { throw new Error(`astro build failed:\n${(e.stderr || e.stdout || e.message).toString().slice(-2000)}`); }
  await rm(join(out, ".prerender"), { recursive: true, force: true });
  await cp(out, dist, { recursive: true });
  await rm(out, { recursive: true, force: true });

  // Static files the pages reference.
  for (const d of ["_img", "_custom", "_artifacts"]) if (existsSync(join(p.site, d))) await cp(join(p.site, d), join(dist, d), { recursive: true });

  // HTML embeds: give the uploaded file the theme font, without Notion's frame bridge.
  const site = JSON.parse(await readFile(join(p.site, "_data/site.json"), "utf8").catch(() => "{}"));
  if (existsSync(join(dist, "_artifacts"))) {
    for (const f of await readdir(join(dist, "_artifacts"), { recursive: true, withFileTypes: true })) {
      if (!f.isFile() || !/\.html?$/.test(f.name)) continue;
      const file = join(f.parentPath, f.name);
      let html = await readFile(file, "utf8");
      html = html.replace(/<script>;\(function \(\) \{[\s\S]*?\}\)\(\)\s*<\/script>/, ""); // Notion bridge, not needed here
      if (site.astro?.embedCss) html = html.replace(/<head[^>]*>/i, (m) => `${m}<style>${site.astro.embedCss}</style>`);
      await writeFile(file, html);
    }
  }

  // External images still pointing at the internet: download them so the site is self-contained.
  const sha = (s) => createHash("sha1").update(s).digest("hex").slice(0, 16);
  const urls = new Set();
  const pages = (await readdir(dist, { recursive: true, withFileTypes: true })).filter((f) => f.isFile() && f.name.endsWith(".html") && !f.parentPath.includes("_artifacts"));
  for (const f of pages) for (const m of (await readFile(join(f.parentPath, f.name), "utf8")).matchAll(/<img[^>]+src="(https?:\/\/[^"]+)"/g)) urls.add(m[1].replace(/&amp;/g, "&"));
  const local = {};
  for (const u of urls) {
    const res = await fetch(u).catch(() => null);
    if (!res?.ok) { log.warn(`external image not downloadable, kept remote: ${u.slice(0, 90)}`); continue; }
    const type = (res.headers.get("content-type") || "").split(";")[0];
    const ext = { "image/svg+xml": ".svg", "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp" }[type] || extname(new URL(u).pathname) || "";
    const name = `/_img/ext-${sha(u)}${ext}`;
    await mkdir(join(dist, "_img"), { recursive: true });
    await writeFile(join(dist, name), Buffer.from(await res.arrayBuffer()));
    local[u] = name;
  }
  if (Object.keys(local).length) {
    for (const f of pages) {
      const file = join(f.parentPath, f.name);
      let html = await readFile(file, "utf8");
      for (const [u, l] of Object.entries(local)) html = html.split(u.replace(/&/g, "&amp;")).join(l).split(u).join(l);
      await writeFile(file, html);
    }
  }

  if (p.config.optimizeImages !== false && existsSync(join(dist, "_img"))) {
    const { optimizeImages } = await import("./images.mjs");
    await optimizeImages(p, dist, pages);
  }

  await mkdir(join(dist, "_ns"), { recursive: true });
  await writeFile(join(dist, "_ns/build.json"), JSON.stringify({ built: site.built, renderer: "astro" }));
  log.ok(`astro: ${pages.length} pages, ${Object.keys(local).length} external images localized`);
  return dist;
}
