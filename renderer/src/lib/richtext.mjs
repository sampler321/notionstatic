// Notion rich text ([[text, [[decoration, arg], ...]], ...]) -> HTML matching Notion's markup.
import { rewriteLink, title, hrefFor } from "./data.mjs";
import katex from "katex";

export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// Notion color names -> palette codes ("teal" is drawn with the green palette).
export const CODE = { gray: "gra", brown: "bro", orange: "ora", yellow: "yel", green: "gre", teal: "gre", blue: "blu", purple: "pur", pink: "pin", red: "red", default: "gra" };
// Select/multi-select option pill, as Notion draws it.
export const pillStyle = (color) => { const c = CODE[color || "default"] || "gra"; return `color:var(--c-${c}TexPri);background:var(--ca-${c}BacTerTra)`; };

// Notion color name -> inline style ("blue" text, "blue_background" highlight).
export function colorStyle(name, { block = false } = {}) {
  if (!name || name === "default") return block ? "" : "color:var(--c-texPri)";
  const bg = name.endsWith("_background");
  const c = CODE[name.replace("_background", "")];
  if (!c) return "";
  if (bg) return block ? `background:var(--c-${c}BacSec)` : `background:var(--ca-${c}BacSecTra)`;
  return `color:var(--c-${c}TexSec);fill:var(--c-${c}TexSec)`;
}

// Notion wraps emoji in a span with the emoji font; its taller metrics set the line height.
const EMOJI = /(\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*|[\u{1F1E6}-\u{1F1FF}]{2})/gu;
const emojify = (html) => html.replace(EMOJI, '<span class="ns-emoji-inline">$1</span>');

export function richText(rt) {
  if (!Array.isArray(rt)) return "";
  let html = "";
  for (const seg of rt) {
    let text = seg?.[0] ?? "";
    const decos = seg?.[1] || [];
    const d = Object.fromEntries(decos.map((x) => [x[0], x[1] ?? true]));
    // Inline page mention: "‣" with ["p", pageId].
    if (d.p) {
      const href = hrefFor(d.p);
      const name = esc(title(d.p) || "Untitled");
      html += href ? `<a href="${href}" class="ns-mention">${name}</a>` : `<span class="ns-mention">${name}</span>`;
      continue;
    }
    if (d.e) { let m; try { m = katex.renderToString(d.e, { throwOnError: false, output: "html" }); } catch { m = esc(d.e); } html += `<span class="ns-equation">${m}</span>`; continue; }
    if (d.d) { const v = d.d; html += `<span class="ns-date">${esc(v.start_date || "")}${v.end_date ? " → " + esc(v.end_date) : ""}</span>`; continue; }
    let inner = emojify(esc(text)).replace(/\n/g, "<br>");
    const styles = [];
    if (d.b) styles.push("font-weight:600");
    if (d.i) styles.push("font-style:italic");
    if (d.h) styles.push(colorStyle(d.h));
    if (d.s) styles.push("text-decoration:line-through");
    if (d._) styles.push("text-decoration:underline");
    if (d.c) inner = `<code class="ns-code">${inner}</code>`;
    if (d.a) {
      const href = rewriteLink(d.a);
      const ext = /^https?:/.test(href) ? ' target="_blank" rel="noopener"' : "";
      const linkColor = d.h ? colorStyle(d.h) : "color:inherit";
      html += `<a href="${esc(href)}"${ext} class="ns-link" style="${[linkColor, d.b && "font-weight:600"].filter(Boolean).join(";")}"><span class="ns-link-u">${inner}</span></a>`;
    } else if (styles.length) {
      html += `<span style="${styles.join(";")}">${inner}</span>`;
    } else html += inner;
  }
  return html;
}
