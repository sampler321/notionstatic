// Derive Notion's block spacing rules: padding top/bottom by (type, previous/next sibling type).
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const BASE = "https://kapica-design.b-j-kapica.workers.dev";
const PAGES = ["/Kapica-Design-3edae4cf8cdb80d48fb2d56890b15bce", "/About-3eeae4cf8cdb802794e3ddba2b10e462", "/Contact-3eeae4cf8cdb80faa701f38fc4f14cd8", "/Portfolio-3eeae4cf8cdb806bb337ccefecb42db2", "/Spark-Assets-Website-design-for-a-fintech-startup-3edae4cf8cdb8118aac8cbc1d5b0be6d", "/Building-financial-literacy-designing-a-children-s-savings-app-for-ING-Poland-3edae4cf8cdb81caa139fb8ef1263569", "/Tackling-fragmentation-reimagining-the-TV-streaming-experience-for-HBO-Max-Sports-3edae4cf8cdb8101b7adeb015140a8f2", "/archi-studio-Homepage-design-for-an-architecture-studio-3edae4cf8cdb81b48f57c6539a2ca4c3"];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const rows = [];
for (const path of PAGES) {
  await p.goto(BASE + path, { waitUntil: "domcontentloaded" }); await p.waitForSelector(".notion-page-content"); await p.waitForTimeout(5000);
  rows.push(...await p.evaluate(() => {
    const type = (e) => e ? (e.className.toString().match(/notion-([a-z_]+)-block/) || [])[1] || "?" : "none";
    const out = [];
    for (const el of document.querySelectorAll(".notion-page-content [data-block-id]")) {
      const t = type(el);
      if (!t || t === "?") continue;
      // the first descendant (<=3 levels) carrying block padding
      let e = el, pad = null;
      for (let i = 0; i < 4 && e; i++) { const c = getComputedStyle(e); if (parseFloat(c.paddingTop) || parseFloat(c.paddingBottom)) { pad = [c.paddingTop, c.paddingBottom, c.paddingLeft]; break; } e = e.firstElementChild; }
      const sib = (dir) => { let s = el[dir]; while (s && !s.hasAttribute?.("data-block-id")) s = s[dir]; return s; };
      const parent = el.parentElement.closest("[data-block-id]");
      out.push({ t, prev: type(sib("previousElementSibling")), next: type(sib("nextElementSibling")), parent: parent ? type(parent) : "page", pad: pad ? pad.join(" ") : "0" });
    }
    return out;
  }));
}
const agg = {};
for (const r of rows) { const k = `${r.t} | prev=${r.prev} next=${r.next} in=${r.parent}`; (agg[k] ||= {}); agg[k][r.pad] = (agg[k][r.pad] || 0) + 1; }
const lines = Object.entries(agg).sort().map(([k, v]) => `${k}  ->  ${Object.entries(v).map(([pp, n]) => `${pp} (${n})`).join(", ")}`);
writeFileSync("renderer/recon/spacing.txt", lines.join("\n"));
console.log(lines.filter((l) => !/^(column|column_list|collection_view|page) /.test(l)).join("\n"));
await b.close();
