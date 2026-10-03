# Bugs fixed

Problems met while building notionstatic, with cause and fix.

- [x] **1. notion.site blocks headless Chrome and curl**
  - Symptom: crawls returned a Cloudflare challenge page.
  - Cause: Cloudflare bot check on notion.site.
  - Fix: crawl with headed local Chrome, a persistent profile, and the window parked off-screen (a minimized window stops painting).
  - Files: `src/browser.mjs`, `src/snapshot.mjs`.

- [x] **2. 429 rate limiting after bursts**
  - Symptom: pages and chunks failed with HTTP 429.
  - Cause: too many requests in a short time.
  - Fix: delay between pages (`crawl.delayMs`), retries with growing waits, backoff on chunk downloads.
  - Files: `src/snapshot.mjs`, `src/chunks.mjs`.

- [x] **3. Lazy-loaded webpack chunks missing (notion renderer)**
  - Symptom: features broke because code chunks were never loaded during the crawl.
  - Cause: Notion loads chunks on demand; only visited features were recorded.
  - Fix: parse the chunk map from the app bundle and download every chunk. Keys can be exponent numbers like `18e3`; some chunk names contain folders (`@simplewebauthn/...`). `_assets` is kept between runs and stale chunks are pruned.
  - Files: `src/chunks.mjs`.

- [x] **4. Signed file.notion.so URLs expire after hours**
  - Symptom: images and files disappeared hours after a snapshot.
  - Cause: signed URLs have a short lifetime.
  - Fix: download the files and rewrite the links to local `/_files/`; validation rejects leftover links.
  - Files: `src/files.mjs`, `src/snapshot.mjs`, `src/validate.mjs`.

- [x] **5. HTML embeds stayed blank**
  - Symptom: embedded HTML artifacts rendered empty.
  - Cause: the wrapped HTML lives on artifact.notionusercontent.com and talks to its parent through a frame bridge.
  - Fix: save the wrapped HTML; in the notion renderer patch the bridge (parent posts with targetOrigin set to the artifact host, `event.source` check); the astro renderer serves `/_artifacts/` and strips the bridge script.
  - Files: `src/snapshot.mjs`, `worker/client.inline.js`, `src/astro.mjs`.

- [x] **6. Stale page data from `loadCachedPageChunkV2`**
  - Symptom: properties like "small text" were lost.
  - Cause: older record versions in some responses overrode newer ones.
  - Fix: upgrade every record to its newest version across all responses.
  - Files: `worker/index.js`, `renderer/src/lib/data.mjs`.

- [x] **7. Dark mode returned on later page loads (notion renderer)**
  - Symptom: a light-themed site flipped to dark on later loads.
  - Cause: Notion reads `prefers-color-scheme` and its stored theme.
  - Fix: override `matchMedia(prefers-color-scheme)`, set the localStorage theme and ThemeStore.
  - Files: `worker/client.inline.js`.

- [x] **8. Search initially returned nothing (notion renderer)**
  - Symptom: empty results.
  - Cause: no recorded search response matched the query.
  - Fix: answer with a response shaped like a recorded real search.
  - Files: `worker/search.js`, `worker/index.js`.

- [x] **9. Some app endpoints only called on some loads**
  - Symptom: features such as getFeatureBillingData failed intermittently.
  - Cause: the endpoint was not in every recording.
  - Fix: `sticky-api.json` carries the last response of those endpoints between snapshots.
  - Files: `src/snapshot.mjs`, `src/project.mjs`.

- [x] **10. Chrome profile collision**
  - Symptom: a second concurrent run (or a manually deleted lock) broke the persistent Chrome profile.
  - Cause: two processes using one profile and one `site/`.
  - Fix: per-project run lock with a pid check.
  - Files: `bin/notionstatic.mjs` (`lock`).

- [x] **11. Cloudflare cached a 404 for a brand-new file during rollout**
  - Symptom: new files 404ed for a while after deploy.
  - Cause: edge cached the 404 before the version was fully live.
  - Fix: deploy via `wrangler versions upload`, test the version's preview URL, then `versions deploy`; worker 404s are `no-store`.
  - Files: `bin/notionstatic.mjs`, `src/wrangler.mjs`, `worker/index.js`.

- [x] **12. Fresh versions load slowly (cold edge cache), false test failures**
  - Symptom: smoke tests failed right after upload.
  - Cause: nothing cached yet at the edge.
  - Fix: warm-up load and readiness-based waits (build stamp, selectors) in the tests.
  - Files: `bin/notionstatic.mjs` (`warmUp`, `liveTest`), `src/smoke.mjs`.

- [x] **13. Smoke test missed a missing image file**
  - Symptom: a broken image shipped because no page requested it in the test.
  - Cause: tests only checked what pages loaded.
  - Fix: the validator checks every file; `deploy --skip-snapshot` still validates.
  - Files: `src/validate.mjs`, `bin/notionstatic.mjs`.

- [x] **14. Astro prerender could not resolve packages from the project folder**
  - Symptom: `astro build` failed to find packages.
  - Cause: Astro resolves caches and prerender chunks from the working directory.
  - Fix: build as a child process with cwd = `renderer/`, output inside the tool (`renderer/.build/<hash>`), then copy to the project.
  - Files: `src/astro.mjs`.

- [x] **15. Theme CSS overridden by Astro's bundled CSS**
  - Symptom: theme and custom CSS had no effect.
  - Cause: bundled stylesheet came later in the cascade.
  - Fix: inject theme and custom CSS at the start of `<body>`.
  - Files: `renderer/src/layouts/Page.astro`.

- [x] **16. Vite rewrote the client script's dynamic import (`__VITE_PRELOAD__`)**
  - Symptom: `site.js` broke at runtime.
  - Cause: Vite's bundling transformed the dynamic import.
  - Fix: ship the script as a static file in `renderer/public/_ns/`.
  - Files: `renderer/public/_ns/site.js`.

- [x] **17. Pagefind listed pages two or three times**
  - Symptom: duplicate search results.
  - Cause: alternate URLs (bare id, root slug) were indexed as pages.
  - Fix: those URLs are redirect pages; later Pagefind was replaced entirely by the build-time JSON indexes.
  - Files: `renderer/src/pages/[...slug].astro`, `renderer/src/pages/ns-pages.json.js`.

- [x] **18. Search snippets ran blocks together ("Desk ResearchScopeWhat...")**
  - Symptom: unreadable snippets, poor matching while typing.
  - Cause: pages were indexed as flattened text.
  - Fix: block-level index `/ns-search.json`; word-start matching; whole-word highlight; phrase matching for queries being typed ("get in t" finds "get in touch"); one-letter fragments never match alone; recency in ranking; "Edited Just now".
  - Files: `renderer/src/pages/ns-search.json.js`, `renderer/src/pages/ns-pages.json.js`, `renderer/public/_ns/site.js`.

- [x] **19. Font flash (system font first)**
  - Symptom: text rendered in the system font before the theme font.
  - Cause: font discovered late, `font-display: swap`.
  - Fix: preload Latin woff2 files in `<head>`, `font-display: fallback`, `@font-face` in `<head>`.
  - Files: `src/build.mjs`, `renderer/src/layouts/Page.astro`.

- [x] **20. Smooth scrolling for table-of-contents and outline links**
  - Symptom: abrupt jumps; headings hidden under the top bar.
  - Cause: no scroll behavior set.
  - Fix: `scroll-behavior: smooth` plus `scroll-margin-top`. Test scripts must scroll with `behavior: "instant"`.
  - Files: `renderer/src/styles/notion.css`, `src/smoke.mjs`.

- [x] **21. Outline overflowed on long pages and overlapped content in narrow windows**
  - Symptom: right-edge dashes ran off screen or over text.
  - Cause: unbounded height, always visible.
  - Fix: max-height with auto-scroll to the active dash; hidden under 1080px.
  - Files: `renderer/src/styles/notion.css`, `renderer/public/_ns/site.js`.

- [x] **22. Search preview icon hidden behind the cover band**
  - Symptom: page icon invisible in the preview pane.
  - Cause: stacking order.
  - Fix: z-index fix; covers are rendered in the page and in the preview.
  - Files: `renderer/src/styles/notion.css`, `renderer/public/_ns/site.js`.

- [x] **23. Images inside closed tabs/toggles never downloaded**
  - Symptom: broken images after opening a toggle.
  - Cause: the crawler only saw images the browser loaded.
  - Fix: download every image referenced in the data via Notion's image proxy.
  - Files: `src/snapshot.mjs`.

- [x] **24. Database property order is not in the data**
  - Symptom: properties shown in the wrong order.
  - Cause: order lives in the view, not the recorded records.
  - Fix: capture it from Notion's rendered page during the crawl (`manifest.layout`).
  - Files: `src/snapshot.mjs`, `renderer/src/components/Collection.astro`, `renderer/src/lib/data.mjs`.

- [x] **25. Non-public linked pages made the crawler retry for about 20 minutes**
  - Symptom: very slow crawls.
  - Cause: "page not found" treated as a block to retry.
  - Fix: detect "This page couldn't be found" and skip at once (`manifest.skipped`); links to them render as text.
  - Files: `src/snapshot.mjs`.

- [x] **26. Notion stock covers 404 through the image proxy**
  - Symptom: failed downloads and blocked snapshots.
  - Cause: `/images/page-cover/...` is served by the site origin, not the proxy.
  - Fix: fetch those from the site origin; dead external images are warnings, not blockers.
  - Files: `src/snapshot.mjs`, `src/validate.mjs`, `src/astro.mjs`.

- [x] **27. Astro 7 Rust compiler cannot parse nested template strings in frontmatter**
  - Symptom: build error pointing at a wrong line.
  - Cause: compiler limitation.
  - Fix: avoid nested template strings; to find the culprit, bisect by removing whole statements.
  - Files: `renderer/src/components/*.astro`, `renderer/src/layouts/Page.astro`.

- [x] **28. Renderer crashed on databases whose parent or schema was not public**
  - Symptom: build failed.
  - Cause: missing ids and no title column assumed to exist.
  - Fix: id helpers tolerate missing ids; no title column is assumed.
  - Files: `renderer/src/lib/data.mjs`, `renderer/src/components/Collection.astro`.

- [x] **29. Layout mismatches against Notion**
  - Symptom: spacing and sizes off from Notion's rendering.
  - Cause: rules guessed instead of measured.
  - Fix: measured Notion block by block (see NOTION-LAYOUT-RULES.md) and verified with `notionstatic compare`: 1240/1240 blocks within 2px on the reference site.
  - Files: `renderer/src/styles/notion.css`, `renderer/src/components/Blocks.astro`, `src/compare.mjs`, `renderer/recon/*`.

- [x] **30. Missing interactive parity**
  - Symptom: static pages lacked Notion's interactions and block types.
  - Cause: not yet implemented.
  - Fix: database toolbar (Filter/Sort/Search/Minimize with client-side sorting and filtering), card "..." menu, image click-to-fullscreen and image "..." menu (Download / Full screen / View original), embed hover tools, "N more properties" toggle, linked-database arrow icon, link-to-page arrow badge; block types to_do, code (Prism with Notion's colors), equation (KaTeX), bookmark, video/audio/file/pdf, tweet, maps/figma embeds, drive and external object cards, button, header_4; table, list and board database views.
  - Files: `renderer/public/_ns/site.js`, `renderer/src/components/Blocks.astro`, `Collection.astro`, `Gallery.astro`, `renderer/src/styles/notion-prism.css`.

- [x] **31. Tip: inserting blocks at the top of a source page via the Notion API**
  - Not a tool bug: the API supports it with `Notion-Version: 2025-09-03` and `position: { type: "start" }`.
