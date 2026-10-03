# Configuration

`notionstatic.config.mjs` in the project folder exports a default object. It is merged over the defaults in `src/project.mjs` (nested objects are merged key by key, arrays and scalars replaced). `source` and `worker` are required and validated at load.

## Keys

| key | default | meaning |
|---|---|---|
| `source` | required | Published Notion page URL ending in its 32-char id |
| `worker` | required | Cloudflare Worker name: lowercase letters, digits, dashes (max 63). Site is `<worker>.<account>.workers.dev` |
| `domain` | none | Custom domain, string or array, on a zone in your Cloudflare account. Written as `custom_domain` routes |
| `renderer` | `"astro"` | `"astro"` (static HTML) or `"notion"` (replay Notion's app via Worker) |
| `crawl.delayMs` | `4000` | Pause between page visits during snapshot (avoids 429) |
| `crawl.maxPages` | `500` | Upper bound on pages crawled |
| `css` | `null` | Path (relative to the project) of extra CSS, injected after the theme |
| `head` | `null` | Path of an HTML file injected at the end of `<head>` (analytics, meta) |
| `body` | `null` | Path of an HTML file injected at the end of `<body>` |

### `theme`

Handled by `src/build.mjs`, which writes `site/_data/site.json`. Both renderers get the same theme; astro uses plain CSS variables on its own markup.

| key | default | meaning |
|---|---|---|
| `mode` | `"light"` | `"light"`, `"dark"` or `"system"` |
| `background` | `null` | Page background; sets `--c-bacPri` |
| `surface` | `null` | Cards, menus, popups; sets `--c-bacEle`, `--c-popBac`, `--cd-colGalPreCarBac` (and board item background for the notion renderer) |
| `font` | `null` | `{ family, google }` or `{ family, files }`. `google` is a Google Fonts css2 `family=` spec (e.g. `"Ubuntu:wght@400;500;700"`); the files are downloaded and self-hosted under `/_custom/fonts`, `font-display: fallback`, and the Latin woff2 files of weights 400-700 (italic 400) are preloaded in `<head>`. `files` is a list of paths in the project, each a string or `{ src, weight, style }` (.woff2/.woff/.ttf/.otf) |
| `imageRadius` | `null` | px; rounds image blocks, gallery cards and page covers (astro: `--ns-img-radius`) |
| `vars` | `{}` | Any Notion CSS variable, e.g. `{ "--c-graBacPri": "#F3EFE8" }`; names are validated (`--[\w-]+`). Inspect `:root` in devtools for names |
| `headerWidth` | `"content"` | `"content"` or `"full"`: top bar as wide as the content column or the viewport |
| `hide` | `["share","duplicate","more","getNotion"]` | Top bar controls to hide. Known: `share`, `duplicate`, `more`, `getNotion`, `sidebarToggle` (notion renderer hooks), plus `search` (hides the astro search button). Unknown names fail the build. `more` also enables the mobile search button in the notion renderer |
| `applyToEmbeds` | `true` | Apply the font inside HTML embeds too |
| `hideHomeTitle` | `false` | Hide the home page title on the site (kept in the DOM for SEO and screen readers). Useful when the top bar already shows the site name |

Order of CSS in the output: hide rules, background, surface, vars, font, image radius, then your `css` file last.

## Example

```js
// notionstatic.config.mjs
export default {
  source: "https://you.notion.site/Home-<32-char id>",
  worker: "my-site",
  renderer: "astro",
  // domain: "example.com",
  crawl: { delayMs: 4000, maxPages: 500 },
  theme: {
    mode: "light",
    background: "#F2F2F2",
    surface: "#FAFAFA",
    font: { family: "IBM Plex Sans", google: "IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400" },
    // font: { family: "Brand", files: ["fonts/brand.woff2", { src: "fonts/brand-bold.woff2", weight: 700 }] },
    imageRadius: 12,
    vars: { "--c-graBacPri": "#E0E0E0", "--c-texSec": "#666666" },
    headerWidth: "content",
    hideHomeTitle: true,
    hide: ["share", "duplicate", "more", "getNotion"],
    applyToEmbeds: true,
  },
  css: "custom.css",
  // head: "head.html",
  // body: "body.html",
};
```

`custom.css` can target the astro renderer's classes, for example `.ns-link-u { opacity: 1; }` (links at full strength), `.ns-callout-box` (callouts, a callout whose only content is a link can be restyled as a button), `.ns-card` (gallery cards), and highlight spans such as `span[style*="--ca-bluBacSecTra"]`.
