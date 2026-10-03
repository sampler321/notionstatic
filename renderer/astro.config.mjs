// Astro renderer for a notionstatic snapshot. Run through `notionstatic build` (sets NS_PROJECT).
import { defineConfig } from "astro/config";

// Built inside the tool (Astro prerenders by importing from outDir, so it must resolve the
// tool's node_modules); src/astro.mjs then moves the result into the project.
export default defineConfig({
  root: new URL(".", import.meta.url).pathname,
  outDir: process.env.NS_OUT || new URL("./.build/default", import.meta.url).pathname,
  build: { format: "file", inlineStylesheets: "always" }, // /About-<id> -> About-<id>.html
  trailingSlash: "never",
  compressHTML: true,
  devToolbar: { enabled: false },
  vite: { server: { fs: { strict: false } } },
});
