// A notionstatic project is a folder with notionstatic.config.mjs. Everything the
// tool writes (snapshot, browser profile, reports) lives inside that folder.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";

const LAST = join(homedir(), ".notionstatic.json"); // remembers the last project used

export const DEFAULTS = {
  renderer: "astro",        // "astro": static HTML rebuilt from the snapshot | "notion": replay Notion's own app
  crawl: { delayMs: 4000, maxPages: 500 },
  theme: {
    mode: "light",          // "light" | "dark" | "system"
    background: null,       // page background, e.g. "#FAF7F2"
    surface: null,          // cards, popups, menus
    font: null,             // { family: "Ubuntu", google: "Ubuntu:wght@400;500;700" } or { family, files: ["fonts/x.woff2"] }
    imageRadius: null,      // px, rounds image blocks, gallery cards and page covers
    vars: {},               // raw Notion CSS variables, e.g. { "--c-graBacPri": "#F3EFE8" }
    headerWidth: "content", // "content" | "full"
    hide: ["share", "duplicate", "more", "getNotion"],
    applyToEmbeds: true,    // apply font to HTML embeds too
    hideHomeTitle: false,   // hide the home page title on the site (kept for SEO/screen readers)
    hideTitleOn: [],        // more pages whose title + icon are hidden: titles or ids, "home" = root
    homeLink: null,         // label/icon for links to the home page on the site, e.g. { title: "Home", icon: "🏠" }
  },
  favicon: null, // icon URL or project file (png/ico/svg); a { icon, apple } pair sets the apple-touch-icon too
  css: null,   // extra CSS file (path relative to the project)
  head: null,  // extra HTML file injected at the end of <head>
  body: null,  // extra HTML file injected at the end of <body>
};

function merge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) out[k] = v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" ? merge(a[k], v) : v;
  return out;
}

export function findProject(explicit) {
  const tries = [explicit, process.env.NOTIONSTATIC_PROJECT, process.cwd()];
  for (const t of tries) if (t && existsSync(join(resolve(t), "notionstatic.config.mjs"))) return resolve(t);
  try { const last = JSON.parse(readFileSync(LAST, "utf8")).project; if (existsSync(join(last, "notionstatic.config.mjs"))) return last; } catch {}
  return null;
}

export async function loadProject(dir) {
  const file = join(dir, "notionstatic.config.mjs");
  const mod = await import(pathToFileURL(file).href + "?t=" + Date.now());
  const config = merge(DEFAULTS, mod.default);
  if (!config.source || !/^https:\/\/[^/]+\/.*[0-9a-f]{32}/.test(config.source)) throw new Error(`config.source must be a published Notion page URL ending in its 32-char id (got ${config.source})`);
  if (!config.worker || !/^[a-z0-9-]{1,63}$/.test(config.worker)) throw new Error("config.worker must be a Cloudflare Worker name (lowercase letters, digits, dashes)");
  if (!["astro", "notion"].includes(config.renderer)) throw new Error(`config.renderer must be "astro" or "notion" (got ${config.renderer})`);
  writeFileSync(LAST, JSON.stringify({ project: dir }));
  const state = join(dir, ".notionstatic");
  return {
    dir, config,
    site: join(dir, "site"),            // what gets deployed
    staging: join(state, "staging"),    // snapshot is built here, validated, then swapped in
    previous: join(state, "previous"),  // last good snapshot, for `notionstatic rollback`
    profile: join(state, "profile"),    // Chrome profile (keeps Cloudflare clearance)
    sticky: join(state, "sticky-api.json"),
    reports: join(state, "reports"),
    wrangler: join(state, "wrangler.toml"),
    dist: join(state, "dist"),          // astro renderer output (what gets deployed in astro mode)
  };
}

// Page ids of a snapshot (older manifests lack `visited`: derive them from the page shells).
export function pageIdsOf(m) {
  if (m.visited?.length) return m.visited;
  return [...new Set(Object.keys(m.pages).map((p) => p.slice(-32)).filter((h) => /^[0-9a-f]{32}$/.test(h)))]
    .map((h) => h.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5"));
}
