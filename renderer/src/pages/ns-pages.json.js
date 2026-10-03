// Page list for the search dialog: title, icon, trail, last edit, parent. Built at build time.
import { load, title, breadcrumbs, hrefFor, plain } from "../lib/data.mjs";

export function GET() {
  const { blocks, tables, paths, root, image } = load();
  const icon = (id) => {
    const i = blocks[id]?.format?.page_icon;
    if (!i) return null;
    if (/^(https?:|attachment:|\/)/.test(i)) return { img: image(i, id) || i };
    return { emoji: i };
  };
  const pages = Object.keys(paths).map((id) => {
    const trail = breadcrumbs(id).slice(0, -1).map((c) => (c.kind === "collection" ? plain(tables.collection?.[c.id]?.name) : title(c.id)) || "Untitled");
    const f = blocks[id]?.format || {};
    const cover = f.page_cover ? { src: image(f.page_cover, id), pos: `center ${Math.round((1 - (f.page_cover_position ?? 0.5)) * 100)}%` } : null;
    return { id, url: hrefFor(id), title: title(id) || "Untitled", icon: icon(id), cover, trail, edited: blocks[id]?.last_edited_time || null, root: id === root, depth: trail.length };
  });
  // Root first, then its direct subpages, then the rest (e.g. database rows).
  pages.sort((a, b) => a.depth - b.depth);
  return new Response(JSON.stringify(pages), { headers: { "content-type": "application/json" } });
}
