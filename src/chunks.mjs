// Download every webpack chunk (JS + CSS) the Notion app can lazy-load, so no
// feature of the copy ever asks for a file the crawl happened not to see.
import { readdir, readFile, writeFile, access, mkdir, rm, stat } from "node:fs/promises";
import { log } from "./log.mjs";
import { dirname } from "node:path";

// Keys are minified numbers, sometimes in exponent form (18e3 = 18000).
const K = String.raw`\d+(?:e\d+)?`;
const parseMap = (src) => Object.fromEntries(src.split(new RegExp(`,(?=${K}:)`)).map((x) => { const i = x.indexOf(":"); return [String(Number(x.slice(0, i))), JSON.parse(x.slice(i + 1))]; }));

export async function chunkFiles(dir) {
  // Newest app bundle first (after a Notion update the old one may still be on disk).
  const js = (await readdir(dir)).filter((f) => f.endsWith(".js"));
  const mtimes = Object.fromEntries(await Promise.all(js.map(async (f) => [f, (await stat(`${dir}/${f}`)).mtimeMs])));
  for (const f of js.sort((a, b) => mtimes[b] - mtimes[a])) {
    const s = await readFile(`${dir}/${f}`, "utf8");
    if (!s.includes(".miniCssF=")) continue;
    const files = [];
    // (({id:"name",...})[e]||e)+"-"+({id:"hash",...})[e]+".js"  (same shape for .css)
    const re = new RegExp(String.raw`\(\{(${K}:"[^"]*"(?:,${K}:"[^"]*")*)\}\)\[e\]\|\|e\)\+"-"\+\(\{(${K}:"[0-9a-f]+"(?:,${K}:"[0-9a-f]+")*)\}\)\[e\]\+"(\.js|\.css)"`, "g");
    for (let m; (m = re.exec(s)); ) {
      const names = parseMap(m[1]), hashes = parseMap(m[2]);
      for (const [id, h] of Object.entries(hashes)) files.push(`${names[id] || id}-${h}${m[3]}`);
    }
    if (files.length > 100) return files;
  }
  return [];
}

export async function fetchAllChunks(request, origin, dir, { concurrency = 4 } = {}) {
  const files = await chunkFiles(dir);
  const missing = [];
  for (const f of files) await access(`${dir}/${f}`).catch(() => missing.push(f));
  log.step(`chunks: ${files.length} known, ${missing.length} missing`);
  let done = 0, failed = 0, pause = 0;
  const worker = async () => {
    while (missing.length) {
      const f = missing.shift();
      for (let attempt = 0; attempt < 6; attempt++) {
        if (pause) await new Promise((r) => setTimeout(r, pause));
        const res = await request.get(`${origin}/_assets/${f}`, { timeout: 60000 }).catch(() => null);
        if (res?.ok()) { await mkdir(dirname(`${dir}/${f}`), { recursive: true }); await writeFile(`${dir}/${f}`, await res.body()); pause = 0; break; }
        if (res?.status() === 404) { failed++; break; }
        pause = Math.min(120000, 5000 * 2 ** attempt);
        log.warn(`${res?.status() ?? "error"} on ${f}, backing off ${pause / 1000}s`);
        if (attempt === 5) failed++;
      }
      if (++done % 200 === 0) log.step(`chunks ${done}`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  log.step(`chunks done, ${failed} failed`);
}

// Remove chunks from older Notion builds: keep only this build's chunk list plus
// whatever the crawl actually loaded.
export async function pruneAssets(dir, loaded) {
  const keep = new Set([...(await chunkFiles(dir)), ...loaded]);
  let n = 0;
  for (const f of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!f.isFile()) continue;
    const rel = `${f.parentPath}/${f.name}`.slice(dir.length + 1);
    if (!keep.has(rel)) { await rm(`${dir}/${rel}`); n++; }
  }
  if (n) log.step(`pruned ${n} stale assets`);
}
