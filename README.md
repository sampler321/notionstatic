# notionstatic

Freeze a published Notion site (e.g. `https://xyz.notion.site/Home-<32hexid>`) and serve it from Cloudflare, with your own theme.

Two renderers (config key `renderer`):

- **`astro`** (default): every page is rebuilt from the snapshot as plain static HTML with Astro and deployed as Cloudflare static assets. No client-side rendering. A small script (`renderer/public/_ns/site.js`) handles only the search dialog, the database toolbar (filter/sort/search), card/image/embed "..." menus, the image lightbox, the properties toggle and the outline highlight. Layout is measured against Notion's own rendering; on the reference site 1240 of 1240 blocks land within 2px at desktop width. Narrow screens stack column layouts once a column would be narrower than 220px.
- **`notion`**: replays Notion's own web app against recorded `/api/v3` responses through a Cloudflare Worker (`worker/`). Pixel-identical, but ships Notion's code chunks and renders client-side.

## Requirements

- macOS (the crawler uses the installed Chrome at `/Applications/Google Chrome.app`)
- Google Chrome (notion.site blocks headless Chrome, so crawling runs a headed window parked off-screen)
- Node.js 20 or newer
- A Cloudflare account, logged in with `npx wrangler login`

## Install

    npm install
    npm link          # puts `notionstatic` on your PATH

## Quick start

    mkdir my-site && cd my-site
    notionstatic init https://you.notion.site/Home-<id>   # writes notionstatic.config.mjs
    # edit notionstatic.config.mjs (worker name, theme, ...)
    notionstatic deploy                                   # crawl, build, test, upload, go live

After every edit in Notion, run `notionstatic deploy` again. After a theme-only change, `notionstatic deploy --skip-snapshot` is much faster.

## Commands

| command | what it does |
|---|---|
| `init <notion-url>` | create `notionstatic.config.mjs` in the current folder |
| `deploy [--skip-snapshot] [--force]` | full pipeline, with tests and automatic rollback |
| `snapshot` | crawl Notion; only replaces the current snapshot if it validates |
| `build` | apply theme and build the site from the current snapshot |
| `dev [--port 8787]` | build and preview locally |
| `test [url]` | smoke test the local preview, or a given URL |
| `rollback` | restore the previous snapshot and deploy it |
| `status` | project, snapshot and last deploy info |
| `compare <ref-url> [--mobile] [--visual] [--limit n]` | measure the build against a reference rendering |

The project is the current folder, `--project <dir>`, `$NOTIONSTATIC_PROJECT`, or the last one used (remembered in `~/.notionstatic.json`).

## Minimal config

```js
export default {
  source: "https://you.notion.site/Home-<32-char id>",
  worker: "my-site",                       // Cloudflare Worker name
  theme: { mode: "light", background: "#FAF7F2", font: { family: "Ubuntu", google: "Ubuntu:wght@400;500;700" } },
};
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): pipeline, project layout, how both renderers work, how search works
- [docs/CONFIG.md](docs/CONFIG.md): every config key
- [docs/COMMANDS.md](docs/COMMANDS.md): commands, flags, typical workflows
- [docs/NOTION-LAYOUT-RULES.md](docs/NOTION-LAYOUT-RULES.md): the measured Notion layout facts the renderer implements
- [docs/BUGS-FIXED.md](docs/BUGS-FIXED.md): problems met during development and how they were solved
- [docs/TODO.md](docs/TODO.md): open items

## Repository layout

    bin/notionstatic.mjs   CLI entry
    src/                   project, snapshot, validate, build (theme), astro, smoke tests, wrangler, compare, visual, chunks, files, browser
    renderer/              Astro project (src/lib, src/components, src/layouts, src/pages, src/styles, public/_ns, recon/)
    worker/                Cloudflare Worker for the `notion` renderer
    docs/                  documentation
