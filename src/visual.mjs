// Pixel comparison: reference vs Astro build, screen by screen down each page.
// Writes side-by-side PNGs (ref | ours | diff) and prints the % of differing pixels per screen.
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { serve } from "./compare.mjs";

export async function visual(projectDir, refBase, paths, { out, width = 1440, height = 900, screens = 4 } = {}) {
  await mkdir(out, { recursive: true });
  const s = await serve(join(projectDir, ".notionstatic/dist"));
  const b = await chromium.launch();
  const results = [];
  try {
    const ref = await b.newPage({ viewport: { width, height } });
    const ours = await b.newPage({ viewport: { width, height } });
    const tool = await b.newPage();
    for (const path of paths) {
      await ref.goto(refBase + path, { waitUntil: "domcontentloaded" }); await ref.waitForSelector(".notion-page-content"); await ref.waitForTimeout(6000);
      await ours.goto(s.url + path, { waitUntil: "domcontentloaded" }); await ours.waitForTimeout(1500);
      // Hide only what is intentionally different: nothing for now.
      const total = await ours.evaluate(() => document.scrollingElement.scrollHeight);
      for (let i = 0; i < screens; i++) {
        const y = i * (height - 100);
        if (y > total - 200) break;
        await ref.evaluate((y) => (document.querySelector(".notion-frame .notion-scroller") || document.scrollingElement).scrollTo({ top: y, behavior: "instant" }), y);
        await ours.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), y);
        await ref.waitForTimeout(1200); await ours.waitForTimeout(500);
        const [a, c] = [await ref.screenshot(), await ours.screenshot()];
        const r = await tool.evaluate(async ([a, c, w, h]) => {
          const img = async (s) => { const i = new Image(); i.src = "data:image/png;base64," + s; await i.decode(); return i; };
          const [x, y] = await Promise.all([img(a), img(c)]);
          const cv = new OffscreenCanvas(w * 3, h), g = cv.getContext("2d");
          g.drawImage(x, 0, 0, w, h); g.drawImage(y, w, 0, w, h);
          const da = g.getImageData(0, 0, w, h), db = g.getImageData(w, 0, w, h), dd = g.createImageData(w, h);
          let n = 0;
          for (let k = 0; k < da.data.length; k += 4) {
            const d = Math.abs(da.data[k] - db.data[k]) + Math.abs(da.data[k + 1] - db.data[k + 1]) + Math.abs(da.data[k + 2] - db.data[k + 2]);
            const hit = d > 48; if (hit) n++;
            dd.data[k] = hit ? 255 : da.data[k] * 0.3 + 178; dd.data[k + 1] = hit ? 0 : da.data[k + 1] * 0.3 + 178; dd.data[k + 2] = hit ? 0 : da.data[k + 2] * 0.3 + 178; dd.data[k + 3] = 255;
          }
          g.putImageData(dd, w * 2, 0);
          const blob = await cv.convertToBlob({ type: "image/png" });
          const buf = new Uint8Array(await blob.arrayBuffer());
          let bin = ""; for (let k = 0; k < buf.length; k += 0x8000) bin += String.fromCharCode(...buf.subarray(k, k + 0x8000));
          return { pct: (100 * n) / (w * h), png: btoa(bin) };
        }, [a.toString("base64"), c.toString("base64"), width, height]);
        const name = `${path.slice(1, 30).replace(/[^\w-]/g, "") || "root"}-${width}-${i}.png`;
        await writeFile(join(out, name), Buffer.from(r.png, "base64"));
        results.push({ path, screen: i, pct: +r.pct.toFixed(2), file: name });
        console.log(`${path.slice(0, 40).padEnd(40)} screen ${i}: ${r.pct.toFixed(2)}% differ  ${name}`);
      }
    }
  } finally { await b.close(); s.close(); }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [projectDir, refBase, out, ...paths] = process.argv.slice(2);
  await visual(projectDir, refBase, paths, { out });
}
