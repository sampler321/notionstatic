// Serves a frozen Notion site snapshot: HTML shells, assets, images, and
// replayed /api/v3 responses (plus a local search over the recorded blocks).
import { search } from "./search.js";
import { customize, customizeEmbed } from "./customize.js";

let data; // { manifest, api, byEp, records, site, titleFor }

const VOLATILE = new Set(["browserId", "deviceId", "device", "searchSessionId", "searchSessionFlowNumber", "clientVersion", "requestId", "traceId", "src"]);
const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) if (!VOLATILE.has(k)) o[k] = canon(v[k]);
    return o;
  }
  return v;
};
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const uuids = (s) => new Set(s.match(UUID) || []);

// One shared load per isolate: concurrent cold-start requests wait for the same promise,
// and a failed load is retried by the next request.
let loading;
function load(env, origin) {
  if (data) return data;
  loading ||= loadData(env, origin).catch((e) => { loading = null; throw e; });
  return loading;
}

async function loadData(env, origin) {
  const get = async (p, fallback) => {
    const res = await env.ASSETS.fetch(new URL(p, origin));
    if (res.ok) return res.json();
    if (fallback !== undefined) return fallback;
    throw new Error(`${p}: ${res.status}`);
  };
  const [manifest, api, site] = await Promise.all([get("/_data/manifest.json"), get("/_data/api.json"), get("/_data/site.json", {})]);
  const rootHex = manifest.root.replace(/-/g, "");
  manifest.rootPath = Object.keys(manifest.pages).filter((p) => p.endsWith(rootHex)).sort((a, b) => b.length - a.length)[0];
  // Newest version of every record across all responses. Notion's "cached" page chunks can be
  // older than what the live app ends up showing, so every response is upgraded to the newest copy.
  const records = {}; // table -> id -> record
  const version = (rec) => (rec?.value?.value || rec?.value)?.version ?? -1;
  for (const r of api) {
    for (const [table, recs] of Object.entries(r.res?.recordMap || {})) {
      if (!recs || typeof recs !== "object") continue;
      records[table] ||= {};
      for (const [id, rec] of Object.entries(recs)) if (!records[table][id] || version(rec) >= version(records[table][id])) records[table][id] = rec;
    }
  }
  const byEp = new Map();
  for (const r of api) {
    for (const [table, recs] of Object.entries(r.res?.recordMap || {})) {
      if (!recs || typeof recs !== "object") continue;
      for (const id of Object.keys(recs)) if (records[table]?.[id]) recs[id] = records[table][id];
    }
    const key = JSON.stringify(canon(r.req));
    if (!byEp.has(r.ep)) byEp.set(r.ep, []);
    byEp.get(r.ep).push({ key, ids: uuids(key), res: r.res });
  }
  // Page titles for <title>, so tabs, bookmarks and link previews show the real name.
  const plain = (rt) => (Array.isArray(rt) ? rt.map((x) => (typeof x?.[0] === "string" ? x[0] : "")).join("") : "");
  const titleFor = (path) => {
    const hex = (path === "/" ? manifest.root : path).replace(/-/g, "").slice(-32);
    if (!/^[0-9a-f]{32}$/.test(hex)) return "";
    const id = hex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
    const b = records.block?.[id];
    return plain((b?.value?.value || b?.value)?.properties?.title);
  };
  return (data = { manifest, api, byEp, records, site, titleFor });
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });

function syncRecords(d, req) {
  const recordMap = { __version__: 3 };
  for (const { pointer } of req?.requests || []) {
    const rec = d.records[pointer?.table]?.[pointer?.id];
    if (!rec) continue;
    (recordMap[pointer.table] ||= {})[pointer.id] = rec;
  }
  return { recordMap };
}

function replay(d, ep, req) {
  const recs = d.byEp.get(ep);
  if (ep.startsWith("syncRecordValues") || ep === "getRecordValues") {
    // Exact replay first (keeps any extra fields), else assemble from the record store.
    const key = JSON.stringify(canon(req));
    const hit = recs?.find((r) => r.key === key);
    return hit ? hit.res : syncRecords(d, req);
  }
  if (!recs) return {};
  const key = JSON.stringify(canon(req));
  const exact = recs.find((r) => r.key === key);
  if (exact) return exact.res;
  // Nearest recorded request of the same endpoint by shared ids.
  const want = uuids(key);
  let best = null, score = -1;
  for (const r of recs) {
    let s = 0;
    for (const id of want) if (r.ids.has(id)) s++;
    s = s / (want.size + r.ids.size - s || 1);
    if (s > score) { score = s; best = r; }
  }
  return want.size && score === 0 ? {} : best.res;
}

// Never let a 404 be cached: during a rollout a new file can briefly look missing.
const NO_STORE = { "cache-control": "no-store" };

const CONTENT_EP = /^(loadCachedPageChunk|loadPageChunk|queryCollection|syncRecordValues|getRecordValues|search|getPublicPageData)/;

export default {
  async fetch(request, env) {
    try { return await handle(request, env); }
    catch (e) {
      console.error("notionstatic worker error", request.url, e?.stack || e);
      const path = new URL(request.url).pathname;
      // App/telemetry endpoints degrade to an empty answer; content errors are reported.
      if (path.startsWith("/api/v3/") && !CONTENT_EP.test(path.slice(8))) return json({});
      return new Response("Temporary error, please retry.", { status: 503, headers: { "retry-after": "1" } });
    }
  },
};

async function handle(request, env) {
  {
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname);
    const d = await load(env, url.origin);

    if (path.startsWith("/api/v3/")) {
      const ep = path.slice(8);
      const req = request.method === "POST" ? await request.json().catch(() => null) : null;
      if (ep === "search") return json(search(d, req));
      return json(replay(d, ep, req));
    }

    if (path.startsWith("/image/")) {
      const img = d.manifest.images[path + "|" + (url.searchParams.get("id") || "")];
      if (!img) return new Response("not found", { status: 404, headers: NO_STORE });
      const res = await env.ASSETS.fetch(new URL("/" + img.file, url.origin));
      return new Response(res.body, { headers: { "content-type": img.type, "cache-control": "public, max-age=31536000, immutable" } });
    }

    // HTML embeds ("html_artifact") render from /internal/file-preview/render/attachment:<id>:<name>;
    // the snapshot saved the wrapped versions under /_artifacts/<id>/<name>.
    const preview = path.match(/^\/internal\/file-preview\/render\/attachment:([0-9a-f-]{36}):(.+)$/);
    if (preview) {
      const res = await env.ASSETS.fetch(new URL(`/_artifacts/${preview[1]}/${preview[2]}`, url.origin));
      if (res.status !== 200) return new Response("not found", { status: 404, headers: NO_STORE });
      // The page hands the frame its message port with targetOrigin artifact.notionusercontent.com;
      // the frame now lives on this origin, so accept that target or the embed stays hidden.
      const fix = `<script>(function(){var p=window.postMessage;window.postMessage=function(m,o,t){if(o==="https://artifact.notionusercontent.com")o="*";return p.call(this,m,o,t)}})()</script>`;
      // Our wrapper runs in the frame, so the browser reports the frame itself as the sender.
      const html = customizeEmbed((await res.text()).replace(/<head[^>]*>/i, (m) => m + fix), d)
        .replace("event.source !== window.parent ||", "(event.source !== window.parent && event.source !== window) ||");
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (url.search) {
      // Exact query match, else the same path with any recorded query (e.g. icons ?mode=dark vs light).
      const q = d.manifest.query[url.pathname + url.search] ||
        Object.entries(d.manifest.query).find(([k]) => k.split("?")[0] === url.pathname)?.[1];
      if (q) {
        const res = await env.ASSETS.fetch(new URL("/" + q.file, url.origin));
        return new Response(res.body, { headers: { "content-type": q.type } });
      }
    }

    // Static files (assets layer serves existing files before the worker runs,
    // so anything reaching here without a known page is either a page or missing).
    const asset = await env.ASSETS.fetch(new URL(url.pathname, url.origin));
    if (asset.status === 200 && !asset.headers.get("content-type")?.includes("text/html")) return asset;

    const shell = d.manifest.pages[path] || d.manifest.pages[path === "/" ? d.manifest.rootPath : ""] ||
      d.manifest.pages[d.manifest.rootPath];
    if (path !== "/" && !d.manifest.pages[path] && !/[0-9a-f]{32}$/.test(path)) return new Response("Not found", { status: 404, headers: NO_STORE });
    const res = await env.ASSETS.fetch(new URL("/" + shell, url.origin));
    return new Response(customize(await res.text(), d, path), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
  }
}
