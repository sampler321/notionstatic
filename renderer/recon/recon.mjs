// Recon: extract Notion's styling from the reference site (the Notion-app copy).
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const BASE = process.argv[2] || "https://kapica-design.b-j-kapica.workers.dev";
const PAGES = ["/Kapica-Design-3edae4cf8cdb80d48fb2d56890b15bce", "/About-3eeae4cf8cdb802794e3ddba2b10e462", "/Spark-Assets-Website-design-for-a-fintech-startup-3edae4cf8cdb8118aac8cbc1d5b0be6d", "/Building-financial-literacy-designing-a-children-s-savings-app-for-ING-Poland-3edae4cf8cdb81caa139fb8ef1263569"];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const out = { vars: {}, blocks: {} };
for (const path of PAGES) {
  await p.goto(BASE + path, { waitUntil: "domcontentloaded" });
  await p.waitForSelector(".notion-page-content"); await p.waitForTimeout(6000);
  const r = await p.evaluate(() => {
    const vars = {};
    const cs = getComputedStyle(document.querySelector(".notion-app-inner"));
    for (const sh of document.styleSheets) { let rs; try { rs = sh.cssRules } catch { continue } for (const r of rs) if (r.style && /:root|notion-light-theme/.test(r.selectorText || "")) for (const n of r.style) if (n.startsWith("--c-") || n.startsWith("--cd-")) vars[n] = cs.getPropertyValue(n).trim(); }
    const pick = (e) => { const c = getComputedStyle(e); const rr = e.getBoundingClientRect(); return { tag: e.tagName, w: Math.round(rr.width), h: Math.round(rr.height), fs: c.fontSize, lh: c.lineHeight, fw: c.fontWeight, color: c.color, bg: c.backgroundColor, m: `${c.marginTop} ${c.marginRight} ${c.marginBottom} ${c.marginLeft}`, pad: `${c.paddingTop} ${c.paddingRight} ${c.paddingBottom} ${c.paddingLeft}`, br: c.borderRadius, border: c.border, style: (e.getAttribute("style") || "").slice(0, 300) }; };
    const blocks = {};
    for (const el of document.querySelectorAll(".notion-page-content [data-block-id], .notion-frame [data-block-id]")) {
      const t = (el.className.match(/notion-([a-z_]+)-block/) || [])[1];
      if (!t || blocks[t]) continue;
      // block element, its first child chain (3 levels) and its text leaf
      const chain = []; let e = el; for (let i = 0; i < 4 && e; i++) { chain.push(pick(e)); e = e.firstElementChild; }
      const leaf = el.querySelector("[data-content-editable-leaf], [contenteditable]");
      blocks[t] = { chain, leaf: leaf && pick(leaf), html: el.outerHTML.replace(/\sclass="[^"]*"/g, "").slice(0, 1500) };
    }
    const title = document.querySelector(".notion-page-block h1, h1"); 
    blocks.__title = title && { el: pick(title), parent: pick(title.parentElement) };
    const pc = document.querySelector(".notion-page-content"); blocks.__content = pick(pc);
    return { vars, blocks };
  });
  Object.assign(out.vars, r.vars);
  for (const [k, v] of Object.entries(r.blocks)) out.blocks[k] ||= { page: path, ...v };
}
writeFileSync("renderer/recon/notion-styles.json", JSON.stringify(out, null, 1));
console.log("vars", Object.keys(out.vars).length, "block types", Object.keys(out.blocks).join(", "));
await b.close();
