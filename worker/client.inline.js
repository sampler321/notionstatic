// Runs first in every page of the copy (window.__NS holds the site settings).
(function () {
  var NS = window.__NS || {};

  // Theme: "light" / "dark" force that mode whatever the device prefers; "system" leaves Notion alone.
  if (NS.mode === "light" || NS.mode === "dark") {
    var dark = NS.mode === "dark";
    try { localStorage.setItem("theme", JSON.stringify({ mode: NS.mode })); } catch (e) {}
    var mm = window.matchMedia;
    window.matchMedia = function (q) {
      if (!/prefers-color-scheme/.test(q)) return mm.call(window, q);
      return { matches: /dark/.test(q) ? dark : !dark, media: q, onchange: null, addListener: function () {}, removeListener: function () {},
        addEventListener: function () {}, removeEventListener: function () {}, dispatchEvent: function () { return false; } };
    };
    var tries = 0, t = setInterval(function () {
      try { if (window.__console && __console.environment && __console.environment.ThemeStore) { __console.environment.ThemeStore.setState({ mode: NS.mode }); clearInterval(t); } } catch (e) {}
      if (++tries > 200) clearInterval(t);
    }, 50);
  }

  // This copy only talks to itself: drop telemetry and analytics calls to Notion and third parties.
  var local = function (u) { try { return new URL(u, location.href).origin === location.origin; } catch (e) { return true; } };
  var of = window.fetch;
  window.fetch = function (input) {
    var u = typeof input === "string" ? input : input && input.url;
    if (u && !local(u)) return Promise.resolve(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    return of.apply(this, arguments);
  };
  if (navigator.sendBeacon) navigator.sendBeacon = function () { return true; };
  var oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__nsBlocked = u && !local(u); return oo.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () { if (!this.__nsBlocked) return os.apply(this, arguments); };
  var fd = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "src");
  Object.defineProperty(HTMLIFrameElement.prototype, "src", { get: fd.get, set: function (v) { if (String(v).indexOf("aif.notion.so") < 0) fd.set.call(this, v); }, configurable: true });

  var px = function (el, prop) { return parseFloat(el.style.getPropertyValue(prop)) || 0; };
  var textLeft = function (el) {
    var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: function (n) { return n.data.trim() ? 1 : 3; } });
    var n = w.nextNode(); if (!n) return null;
    var rg = document.createRange(); rg.selectNodeContents(n); return rg.getBoundingClientRect().left;
  };
  var searchPending = false;

  function tick() {
    document.querySelectorAll("iframe").forEach(function (f) { if (f.src.indexOf("aif.notion.so") >= 0) f.remove(); });
    // Mobile: the menu button opens search straight away (its other items are Duplicate/More).
    if (searchPending) {
      var item = [].find.call(document.querySelectorAll("[role=menuitem]"), function (e) { return e.textContent.trim() === "Search"; });
      if (item) { searchPending = false; item.click(); setTimeout(function () { document.body.classList.remove("ns-searching"); }, 300); }
    }
    var tb = document.querySelector(".notion-topbar") || document.querySelector("header.notion-topbar-mobile");
    if (!tb) return;
    // "Get Notion free" has no stable hook but its label.
    tb.querySelectorAll("[role=button]").forEach(function (b) { if (/^Get Notion/.test(b.textContent.trim())) b.classList.add("ns-get-notion"); });
    if (NS.headerWidth !== "content") return;
    var pc = document.querySelector(".notion-frame .notion-page-content");
    var bar = tb.firstElementChild;
    if (!pc || !bar) return;
    var r = pc.getBoundingClientRect(), cs = getComputedStyle(pc);
    if (!r.width) return;
    // Title text starts where the page text starts; the last icon ends where the content ends.
    var want = r.left + parseFloat(cs.paddingLeft) + 8, wantRight = r.right - parseFloat(cs.paddingRight) - 4;
    var x = bar.firstElementChild && textLeft(bar.firstElementChild);
    if (x != null && Math.abs(want - x) > 0.5) bar.style.setProperty("--ns-left", Math.max(0, px(bar, "--ns-left") + want - x) + "px");
    var icons = [].filter.call(tb.querySelectorAll("[role=button] svg"), function (s) { return s.getBoundingClientRect().width > 0; });
    var last = icons[icons.length - 1];
    if (last) { var d = last.getBoundingClientRect().right - wantRight; if (Math.abs(d) > 0.5) bar.style.setProperty("--ns-right", Math.max(0, px(bar, "--ns-right") + d) + "px"); }
  }
  if (NS.mobileSearch) document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest('header.notion-topbar-mobile [aria-label="More actions"]')) { searchPending = true; document.body.classList.add("ns-searching"); }
  }, true);
  var queued = false;
  var schedule = function () { if (!queued) { queued = true; requestAnimationFrame(function () { queued = false; tick(); }); } };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  addEventListener("resize", schedule);
})();
