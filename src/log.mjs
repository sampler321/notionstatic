// Minimal console output with consistent prefixes.
const c = (n, s) => (process.stdout.isTTY ? `\x1b[${n}m${s}\x1b[0m` : s);
export const log = {
  step: (s) => console.log(c(2, "  · ") + s),
  head: (s) => console.log("\n" + c(1, s)),
  ok: (s) => console.log(c(32, "  ✓ ") + s),
  warn: (s) => console.log(c(33, "  ! ") + s),
  fail: (s) => console.log(c(31, "  ✗ ") + s),
};
