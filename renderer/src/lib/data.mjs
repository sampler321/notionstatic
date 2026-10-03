// Loads a notionstatic snapshot (site/_data) into a block store the Astro pages render from.
// Every record is taken at its newest version across all recorded API responses.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PROJECT = process.env.NS_PROJECT;
if (!PROJECT) throw new Error("NS_PROJECT is not set (run through `notionstatic`)");
const SNAP = join(PROJECT, "site");

export const val = (rec) => rec?.value?.value || rec?.value;
const dash = (h) => String(h || "").replace(/-/g, "").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
export const hex = (id) => String(id || "").replace(/-/g, "");
export const plain = (rt) => (Array.isArray(rt) ? rt.map((s) => (typeof s?.[0] === "string" ? s[0] : "")).join("") : "");

let store;
export function load() {
  if (store) return store;
  const manifest = JSON.parse(readFileSync(join(SNAP, "_data/manifest.json"), "utf8"));
  const api = JSON.parse(readFileSync(join(SNAP, "_data/api.json"), "utf8"));
  let site = {};
  try { site = JSON.parse(readFileSync(join(SNAP, "_data/site.json"), "utf8")); } catch {}

  const tables = {};
  for (const r of api) {
    for (const [table, recs] of Object.entries(r.res?.recordMap || {})) {
      if (!recs || typeof recs !== "object") continue;
      const t = (tables[table] ||= {});
      for (const [id, rec] of Object.entries(recs)) {
        const v = val(rec);
        if (v && (!t[id] || (v.version ?? 0) >= (t[id].version ?? 0))) t[id] = v;
      }
    }
  }
  const blocks = tables.block || {};

  // Rows of each collection view, in Notion's order (filters/sorts already applied by Notion).
  const viewRows = {};
  for (const r of api) {
    if (r.ep !== "queryCollection") continue;
    const view = r.req?.collectionView?.id;
    const ids = r.res?.result?.reducerResults?.collection_group_results?.blockIds || r.res?.result?.blockIds;
    if (view && ids && (!viewRows[view] || ids.length >= viewRows[view].length)) viewRows[view] = ids;
  }

  // Page paths: Notion's own slug paths, so every link keeps working; "/" is the root.
  const pageIds = (manifest.visited?.length ? manifest.visited : Object.keys(manifest.pages).map((p) => p.slice(-32)).filter((h) => /^[0-9a-f]{32}$/.test(h)).map(dash));
  const paths = {};
  for (const id of new Set(pageIds)) {
    const h = hex(id);
    const best = Object.keys(manifest.pages).filter((p) => p.endsWith(h)).sort((a, b) => b.length - a.length)[0];
    paths[id] = best || `/${h}`;
  }
  const root = manifest.root;

  // Images: by exact source+block, else by source from any block.
  const imgBySource = {};
  for (const [key, img] of Object.entries(manifest.images)) {
    const src = key.slice("/image/".length, key.lastIndexOf("|"));
    imgBySource[src] ||= img;
  }
  const image = (source, blockId) => {
    if (!source) return null;
    const exact = manifest.images[`/image/${source}|${blockId}`];
    const img = exact || imgBySource[source];
    if (img) return "/" + img.file;
    if (/^https?:\/\//.test(source)) return source; // public URL: fetched at build (see assets.mjs)
    return null;
  };

  store = { manifest, site, tables, blocks, viewRows, paths, root, image, pageIds: Object.keys(paths) };
  return store;
}

export function title(id) { return plain(load().blocks[id]?.properties?.title); }

// Breadcrumb trail (root first): pages, plus the database a row lives in, like Notion.
// Items are { id, kind: "page" | "collection" }.
export function breadcrumbs(id) {
  const { blocks, tables } = load();
  const chain = [];
  let cur = blocks[id], guard = 0;
  while (cur && guard++ < 30) {
    if (cur.type === "page" || cur.type === "collection_view_page") chain.unshift({ id: cur.id, kind: "page" });
    let pid = cur.parent_id;
    if (cur.parent_table === "collection") {
      const coll = tables.collection?.[cur.parent_id];
      if (coll) chain.unshift({ id: coll.id, kind: "collection" });
      pid = coll?.parent_id;
    } else if (cur.parent_table !== "block") break;
    if (!pid) break;
    cur = blocks[pid];
  }
  return chain;
}

// Link target for a Notion page id (internal), or null if it is not part of the site.
export function hrefFor(id) {
  if (!id) return null;
  const { paths, root } = load();
  const d = dash(hex(id));
  if (d === root) return "/";
  return paths[d] || null;
}

// Rewrite notion.so / notion.site / "/<id>" links to this site.
export function rewriteLink(url) {
  if (!url) return url;
  const m = url.match(/^(?:https?:\/\/(?:www\.)?(?:notion\.so|[\w-]+\.notion\.site)(?:\/[^/?#]*)*\/|\/)(?:[^/?#]*-)?([0-9a-f]{32})(?:[?#].*)?$/);
  if (m) { const h = hrefFor(m[1]); if (h) return h + (url.includes("#") ? "#" + url.split("#")[1].replace(/-/g, "") : ""); }
  return url;
}
