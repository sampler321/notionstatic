// Signed file.notion.so URLs (HTML embeds, file blocks) expire after hours.
// Download each one and point the recorded responses at a local copy.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { log } from "./log.mjs";

export async function localizeSignedFiles(api, request, out) {
  const json = JSON.stringify(api);
  const urls = [...new Set(json.match(/https:\/\/file\.notion\.so\/f\/[^"\\]+/g) || [])];
  const map = {};
  for (const u of urls) {
    const { pathname } = new URL(u); // /f/f/<space>/<attachment>/<name>
    const local = "/_files/" + pathname.split("/").slice(-2).join("/");
    const res = await request.get(u, { timeout: 60000 }).catch(() => null);
    if (!res?.ok()) { log.warn(`signed file ${res?.status()}: ${pathname}`); continue; }
    await mkdir(dirname(out + local), { recursive: true });
    await writeFile(out + local, await res.body());
    map[u] = local;
  }
  log.step(`signed files: ${Object.keys(map).length}/${urls.length}`);
  let s = json;
  for (const [u, l] of Object.entries(map)) s = s.split(u).join(l);
  return JSON.parse(s);
}
