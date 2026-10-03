// Builds the <head> injection for every HTML shell from site.json (see src/build.mjs).
import CLIENT from "./client.inline.js";
import HEADER_CSS from "./header.css";
import MOBILE_SEARCH_CSS from "./mobile-search.css";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// </style> or </script> inside user CSS/settings must not end the tag early.
const safe = (s) => String(s || "").replace(/<\/(style|script)/gi, "<\\/$1");

export function customize(html, d, path) {
  const s = d.site || {};
  const structural = (s.headerWidth === "content" ? HEADER_CSS : "") + (s.mobileSearch ? MOBILE_SEARCH_CSS : "");
  const settings = { mode: s.mode || "light", headerWidth: s.headerWidth || "content", mobileSearch: !!s.mobileSearch };
  const title = d.titleFor(path);
  let head = "";
  // "/" shows the home page: give the app the home page's own path before it boots.
  if (path === "/") head += `<script>history.replaceState(null, "", ${JSON.stringify(d.manifest.rootPath)} + location.search + location.hash);</script>`;
  if (s.mode === "light" || s.mode === "dark") head += `<meta name="color-scheme" content="${s.mode}">`;
  if (title) head += `<title>${esc(title)}</title><meta property="og:title" content="${esc(title)}">`;
  head += `<script>window.__NS=${safe(JSON.stringify(settings))};</script>`;
  head += `<script>${safe(CLIENT)}</script>`;
  head += `<style id="ns-styles">${safe(s.fontFace)}\n${safe(structural)}\n${safe(s.css)}</style>`;
  head += s.head || "";
  let out = html.replace(/<head([^>]*)>/i, (m) => m + head);
  // Notion's own default <title>/og tags come after ours; drop them so ours win.
  if (title) out = out.replace(/<title>Notion<\/title>/, "").replace(/<meta property="og:title"[^>]*Notion \|[^>]*>/, "");
  if (s.body) out = out.replace(/<\/body>/i, s.body + "</body>");
  return out;
}

export function customizeEmbed(html, d) {
  const css = d.site?.embedCss;
  return css ? html.replace(/<head[^>]*>/i, (m) => `${m}<style>${safe(css)}</style>`) : html;
}
