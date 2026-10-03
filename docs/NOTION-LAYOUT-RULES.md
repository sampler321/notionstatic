# Notion layout rules

Facts measured from Notion's own rendering and implemented by the astro renderer (mainly `renderer/src/styles/notion.css`, `src/components/Blocks.astro`, `Gallery.astro`, `Collection.astro`, `src/layouts/Page.astro`). The measuring scripts are in `renderer/recon/`. `notionstatic compare` verifies them: 1240 of 1240 blocks within 2px on the reference site.

## Page and text

- Content column 720px wide, 96px gutters; 18px gutters on phones.
- Page title 40px (32px with small text, 28px on phones), 84px top padding. With an icon: 96px offset, the icon is 78px, the title sits 12px below it.
- Covers are 30vh tall; the icon overlaps the cover by 42px.
- Text block padding 6px; text leaf padding 2px.
- Small text: 14px base, line-height 1.5. Phones ignore "small text": 16px, line-height 1.375.
- Emoji are wrapped in an emoji-font span, which makes lines 2px taller.
- Headings top padding 30 / 26 / 22px (h1 / h2 / h3), but 6px when first in their container.
- List items and page links: 1px padding between consecutive items of the same type, 6px at the edges of a run.
- Callout, image, embed, quote, tab and table blocks: 8px padding.
- Divider: 13px tall.

## Colors

- "teal" maps to the green palette.
- Option pills: text `var(--c-XTexPri)` on background `var(--ca-XBacTerTra)`.
- Text highlights use `var(--ca-XBacSecTra)`; text colors use `var(--c-XTexSec)`.

(`X` is the color's three-letter key, e.g. `blu`, `gre`, `red`.)

## Columns

- Column width = min(1, ratio) / sum(ratios) of the width left after 46px gutters.

## Galleries

- Grid inset 8px left and 20px right, 16px gap, cards with 10px radius, 180px cover.

## Tables

- Tables span the viewport; table inset 14px; cells 12px / 20px, with 7px x 9px padding.

## Database pages

- Property rows 34px tall with 4px gaps; name column 160px; dividers with 16px above and below.

## Embeds

- Label row 28px plus a 6px gap.
- HTML embeds are inset 16px inside a 1px bordered frame.

## Search dialog

- Notion's search dialog is 1006 x 652px with a 376px preview pane.

## Narrow screens

On real phones Notion stacks columns, but in narrow desktop windows and tablets it keeps them side by side. notionstatic instead stacks a column layout when one of its columns would be narrower than 220px, using CSS container queries with a per-layout breakpoint computed at build time, and hides spacer-only columns when stacked.

The outline (right-edge dashes) is hidden under 1080px wide and has a max-height with auto-scroll to the active dash on long pages.
