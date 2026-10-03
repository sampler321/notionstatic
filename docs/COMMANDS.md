# Commands

Run from the project folder, or pass `--project <dir>` (also `$NOTIONSTATIC_PROJECT`, or the last project used). Every command except `status` takes the project lock, so only one runs at a time.

## `init <notion-url>`
Writes `notionstatic.config.mjs` in the current folder, with the worker name derived from the URL slug. Fails if the file exists.

## `deploy [--skip-snapshot] [--force]`
Full pipeline (see ARCHITECTURE.md). Requires `npx wrangler login`.
- `--skip-snapshot`: reuse the current `site/`. It is still validated, so a missing image file is caught.
- `--force`: continue despite validation, local-test or preview-test failures (a failed live test still rolls back).

## `snapshot [--force]`
Crawl Notion into staging, validate, and swap into `site/` only if complete. The old copy goes to `.notionstatic/previous`.

## `build`
Apply the theme (`site/_data/site.json`) and, for the astro renderer, build the static site into `.notionstatic/dist`.

## `dev [--port 8787]`
Build, then run `wrangler dev` at `http://localhost:8787` until Ctrl+C.

## `test [url]`
Smoke test. Without a URL, builds a local preview of the current snapshot and tests it; with a URL, tests that running copy. Exit code 1 on failures.

## `rollback`
Swap `site/` with `.notionstatic/previous` (the newer one is kept as previous) and redeploy with `--skip-snapshot`.

## `status`
Prints JSON: source, worker, snapshot creation time and page count, last deploy, theme.

## `compare <reference-url> [--mobile] [--visual] [--limit n]`
Measures the astro build (served locally from `.notionstatic/dist`) against a reference rendering, for each crawled page. The reference is typically a Notion-app deployment (renderer `notion`) or the live notion.site. For each page it prints matched/total blocks, how many are off by more than 2px, and page heights; `--limit` (default 3) sets how many offending blocks per page are listed (dx, dy, dw, dh). `--mobile` uses a 390x844 touch viewport. `--visual` also writes side-by-side PNGs (reference, ours, diff) with per-screen diff percentages to `.notionstatic/reports/visual`.

## Global flags
`--project <dir>`, `--help`.

## Workflows

- **Content change in Notion**: `notionstatic deploy`.
- **Theme or CSS change only**: edit the config or css, `notionstatic deploy --skip-snapshot` (about a minute). Preview first with `notionstatic dev`.
- **Fidelity check**: `notionstatic compare <reference-url>`, add `--visual` for images.
- **Something went wrong after going live**: the pipeline rolls back by itself when the live test fails; otherwise `notionstatic rollback`.
- **Chrome profile errors**: make sure no other notionstatic run is active; do not delete `.notionstatic/lock` by hand while one is.

## Tip: editing source pages through the Notion API
Not part of this tool, but useful when scripting the source content: the Notion API can insert blocks at the top of a page with header `Notion-Version: 2025-09-03` and `position: { type: "start" }` in the append-children request.
