// Local replacement for Notion's server-side /api/v3/search, built from the
// recorded block store. Returns the same shape the Notion client expects.
const MARK = "gzkNfoUU"; // highlight tag the client parses (seen in real responses)
let index; // [{ id, title, blocks: [{ id, text }] }]

const val = (rec) => rec?.value?.value || rec?.value;
const plain = (rt) => (Array.isArray(rt) ? rt.map((s) => (typeof s?.[0] === "string" ? s[0] : "")).join("") : "");

function build(d) {
  const blocks = d.records.block || {};
  const pages = [];
  for (const [id, rec] of Object.entries(blocks)) {
    const v = val(rec);
    if (!v || v.alive === false || (v.type !== "page" && v.type !== "collection_view_page")) continue;
    const out = [];
    const walk = (bid, depth) => {
      const b = val(blocks[bid]);
      if (!b || depth > 12) return;
      if (bid !== id && (b.type === "page" || b.type === "collection_view_page")) return; // subpages index themselves
      const text = [plain(b.properties?.title), plain(b.properties?.caption)].filter(Boolean).join(" ");
      if (text && bid !== id) out.push({ id: bid, text });
      for (const c of b.content || []) walk(c, depth + 1);
    };
    walk(id, 0);
    // Database row properties count as page text too.
    const props = Object.entries(v.properties || {}).filter(([k]) => k !== "title").map(([, p]) => plain(p)).filter(Boolean).join(" ");
    if (props) out.unshift({ id, text: props });
    pages.push({ id, title: plain(v.properties?.title), blocks: out });
  }
  return pages;
}

const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function highlight(text, terms) {
  const n = norm(text);
  let first = -1;
  for (const t of terms) { const i = n.indexOf(t); if (i >= 0 && (first < 0 || i < first)) first = i; }
  const start = Math.max(0, first - 40);
  let snip = (start > 0 ? "…" : "") + text.slice(start, start + 160);
  const re = new RegExp(terms.map(esc).join("|"), "gi");
  // Mark on the normalized copy positions so accents still highlight.
  const ns = norm(snip);
  let out = "", last = 0, m;
  while ((m = re.exec(ns))) { out += snip.slice(last, m.index) + `<${MARK}>` + snip.slice(m.index, m.index + m[0].length) + `</${MARK}>`; last = m.index + m[0].length; if (!m[0].length) re.lastIndex++; }
  return out + snip.slice(last);
}

export function search(d, req) {
  index ||= build(d);
  const q = norm(String(req?.query || "").trim());
  const limit = req?.limit || 20;
  // Start from a real recorded response so every field the client reads exists.
  const sample = d.byEp.get("search")?.[0]?.res || {};
  const base = { ...sample, trackEventProperties: { ...(sample.trackEventProperties || {}), query: { ...(sample.trackEventProperties?.query || {}), query: req?.query } } };
  if (!q) return { ...base, results: [], total: 0, recordMap: { __version__: 3, block: {} } };
  const terms = q.split(/\s+/).filter(Boolean);
  const hits = [];
  const spaceId = Object.keys(d.records.space || {})[0] || Object.values(d.records.block || {})[0]?.spaceId;
  const matches = (text) => { const n = norm(text); return terms.every((x) => n.includes(x)); };
  for (const p of index) {
    const titleHit = matches(p.title);
    const props = p.blocks.find((b) => b.id === p.id && matches(b.text));
    const blocks = p.blocks.filter((b) => b.id !== p.id && matches(b.text));
    if (!titleHit && !props && !blocks.length) continue;
    const r = {
      id: p.id, highlight: {}, highlights: {}, score: (titleHit ? 10 : 0) + (norm(p.title).startsWith(terms[0]) ? 5 : 0) + blocks.length * 0.1 + (props ? 1 : 0),
      spaceId, sources: ["es"], analytics: { pageViews: {}, uniquePageViews: {} }, isSurrogateCollection: false, badges: [],
    };
    if (titleHit) r.highlight.title = r.highlights.titleHighlight = highlight(p.title, terms);
    if (props) r.highlight.collectionText = highlight(props.text, terms);
    if (blocks.length) {
      r.highlight.text = highlight(blocks[0].text, terms);
      r.highlightBlockId = blocks[0].id;
      r.highlights.textHighlights = blocks.slice(0, 7).map((b, i) => ({ highlightedText: highlight(b.text, terms), highlightBlockId: b.id, relevanceRankES: i }));
    }
    hits.push(r);
  }
  hits.sort((a, b) => b.score - a.score);
  const results = hits.slice(0, limit);
  // Records the client needs to render each result (page + its parents for the breadcrumb).
  const recordMap = { __version__: 3, block: {} };
  const blocks = d.records.block || {};
  for (const r of results) {
    let id = r.id, guard = 0;
    while (id && blocks[id] && guard++ < 10) {
      recordMap.block[id] = blocks[id];
      const v = val(blocks[id]);
      for (const h of r.highlights.textHighlights || []) if (blocks[h.highlightBlockId]) recordMap.block[h.highlightBlockId] = blocks[h.highlightBlockId];
      id = v?.parent_table === "block" ? v.parent_id : v?.parent_table === "collection" ? val(d.records.collection?.[v.parent_id])?.parent_id : null;
    }
  }
  if (d.records.collection) recordMap.collection = d.records.collection;
  return { ...base, results, total: hits.length, recordMap };
}
