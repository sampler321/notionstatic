// Decide whether a staged snapshot is complete enough to replace the live one.
// Returns { problems, stats }; any problem blocks the swap (unless forced).
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { chunkFiles } from "./chunks.mjs";
import { pageIdsOf } from "./project.mjs";

const exists = (f) => access(f).then(() => true, () => false);
const val = (rec) => rec?.value?.value || rec?.value;

export async function validate(dir, previousDir, { renderer = "astro" } = {}) {
  const problems = [];
  const read = async (f) => JSON.parse(await readFile(join(dir, f), "utf8"));
  let m, api;
  try { m = await read("_data/manifest.json"); api = await read("_data/api.json"); }
  catch (e) { return { problems: [`snapshot data missing or unreadable: ${e.message}`], stats: {} }; }

  m.visited = pageIdsOf(m);
  if (!m.visited.length) problems.push("no pages were crawled");
  if (m.failed?.length) problems.push(`${m.failed.length} page(s) could not be loaded: ${m.failed.join(", ")}`);

  // Every page: an HTML shell and its own content in the recorded data.
  const blocks = {};
  for (const r of api) for (const [id, rec] of Object.entries(r.res?.recordMap?.block || {})) blocks[id] = rec;
  for (const id of m.visited || []) {
    const hex = id.replace(/-/g, "");
    if (!Object.keys(m.pages).some((p) => p.endsWith(hex))) problems.push(`no HTML shell for page ${id}`);
    const v = val(blocks[id]);
    if (!v) problems.push(`no content recorded for page ${id}`);
    else if (v.type === "page" && v.content?.length && !v.content.some((c) => blocks[c])) problems.push(`blocks of page ${id} missing`);
  }
  for (const f of new Set(Object.values(m.pages))) if (!(await exists(join(dir, f)))) problems.push(`shell file missing: ${f}`);

  const imgCount = Object.keys(m.images).length;
  const missingImgs = (m.imagesExpected ?? imgCount) - imgCount - (m.externalFailed?.length || 0);
  if (missingImgs > 0) problems.push(`${missingImgs} Notion-hosted image(s) failed to download`);
  for (const { file } of Object.values(m.images)) if (!(await exists(join(dir, file)))) { problems.push(`image file missing: ${file}`); break; }

  const raw = JSON.stringify(api);
  if (/https:\/\/file\.notion\.so\/f\//.test(raw)) problems.push("expiring file.notion.so links left in data");
  if (!api.some((r) => r.ep === "search")) problems.push("no search sample recorded (search results would lack Notion's format)");

  // HTML embeds present in content must have their wrapped file.
  for (const rec of Object.values(blocks)) {
    const v = val(rec);
    if (v?.type !== "embed" || v.format?.embed_variant !== "html_artifact" || v.alive === false) continue;
    const id = v.properties?.source?.[0]?.[0]?.match(/attachment:([0-9a-f-]{36})/)?.[1];
    if (id && !(await exists(join(dir, "_artifacts", id)))) problems.push(`HTML embed ${id} was not captured`);
  }

  let chunks = [], missing = 0;
  if (renderer === "notion") {
    chunks = await chunkFiles(join(dir, "_assets"));
    if (chunks.length < 100) problems.push("could not read Notion's chunk map");
    for (const c of chunks) if (!(await exists(join(dir, "_assets", c)))) missing++;
    if (missing > 10) problems.push(`${missing} code chunks missing`);
  }
  // Every image block on a crawled page needs its file (the Astro renderer draws them all).
  const onSite = new Set();
  const walk = (ids) => { for (const bid of ids || []) { const v = val(blocks[bid]); if (!v || v.alive === false || onSite.has(bid)) continue; onSite.add(bid); if (v.type !== "page" || bid === undefined) walk(v.content); if (v.type === "transclusion_reference") walk(val(blocks[v.format?.transclusion_reference_pointer?.id])?.content); } };
  for (const pid of pageIdsOf(m)) walk(val(blocks[pid])?.content);
  const sources = new Set(Object.keys(m.images).map((k) => k.slice(7, k.lastIndexOf("|"))));
  const noFile = [...onSite].map((bid) => val(blocks[bid])).filter((v) => v?.type === "image" && v.properties?.source?.[0]?.[0]?.startsWith("attachment:") && !sources.has(v.properties.source[0][0]));
  if (noFile.length) problems.push(`${noFile.length} image block(s) without a downloaded file (${noFile.slice(0, 3).map((v) => v.id.slice(0, 8)).join(", ")})`);

  // Cloudflare Workers static assets: max 25 MiB per file, 20,000 files per version.
  const { readdir, stat } = await import("node:fs/promises");
  let files = 0;
  for (const f of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!f.isFile()) continue;
    files++;
    const full = join(f.parentPath, f.name);
    if ((await stat(full)).size > 25 * 1024 * 1024) problems.push(`file over Cloudflare's 25 MiB limit: ${full.slice(dir.length)}`);
  }
  if (files > 20000) problems.push(`${files} files, over Cloudflare's 20,000 per deploy`);

  if (previousDir) {
    try {
      const prev = JSON.parse(await readFile(join(previousDir, "_data/manifest.json"), "utf8"));
      if (prev.visited.length >= 4 && m.visited.length < prev.visited.length * 0.7)
        problems.push(`page count dropped from ${prev.visited.length} to ${m.visited.length} (use --force if that is intended)`);
    } catch {}
  }
  return { problems, stats: { pages: m.visited.length, images: imgCount, chunks: chunks.length, missingChunks: missing, records: api.length, files } };
}
