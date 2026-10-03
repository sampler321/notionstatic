// Turn the project's theme config into site/_data/site.json, which the worker injects
// into every page. Google Fonts are downloaded and self-hosted under site/_custom/fonts.
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import { createHash } from "node:crypto";
import { log } from "./log.mjs";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const sha = (s) => createHash("sha1").update(s).digest("hex").slice(0, 12);

// Notion's own top bar controls, by stable hooks (aria labels / icon names, never generated classes).
const HIDE = {
  share: ['.notion-topbar [role="button"][aria-label="Share site to socials"]', 'header.notion-topbar-mobile [role="button"][aria-label="Share site to socials"]'],
  duplicate: ['.notion-topbar [role="button"]:has(> svg.duplicate)'],
  more: ['.notion-topbar [role="button"][aria-label="More actions"]'],
  getNotion: ['.notion-topbar [role="button"].ns-get-notion', 'header.notion-topbar-mobile [role="button"]:has(> svg.notion)'],
  sidebarToggle: ['.notion-topbar [role="button"][aria-label="Close panel"]'],
};

async function googleFont(spec, site) {
  const res = await fetch(`https://fonts.googleapis.com/css2?family=${spec}&display=swap`, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`Google Fonts returned ${res.status} for "${spec}" (check the family/weights spelling)`);
  let css = await res.text();
  const dir = join(site, "_custom/fonts");
  await mkdir(dir, { recursive: true });
  for (const url of new Set(css.match(/https:\/\/fonts\.gstatic\.com\/[^)]+/g) || [])) {
    const name = `${sha(url)}${extname(new URL(url).pathname) || ".woff2"}`;
    const font = await fetch(url, { headers: { "user-agent": UA } });
    if (!font.ok) throw new Error(`font file ${font.status}: ${url}`);
    await writeFile(join(dir, name), Buffer.from(await font.arrayBuffer()));
    css = css.split(url).join(`/_custom/fonts/${name}`);
  }
  // Text waits up to ~100ms for the self-hosted font instead of flashing the system font.
  return css.replace(/font-display:\s*swap/g, "font-display: fallback");
}

// Latin-subset files of the weights a page uses: preloaded so the font arrives with the page.
function preloadsFrom(css) {
  const out = [];
  for (const m of css.matchAll(/\/\*\s*latin\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)) {
    const body = m[1];
    const weight = +(body.match(/font-weight:\s*(\d+)/)?.[1] || 400);
    const italic = /font-style:\s*italic/.test(body);
    const url = body.match(/url\(([^)]+)\)/)?.[1];
    if (url && (!italic ? [400, 500, 600, 700].includes(weight) : weight === 400)) out.push(url);
  }
  return out;
}

async function localFonts(font, project, site) {
  const dir = join(site, "_custom/fonts");
  await mkdir(dir, { recursive: true });
  let css = "";
  for (const f of font.files) {
    const spec = typeof f === "string" ? { src: f } : f; // { src, weight, style }
    const name = basename(spec.src);
    await writeFile(join(dir, name), await readFile(join(project, spec.src)));
    const format = { ".woff2": "woff2", ".woff": "woff", ".ttf": "truetype", ".otf": "opentype" }[extname(name)] || "woff2";
    css += `@font-face{font-family:${JSON.stringify(font.family)};src:url(/_custom/fonts/${name}) format("${format}");font-weight:${spec.weight || "100 900"};font-style:${spec.style || "normal"};font-display:swap}\n`;
  }
  return css;
}

// Copies the configured favicon(s) to site/_custom and returns their site paths.
async function saveFavicons(p) {
  const conf = p.config.favicon;
  if (!conf) return null;
  const pair = typeof conf === "string" ? { icon: conf, apple: conf } : conf;
  const out = {};
  await mkdir(join(p.site, "_custom"), { recursive: true });
  for (const [key, src] of Object.entries(pair)) {
    if (!src) continue;
    const ext = (src.split("?")[0].match(/\.(png|ico|svg|jpe?g|webp)$/i)?.[1] || "png").toLowerCase();
    const name = `favicon-${key}.${ext}`;
    let data;
    if (/^https?:/.test(src)) {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`favicon: ${src} returned ${res.status}`);
      data = Buffer.from(await res.arrayBuffer());
    } else data = await readFile(join(p.dir, src));
    await writeFile(join(p.site, "_custom", name), data);
    out[key] = { href: `/_custom/${name}`, type: { svg: "image/svg+xml", ico: "image/x-icon", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" }[ext] || "image/png" };
  }
  return out;
}

export async function build(p) {
  const { theme } = p.config;
  await rm(join(p.site, "_custom"), { recursive: true, force: true });
  const css = [];
  const favicon = await saveFavicons(p);

  for (const key of theme.hide || []) {
    if (!HIDE[key]) throw new Error(`theme.hide: unknown "${key}" (known: ${Object.keys(HIDE).join(", ")})`);
    css.push(`${HIDE[key].join(",\n")} { display: none !important; }`);
  }

  if (theme.background) {
    css.push(`:root, .notion-light-theme { --c-bacPri: ${theme.background} !important; }
body, .notion-body, #skeleton, .notion-app-inner.notion-light-theme { background: ${theme.background} !important; }`);
  }
  if (theme.surface) {
    css.push(`:root, .notion-light-theme { --c-bacEle: ${theme.surface} !important; --c-popBac: ${theme.surface} !important; --cd-colGalPreCarBac: ${theme.surface} !important; --cd-boaIteDefBac: ${theme.surface} !important; --c-calIteBac: ${theme.surface} !important; }`);
  }

  // Any Notion color variable, e.g. { "--c-graBacPri": "#F3EFE8" } (inspect :root in devtools for names).
  const vars = Object.entries(theme.vars || {});
  for (const [k] of vars) if (!/^--[\w-]+$/.test(k)) throw new Error(`theme.vars: "${k}" is not a CSS variable name`);
  if (vars.length) css.push(`:root, .notion-light-theme { ${vars.map(([k, v]) => `${k}: ${v} !important;`).join(" ")} }`);

  let fontFace = "", fontEmbedCss = "";
  if (theme.font) {
    const f = theme.font;
    if (!f.family) throw new Error("theme.font.family is required");
    fontFace = f.google ? await googleFont(f.google, p.site) : f.files ? await localFonts(f, p.dir, p.site) : "";
    const stack = `${JSON.stringify(f.family)}, ui-sans-serif, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"`;
    // Notion sets its font inline (style="font-family: ui-sans-serif, ..."); emoji and code keep theirs.
    css.push(`.notion-app-inner, .notion-app-inner [style*="ui-sans-serif"], .notion-overlay-container [style*="ui-sans-serif"], .notion-overlay-container input { font-family: ${stack} !important; }`);
    if (theme.applyToEmbeds) fontEmbedCss = `${fontFace}\nhtml, body, input, textarea, button, select { font-family: ${stack} !important; }`;
    log.step(`font: ${f.family} (${f.google ? "Google Fonts, self-hosted" : "local files"})`);
  }

  if (theme.imageRadius != null) {
    const r = `${Number(theme.imageRadius)}px`;
    css.push(`.notion-image-block img, .notion-image-block .notion-cursor-default { border-radius: ${r} !important; }
.notion-collection-item > div { border-radius: ${r} !important; }
.notion-page-cover-wrapper img, .notion-page-block img.notion-page-cover { border-radius: ${r} !important; }`);
  }

  const read = async (f) => (f ? readFile(join(p.dir, f), "utf8") : "");

  // The Astro renderer uses the same theme as plain CSS variables on its own markup.
  const astroCss = [];
  const rootVars = { ...(theme.vars || {}) };
  if (theme.background) rootVars["--c-bacPri"] = theme.background;
  if (theme.surface) Object.assign(rootVars, { "--c-bacEle": theme.surface, "--c-popBac": theme.surface, "--cd-colGalPreCarBac": theme.surface });
  if (theme.font) rootVars["--ns-font"] = `${JSON.stringify(theme.font.family)}, ui-sans-serif, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"`;
  if (theme.imageRadius != null) rootVars["--ns-img-radius"] = `${Number(theme.imageRadius)}px`;
  if (Object.keys(rootVars).length) astroCss.push(`:root { ${Object.entries(rootVars).map(([k, v]) => `${k}: ${v};`).join(" ")} }`);
  if (theme.imageRadius != null) astroCss.push(`.ns-card { border-radius: var(--ns-img-radius); } .ns-image-frame img { border-radius: 0; }`);
  for (const key of theme.hide || []) if (key === "search") astroCss.push(".ns-search-btn { display: none; }");
  const site = {
    mode: theme.mode,
    headerWidth: theme.headerWidth,
    mobileSearch: (theme.hide || []).includes("more"),
    fontFace,
    css: css.join("\n\n") + "\n\n" + (await read(p.config.css)),
    head: await read(p.config.head),
    body: await read(p.config.body),
    embedCss: fontEmbedCss,
    astro: { favicon, homeLink: theme.homeLink || null, hideHomeTitle: !!theme.hideHomeTitle, hideTitleOn: theme.hideTitleOn || [], fontFace, fontPreload: fontFace ? preloadsFrom(fontFace) : [], css: astroCss.join("\n") + "\n" + (await read(p.config.css)), head: await read(p.config.head), body: await read(p.config.body), embedCss: fontEmbedCss },
    built: new Date().toISOString(),
  };
  await mkdir(join(p.site, "_data"), { recursive: true });
  await writeFile(join(p.site, "_data/site.json"), JSON.stringify(site));
  log.ok(`theme built (${[theme.background && "background", theme.surface && "surface", theme.font && "font", theme.imageRadius != null && "image radius", vars.length && `${vars.length} color vars`, p.config.css && "custom css", p.config.head && "custom head"].filter(Boolean).join(", ") || "defaults"})`);
  return site;
}
