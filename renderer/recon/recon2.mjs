import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const BASE = "https://kapica-design.b-j-kapica.workers.dev";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const clean = (h) => h.replace(/\sclass="[^"]*"/g, "").replace(/ (data-[a-z-]+|contenteditable|spellcheck|placeholder|tabindex|aria-[a-z]+|dir|id)="[^"]*"/g, "").replace(/<svg.*?<\/svg>/gs, "<svg/>").replace(/font-family:[^;"]*;?/g, "").replace(/<path[^>]*>/g, "");
const out = {};
const grab = async (path, sels) => {
  await p.goto(BASE + path, { waitUntil: "domcontentloaded" }); await p.waitForSelector(".notion-page-content"); await p.waitForTimeout(6000);
  for (const [name, sel] of Object.entries(sels)) out[name] = clean(await p.evaluate((s) => document.querySelector(s)?.outerHTML || "MISSING " + s, sel)).slice(0, 6000);
};
await grab("/Spark-Assets-Website-design-for-a-fintech-startup-3edae4cf8cdb8118aac8cbc1d5b0be6d", { tab: ".notion-tab-block", pageHeader: ".notion-frame .notion-scroller > div:nth-child(2)", floatingToc: ".notion-floating-table-of-contents, [class*=floating]" });
await grab("/About-3eeae4cf8cdb802794e3ddba2b10e462", { table: ".notion-table-block", topbar: ".notion-topbar" });
await grab("/Portfolio-3eeae4cf8cdb806bb337ccefecb42db2", { gallery: ".notion-collection_view-block", galleryCard: ".notion-collection-item" });
await grab("/Kapica-Design-3edae4cf8cdb80d48fb2d56890b15bce", { toc: ".notion-table_of_contents-block", home: ".notion-page-content > div:nth-child(1)" });
writeFileSync("renderer/recon/structures.json", JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out)) console.log(k, v.length);
await b.close();
