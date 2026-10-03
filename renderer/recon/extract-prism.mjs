// Extract Notion's Prism (code highlighting) light-theme rules from a notion-renderer snapshot.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
const [dir, out] = process.argv.slice(2);
const rules = new Set();
for (const f of readdirSync(dir).filter((f) => f.endsWith(".css"))) {
  const s = readFileSync(`${dir}/${f}`, "utf8");
  for (const m of s.matchAll(/(?:^|})([^{}]*\.notion-light-theme[^{}]*(?:\.token|code\[class\*=|pre\[class\*=)[^{}]*)\{([^}]*)\}/g)) rules.add(`${m[1].trim()}{${m[2]}}`);
}
const css = [...rules].map((r) => r.replace(/\.notion-light-theme\s+/g, ".ns-code-block ")).join("\n");
writeFileSync(out, "/* Notion's Prism (code highlighting) colors, extracted from its light-theme stylesheet (renderer/recon/extract-prism.mjs). */\n" + css + "\n");
console.log(rules.size, "rules");
console.log(css.slice(0, 700));
