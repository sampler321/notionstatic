// Image optimization for the static build: every raster image under /_img gets WebP copies at a
// few widths (never wider than the original), and every <img> pointing at it gets src/srcset/sizes,
// width/height (no layout shift) and data-full (the largest copy, for the lightbox). Originals stay
// for "Download" / "View original". Copies are named by content hash, cached between builds in
// .notionstatic/imgcache, and served with a one-year immutable cache header.
import { mkdir, readFile, writeFile, readdir, copyFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import { createHash } from "node:crypto";
import { log } from "./log.mjs";

const WIDTHS = [96, 192, 320, 640, 960, 1440, 2160];
const MAX = 2560;
const RASTER = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export async function optimizeImages(p, dist, pages) {
  const sharp = (await import("sharp")).default;
  const cache = join(p.dir, ".notionstatic/imgcache");
  await mkdir(cache, { recursive: true });
  await mkdir(join(dist, "_img/o"), { recursive: true });
  const variants = {}; // "/_img/x.png" -> { w, h, set: [[url, width]], full }
  let before = 0, after = 0, made = 0;
  for (const f of await readdir(join(dist, "_img"), { withFileTypes: true })) {
    if (!f.isFile() || !RASTER.has(extname(f.name).toLowerCase())) continue;
    const file = join(dist, "_img", f.name);
    const buf = await readFile(file);
    const hash = createHash("sha1").update(buf).digest("hex").slice(0, 16);
    let meta;
    try { meta = await sharp(buf).metadata(); } catch { continue; }
    if (!meta.width || (meta.pages || 1) > 1) continue; // animated: keep as is
    const top = Math.min(meta.width, MAX);
    const widths = [...WIDTHS.filter((w) => w < top), top];
    const set = [];
    for (const w of widths) {
      const name = `${hash}-${w}.webp`;
      const cached = join(cache, name);
      if (!existsSync(cached)) {
        await sharp(buf).resize({ width: w, withoutEnlargement: true }).webp({ quality: 80, effort: 5, alphaQuality: 90 }).toFile(cached);
        made++;
      }
      await copyFile(cached, join(dist, "_img/o", name));
      set.push([`/_img/o/${name}`, w]);
    }
    before += buf.length;
    after += (await stat(join(cache, `${hash}-${top}.webp`))).size;
    variants[`/_img/${f.name}`] = { w: meta.width, h: meta.height, set, full: set.at(-1)[0] };
  }

  // Rewrite <img> tags. sizes follows where the image sits: cover = full width, gallery card,
  // icon (its inline width) or a content image (720px column, full width on phones).
  const CONTENT = "(max-width: 768px) calc(100vw - 32px), 720px";
  for (const f of pages) {
    const path = join(f.parentPath, f.name);
    let html = await readFile(path, "utf8");
    let changed = false;
    html = html.replace(/(<div class="ns-(cover|card-cover)[^"]*"[^>]*>\s*)?<img\b([^>]*?)\bsrc="(\/_img\/[^"/]+)"([^>]*)>/g, (m, wrap, kind, pre, src, post) => {
      const v = variants[src];
      if (!v) return m;
      const attrs = pre + post;
      const icon = attrs.match(/style="[^"]*width:\s*([\d.]+)px/);
      const sizes = kind === "cover" ? "100vw" : kind === "card-cover" ? "(max-width: 768px) calc(100vw - 32px), 400px" : icon ? `${icon[1]}px` : CONTENT;
      const fallback = (v.set.find(([, w]) => w >= 960) || v.set.at(-1))[0];
      const srcset = v.set.map(([u, w]) => `${u} ${w}w`).join(", ");
      const dims = /\bwidth=/.test(attrs) ? "" : ` width="${v.w}" height="${v.h}"`;
      const full = /data-zoom/.test(attrs) ? ` data-full="${v.full}"` : "";
      changed = true;
      return `${wrap || ""}<img${pre}src="${fallback}" srcset="${srcset}" sizes="${sizes}"${dims}${full}${post}>`;
    });
    if (changed) await writeFile(path, html);
  }

  // Search previews (page covers/icons in /ns-pages.json): a mid-size copy is plenty.
  const pj = join(dist, "ns-pages.json");
  if (existsSync(pj)) {
    let json = await readFile(pj, "utf8");
    for (const [src, v] of Object.entries(variants)) json = json.split(`"${src}"`).join(`"${(v.set.find(([, w]) => w >= 640) || v.set.at(-1))[0]}"`);
    await writeFile(pj, json);
  }

  // Content-hashed copies never change: let browsers keep them for a year.
  const headers = join(dist, "_headers");
  const prev = existsSync(headers) ? await readFile(headers, "utf8") : "";
  await writeFile(headers, prev + "/_img/o/*\n  Cache-Control: public, max-age=31536000, immutable\n/_custom/fonts/*\n  Cache-Control: public, max-age=31536000, immutable\n");

  const mb = (n) => (n / 1048576).toFixed(1) + " MB";
  log.ok(`images: ${Object.keys(variants).length} optimized (${made} new copies), largest copies ${mb(after)} vs originals ${mb(before)}`);
}
