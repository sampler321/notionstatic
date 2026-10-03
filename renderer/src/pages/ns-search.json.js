// Block-level search index (Notion searches blocks, not flattened pages): for every page, the text
// of each block in reading order, plus database row properties. Built at build time.
import { load, plain } from "../lib/data.mjs";

export function GET() {
  const { blocks, tables, paths, root } = load();
  const out = [];
  for (const id of Object.keys(paths)) {
    const page = blocks[id];
    const texts = [];
    const seen = new Set();
    const walk = (ids) => {
      for (const bid of ids || []) {
        const b = blocks[bid];
        if (!b || b.alive === false || seen.has(bid)) continue;
        seen.add(bid);
        if (b.type === "page" || b.type === "collection_view_page") continue; // subpages index themselves
        if (b.type === "table") { for (const r of b.content || []) { const row = blocks[r]; if (row) texts.push(Object.values(row.properties || {}).map(plain).filter(Boolean).join(" · ")); } continue; }
        const t = [plain(b.properties?.title), plain(b.properties?.caption)].filter(Boolean).join(" ");
        if (t.trim()) texts.push(t);
        if (b.type === "transclusion_reference") walk(blocks[b.format?.transclusion_reference_pointer?.id]?.content);
        walk(b.content);
      }
    };
    // Database row: its property values are searchable too (Notion's "collection text").
    if (page.parent_table === "collection") {
      const schema = tables.collection?.[page.parent_id]?.schema || {};
      for (const [k, v] of Object.entries(page.properties || {})) if (k !== "title" && schema[k]?.type !== "checkbox" && plain(v).trim()) texts.push(plain(v));
    }
    walk(page.content);
    out.push({ id, blocks: texts.filter(Boolean) });
  }
  return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
}
