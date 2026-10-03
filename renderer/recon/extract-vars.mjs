// Extract Notion's default light-theme CSS variables from a snapshot's stylesheets.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
const dir = process.argv[2], out = process.argv[3];
const vars = {};
for (const f of readdirSync(dir).filter((f) => f.endsWith(".css"))) {
  const s = readFileSync(`${dir}/${f}`, "utf8");
  for (const m of s.matchAll(/(?:^|})\s*:root\s*,\s*\.notion-light-theme\s*\{([^}]*)\}/g))
    for (const d of m[1].split(";")) { const i = d.indexOf(":"); if (i > 0 && d.trim().startsWith("--")) vars[d.slice(0, i).trim()] ??= d.slice(i + 1).trim(); }
}
writeFileSync(out, "/* Notion light theme variables, extracted from Notion's stylesheets (renderer/recon/extract-vars.mjs). */\n:root {\n" + Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join("\n") + "\n}\n");
console.log(Object.keys(vars).length, "vars;", ["--c-bacPri", "--c-texPri", "--c-bluBacSec", "--ca-bluBacSecTra", "--c-graTexSec", "--ca-borPriTra", "--c-shaBasSm"].map((k) => `${k}=${vars[k]}`).join(" "));
