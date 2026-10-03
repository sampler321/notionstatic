# Architecture

## Deploy pipeline

`notionstatic deploy` (`bin/notionstatic.mjs`) runs these steps. Any failure before "go live" leaves production untouched.

1. **Snapshot** (`src/snapshot.mjs`): crawl the published site with headed local Chrome into `.notionstatic/staging`.
2. **Validate** (`src/validate.mjs`): checks the staged snapshot (see below). Problems block the swap unless `--force`.
3. **Swap**: `site/` becomes `.notionstatic/previous`, staging becomes `site/`. The previous copy is kept for `rollback`.
4. **Theme build** (`src/build.mjs`): config theme becomes `site/_data/site.json` (CSS, self-hosted fonts in `site/_custom/fonts`).
5. **Astro build** (`src/astro.mjs`, astro renderer only): static HTML into `.notionstatic/dist`.
6. **Local smoke test** (`src/smoke.mjs`): `wrangler dev` plus headless Chrome. On failure the previous snapshot is restored (when a fresh snapshot was taken) and nothing is deployed.
7. **`wrangler versions upload`**: uploads a new Worker version that is not live yet, and returns a version preview URL.
8. **Warm-up and smoke test on the preview URL**: fresh hostname, so nothing is cached. Failure leaves production untouched.
9. **`wrangler versions deploy <id>@100%`**: send production traffic to the version.
10. **Live smoke test**, up to 3 attempts with 60 s waits (Cloudflare needs a while to roll out). The test first waits until `/_ns/build.json` (astro) or `/_data/site.json` (notion) reports the new build stamp.
11. If all 3 fail: automatic **`wrangler rollback`** to the previous Cloudflare version. On success, `.notionstatic/last-deploy.json` is written.

With `--skip-snapshot`, steps 1-3 are replaced by a validation of the existing `site/`.

### What validate checks

- Pages crawled, none failed; each page has an HTML shell and its content in the recorded data.
- Every image file exists and every Notion-hosted image downloaded; every image block on a crawled page has its file.
- No expiring `file.notion.so/f/` links left in the data; a search sample was recorded.
- Every captured HTML embed has its `_artifacts` file.
- Notion renderer only: the chunk map is readable and fewer than 10 chunks are missing.
- Cloudflare limits: 25 MiB per file, 20,000 files per version.
- Page count did not drop below 70% of the previous snapshot (when the previous had 4+ pages).

## Project folder layout

```
my-site/
  notionstatic.config.mjs     config
  custom.css, head.html, ...  optional files the config points to
  site/                       the deployed snapshot
    _data/manifest.json       pages, images, layout hints, skipped pages
    _data/api.json            recorded /api/v3 request/response pairs
    _data/site.json           built theme (written by build)
    _img/  _files/  _artifacts/   downloaded images, localized files, HTML embeds
    _assets/                  Notion's webpack chunks (notion renderer only)
    _custom/fonts/            self-hosted theme fonts
  .notionstatic/
    staging/                  snapshot under construction
    previous/                 last good snapshot (for rollback)
    profile/                  Chrome profile (keeps Cloudflare clearance)
    dist/                     Astro output (what is deployed in astro mode)
    reports/                  smoke test screenshots, compare/visual output
    wrangler.toml             generated, do not edit
    sticky-api.json           last responses of app endpoints Notion only calls on some loads
    lock                      pid of the running notionstatic process
    last-deploy.json          url, version, time of the last live deploy
```

Only one run per project at a time (the `lock` file); runs share the Chrome profile and swap `site/`.

## Snapshot (`src/snapshot.mjs`)

Headed Chrome (`src/browser.mjs`), window moved to x=-3000 (a minimized window stops painting). The crawler visits every page reachable from the root, with `crawl.delayMs` between pages (up to `crawl.maxPages`), and records:

- HTML shells and `/api/v3` request/response pairs
- every image referenced in the data, via Notion's image proxy (including images in closed tabs/toggles); Notion stock covers (`/images/page-cover/...`) from the site origin
- HTML embeds in their wrapped form from artifact.notionusercontent.com (`_artifacts`)
- expiring signed `file.notion.so` URLs, downloaded and rewritten to `/_files/` (`src/files.mjs`)
- database property order, which is only in Notion's rendered page (`manifest.layout`)
- non-public linked pages ("This page couldn't be found") are skipped at once (`manifest.skipped`); links to them render as text
- for the notion renderer, every webpack chunk named in the app bundle (`src/chunks.mjs`)

Rate limiting (429) is handled with retries and growing waits.

## Astro renderer (`renderer/`)

Built by a child `astro build` process started with cwd = `renderer/` (so Astro resolves the tool's `node_modules`), writing to `renderer/.build/<hash>` and then copied to `.notionstatic/dist`. Env: `NS_PROJECT`, `NS_OUT`. `src/astro.mjs` then copies `_img`, `_custom`, `_artifacts`, patches HTML embeds (strips Notion's frame bridge script, injects the theme font), and downloads external images that pages still reference into `/_img/ext-*`.

How blocks map to HTML:

- `src/lib/data.mjs` loads the snapshot, upgrading every record to its newest version across all recorded responses; computes page paths, breadcrumbs, link hrefs, image URLs. Id helpers tolerate missing ids (non-public parents/schemas).
- `src/lib/richtext.mjs` renders Notion rich text (bold/italic/links/mentions/equations) with Notion's color variables.
- `src/components/Blocks.astro` renders each block type (text, headings 1-4, lists, to_do, toggle, tabs, quote, callout, divider, columns, image, video/audio/file/pdf, bookmark, embed, code with Prism, equation with KaTeX, table, button, synced blocks, link-to-page, tweet, maps/figma embeds, drive and external object cards) with Notion's measured box model (see NOTION-LAYOUT-RULES.md). Tabs and toggles work without JavaScript (radio inputs, `<details>`).
- `Collection.astro` and `Gallery.astro` render database views (gallery, table, list, board; calendar and timeline fall back to lists). `Icon.astro` renders emoji and Font Awesome style icons.
- `src/layouts/Page.astro`: topbar, breadcrumbs, cover, icon, title, properties, outline, search dialog markup. Theme CSS and custom CSS are injected at the start of `<body>` so they win over Astro's bundled CSS; font-face and preloads go in `<head>`.
- `src/pages/[...slug].astro` generates every page; alternate URLs (bare `/<id>`, the root page's slug) are redirect pages. `404.astro` is the not-found page.
- `src/styles/`: `notion-vars.css` (Notion's light-theme variables, extracted by `recon/extract-vars.mjs`), `notion-prism.css` (code colors, `recon/extract-prism.mjs`), `notion.css` (layout).
- `public/_ns/site.js` is shipped as a static file (not bundled: Vite rewrote its dynamic import).
- `recon/` holds the extraction and measuring scripts used to learn Notion's styles.

Cloudflare config for astro mode (`src/wrangler.mjs`): static assets from `.notionstatic/dist`, `html_handling = "auto-trailing-slash"`, `not_found_handling = "404-page"`, no Worker code.

## Search (astro renderer)

Both indexes are built at build time:

- `/ns-pages.json` (`src/pages/ns-pages.json.js`): per page id, url, title, icon, cover, breadcrumb trail, last edited time, root flag, depth. Sorted root first, then by depth.
- `/ns-search.json` (`src/pages/ns-search.json.js`): per page, the text of each block in reading order (captions, table rows, and database row property values). Subpages index themselves.

`site.js` loads both on first open and matches client-side: phrase matching for queries being typed ("get in t" finds "get in touch"), word-start matching, whole-word highlight, one-letter fragments never match alone, recency in ranking, and an "Edited ..." line. Results show the matching block as the snippet, with a preview pane. Hidden by `theme.hide: ["search"]`.

## Notion renderer (`worker/`)

`worker/index.js` is a Cloudflare Worker serving `site/` as assets (`run_worker_first` for `/api/*`, `/image/*`, `/_data/*`, `/internal/*`):

- API calls are answered from the recording: exact match, else nearest by ids; page data (`loadCachedPageChunkV2`) records are upgraded to their newest version.
- Search (`worker/search.js`) answers in the shape of a recorded real search response.
- `worker/customize.js` injects theme CSS, head and body; `worker/client.inline.js` overrides `matchMedia(prefers-color-scheme)`, sets the localStorage theme and ThemeStore so dark mode does not return on later loads, and patches the HTML-embed frame bridge. `header.css`, `mobile-search.css` are injected styles.
- `sticky-api.json` supplies endpoints only sometimes called (e.g. getFeatureBillingData).
- Worker 404s are `no-store` so Cloudflare never caches a 404 for a file that appears in the next version.

## Tests (`src/smoke.mjs`)

Astro: every page returns 200, has the right title and h1, blocks present, visible images rendered (hidden ones checked over HTTP), theme background/font applied, no page errors or 4xx on own assets, search works on desktop and mobile. Notion: every page renders with the right title, no errors, no broken images or hidden embeds, theme applied, search works.

## Fidelity tools

`notionstatic compare` (`src/compare.mjs`) serves `.notionstatic/dist` locally and matches blocks by `data-block-id` between a reference and the build, reporting dx/dy/dw/dh in px. `--visual` (`src/visual.mjs`) writes side-by-side PNGs (reference, ours, diff) with the percentage of differing pixels per screen.
