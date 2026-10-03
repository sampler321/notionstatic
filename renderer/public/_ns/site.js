// The only client code: the search dialog (Notion's layout; block index loaded on first use)
// and the outline highlight. Pages themselves are static HTML.
(() => {
  const box = document.querySelector(".ns-search");
  if (box) {
    const input = box.querySelector("input");
    const list = box.querySelector(".ns-search-results");
    const label = box.querySelector("[data-ns-label]");
    const sort = box.querySelector("[data-ns-sort]");
    const preview = box.querySelector(".ns-search-preview");
    const current = box.dataset.current;
    const menu = box.querySelector(".ns-search-menu");
    const sortLabel = box.querySelector("[data-ns-sort-label]");
    let pages, items = [], sel = 0, timer, seq = 0;
    let sortBy = "relevance", titlesOnly = false;
    const SORT_NAMES = { relevance: "Best matches", newest: "Last edited", oldest: "Oldest edited" };

    const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const clean = (u) => u.replace(/\.html$/, "").replace(/\/index$/, "/") || "/";
    const DOC = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4.36 15.47h7.28c1.46 0 2.22-.77 2.22-2.24v-6.2c0-.95-.12-1.39-.72-1.99L9.55 1.39C8.98.8 8.51.67 7.65.67H4.36c-1.46 0-2.22.77-2.22 2.24v10.32c0 1.48.76 2.24 2.22 2.24Zm.11-1.34c-.66 0-.99-.35-.99-.99V2.99c0-.63.33-.98.99-.98h2.91v3.75c0 .97.49 1.45 1.46 1.45h3.68v5.94c0 .64-.33.99-1 .99H4.47Zm4.49-8.1c-.28 0-.4-.12-.4-.4V2.19l3.78 3.84H8.96Z" fill="currentColor"/></svg>';
    const iconHtml = (p) => p?.icon?.emoji ? `<span class="ns-si-emoji">${esc(p.icon.emoji)}</span>` : p?.icon?.img ? `<img src="${esc(p.icon.img)}" alt="">` : DOC;
    const ago = (t) => {
      if (!t) return "";
      const m = Math.round((Date.now() - t) / 60000);
      if (m < 1) return "Edited Just now";
      if (m < 60) return `Edited ${m}m ago`;
      const h = Math.round(m / 60); if (h < 24) return `Edited ${h}h ago`;
      const d = Math.round(h / 24); if (d < 30) return `Edited ${d}d ago`;
      return "Edited " + new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    };
    const trail = (t) => (t.length > 2 ? [t[0], "...", t[t.length - 1]] : t).map(esc).join('<span class="ns-si-sep">/</span>');
    const pageFor = (url) => pages?.find((p) => p.url === clean(url));
    // Block-level search like Notion: a term matches at the start of a word; a page matches when
    // every term occurs in its title or blocks; results show the matching blocks' own text.
    let index;
    const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const termRe = (terms) => new RegExp(`(^|[^\\p{L}\\p{N}])(${terms.map(reEsc).join("|")})`, "giu");
    const hasTerm = (text, t) => new RegExp(`(^|[^\\p{L}\\p{N}])${reEsc(t)}`, "iu").test(text);
    // Notion highlights the whole word a term starts ("test" -> <mark>testing</mark>).
    const wordRe = (terms) => new RegExp(`(^|[^\\p{L}\\p{N}])((?:${terms.map(reEsc).join("|")})[\\p{L}\\p{N}]*)`, "giu");
    const mark = (text, terms) => esc(text).replace(wordRe(terms.map(esc)), (m, pre, w) => `${pre}<mark>${w}</mark>`);
    // Start a long block a few words before its first match (Notion keeps the match in view).
    function around(text, terms, words = 6) {
      const m = termRe(terms).exec(text);
      if (!m || m.index < 50) return text;
      const head = text.slice(0, m.index).split(/\s+/);
      return "…" + head.slice(-words).join(" ") + text.slice(m.index);
    }
    // Query = a phrase being typed: words in order, the last one may be unfinished ("get in t" ->
    // "get in touch"). A block matching the phrase is shown with only the phrase highlighted;
    // otherwise every real word (2+ letters) must occur, and only those words are highlighted.
    const phraseRe = (terms) => new RegExp(`(^|[^\\p{L}\\p{N}])(${terms.map((t, i) => reEsc(t) + (i === terms.length - 1 ? "[\\p{L}\\p{N}]*" : "")).join("[^\\p{L}\\p{N}]+")})`, "iu");
    function markWith(text, terms, phrase) {
      const t = esc(text);
      if (phrase) return t.replace(new RegExp(phraseRe(terms.map(esc)).source, "giu"), (m, pre, w) => `${pre}<mark>${w}</mark>`);
      const real = terms.filter((x) => x.length > 1);
      return real.length ? t.replace(wordRe(real.map(esc)), (m, pre, w) => `${pre}<mark>${w}</mark>`) : t;
    }
    function aroundRe(text, re, words) {
      const m = re.exec(text);
      if (!m || m.index < 50) return text;
      return "…" + text.slice(0, m.index).split(/\s+/).slice(-words).join(" ") + text.slice(m.index);
    }
    function searchIndex(q) {
      const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (!terms.length) return [];
      const real = terms.filter((t) => t.length > 1);
      const pre = phraseRe(terms);
      const hasAll = (x) => (real.length ? real : terms).every((t) => hasTerm(x, t));
      const hits = [];
      for (const entry of index) {
        const page = pages.find((p) => p.id === entry.id);
        if (!page) continue;
        const all = [page.title, ...entry.blocks];
        const phraseHit = all.some((x) => pre.test(x));
        if (!phraseHit && !(real.length && real.every((t) => all.some((x) => hasTerm(x, t))))) continue;
        const titleHit = pre.test(page.title) || hasAll(page.title);
        if (titlesOnly && !titleHit) continue;
        const ranked = entry.blocks.map((b, i) => {
          const ph = pre.test(b);
          const n = real.filter((t) => hasTerm(b, t)).length;
          return { b, i, ph, n };
        }).filter((x) => x.ph || x.n).sort((a, b) => (b.ph - a.ph) || (b.n - a.n) || (a.i - b.i));
        const snip = (x, words) => markWith(aroundRe(x.b, x.ph ? pre : wordRe(real.length ? real : terms), words), terms, x.ph);
        const ageDays = page.edited ? (Date.now() - page.edited) / 864e5 : 365;
        const score = (titleHit ? 100 : 0) + (phraseHit ? 40 : 0) + Math.min(ranked.length, 20) * 0.5 + Math.max(0, 10 - Math.log2(1 + ageDays * 24) * 1.5) - page.depth * 0.5;
        hits.push({ kind: "hit", url: page.url, title: page.title, page, score, titleHit,
          excerpt: ranked[0] ? snip(ranked[0], 4) : "",
          subs: ranked.slice(0, 8).map((x) => snip(x, 3)) });
      }
      return hits.sort((a, b) => b.score - a.score).slice(0, 30);
    }

    function render() {
      list.innerHTML = items.map((it, i) => {
        const p = it.page || {};
        const badge = p.url === current ? '<span class="ns-si-badge">Current Page</span>' : "";
        if (it.kind === "page") {
          const parent = p.trail?.length ? `<span class="ns-si-parent"><span class="ns-si-dash">—</span>${esc(p.trail[p.trail.length - 1])}</span>` : "";
          return `<a class="ns-si ns-si-page${i === sel ? " is-sel" : ""}" href="${esc(p.url)}" data-i="${i}" role="option"><span class="ns-si-icon">${iconHtml(p)}</span><span class="ns-si-title">${esc(p.title)}</span>${badge}${parent}</a>`;
        }
        const meta = [p.trail?.length ? trail(p.trail) : "", ago(p.edited)].filter(Boolean).join('<span class="ns-si-dot">•</span>');
        return `<a class="ns-si ns-si-hit${i === sel ? " is-sel" : ""}" href="${esc(it.url)}" data-i="${i}" role="option"><span class="ns-si-icon">${iconHtml(p)}</span><span class="ns-si-main"><span class="ns-si-line"><span class="ns-si-title">${esc(p.title || it.title)}</span>${badge}</span>${meta ? `<span class="ns-si-meta">${meta}</span>` : ""}<span class="ns-si-excerpt">${it.excerpt}</span></span></a>`;
      }).join("") || '<div class="ns-search-empty">No results</div>';
      showPreview();
    }

    function showPreview() {
      const it = items[sel];
      if (!it) { preview.innerHTML = ""; delete preview.dataset.src; return; }
      const p = it.page || {};
      if (it.kind === "page") {
        // Miniature of the page itself (the page in ?ns-preview mode).
        const src = p.url + "?ns-preview";
        if (preview.dataset.src !== src) { preview.dataset.src = src; preview.innerHTML = `${actions(p.url)}<iframe class="ns-sp-frame" src="${esc(src)}" tabindex="-1" title=""></iframe>`; }
        return;
      }
      delete preview.dataset.src;
      const snippets = (it.subs?.length ? it.subs : [it.excerpt]).slice(0, 8);
      const cover = p.cover?.src ? `<img src="${esc(p.cover.src)}" alt="" style="object-position:${esc(p.cover.pos)}">` : "";
      const bigIcon = p.icon ? `<div class="ns-sp-icon">${p.icon.emoji ? `<span class="ns-si-emoji">${esc(p.icon.emoji)}</span>` : `<img src="${esc(p.icon.img)}" alt="">`}</div>` : "";
      preview.innerHTML = `${actions(it.url)}<div class="ns-sp-cover">${cover}</div><div class="ns-sp-body${bigIcon ? " has-icon" : ""}">${bigIcon}${p.trail?.length ? `<div class="ns-sp-trail">${trail(p.trail)}</div>` : ""}<div class="ns-sp-title">${esc(p.title || it.title)}</div>${snippets.map((s) => `<div class="ns-sp-snippet">${s.startsWith("…") ? s : "..." + s}</div>`).join("")}</div>`;
    }

    // Copy link / open buttons on the preview card.
    const LINK = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M8.6 11.4a3.2 3.2 0 0 0 4.5 0l2.6-2.6a3.2 3.2 0 0 0-4.5-4.5l-1 1M11.4 8.6a3.2 3.2 0 0 0-4.5 0l-2.6 2.6a3.2 3.2 0 0 0 4.5 4.5l1-1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    const OPEN = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M6 14 14 6M7.5 6H14v6.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const actions = (url) => `<div class="ns-sp-actions"><button type="button" class="ns-sp-btn" data-ns-copy="${esc(url)}" aria-label="Copy link" title="Copy link">${LINK}</button><a class="ns-sp-btn" href="${esc(url)}" aria-label="Open page" title="Open">${OPEN}</a></div>`;

    function select(i, scroll) {
      if (!items.length) return;
      sel = (i + items.length) % items.length;
      list.querySelectorAll(".ns-si").forEach((el, k) => el.classList.toggle("is-sel", k === sel));
      if (scroll) list.querySelector(".is-sel")?.scrollIntoView({ block: "nearest" });
      showPreview();
    }

    function browse() {
      label.textContent = "Pages"; sort.hidden = true;
      const cur = pages.find((p) => p.url === current);
      items = [cur, ...pages.filter((p) => p !== cur)].filter(Boolean).slice(0, 12).map((page) => ({ kind: "page", page }));
      sel = 0; render();
    }

    async function run(q) {
      const mine = ++seq;
      if (!q.trim()) return browse();
      index ||= await fetch("/ns-search.json").then((r) => r.json()).catch(() => []);
      if (mine !== seq) return;
      items = searchIndex(q);
      if (sortBy !== "relevance") items.sort((a, b) => ((b.page?.edited || 0) - (a.page?.edited || 0)) * (sortBy === "newest" ? 1 : -1));
      label.textContent = `Search results (${items.length})`; sort.hidden = !items.length;
      sel = 0; render();
    }

    async function open() {
      box.hidden = false;
      document.documentElement.classList.add("ns-search-open");
      input.value = ""; input.focus();
      pages ||= await fetch("/ns-pages.json").then((r) => r.json()).catch(() => []);
      browse();
      index ||= await fetch("/ns-search.json").then((r) => r.json()).catch(() => []);
    }
    function close() { box.hidden = true; document.documentElement.classList.remove("ns-search-open"); }

    document.addEventListener("click", (e) => {
      if (menu && !menu.hidden && !e.target.closest(".ns-search-menu, [data-ns-filter]")) menu.hidden = true;
      if (e.target.closest("[data-ns-search]")) { e.preventDefault(); open(); }
      else if (e.target.closest("[data-ns-close]")) close();
      else if (e.target.closest("[data-ns-copy]")) {
        const b = e.target.closest("[data-ns-copy]");
        navigator.clipboard?.writeText(new URL(b.dataset.nsCopy, location.href).href);
        b.classList.add("is-done"); b.title = "Copied"; setTimeout(() => { b.classList.remove("is-done"); b.title = "Copy link"; }, 1400);
      }
      else if (e.target.closest("[data-sort]")) {
        sortBy = e.target.closest("[data-sort]").dataset.sort;
        menu.querySelectorAll("[data-sort]").forEach((x) => x.setAttribute("aria-checked", String(x.dataset.sort === sortBy)));
        sortLabel.textContent = SORT_NAMES[sortBy]; menu.hidden = true; run(input.value); input.focus();
      }
      else if (e.target.closest("[data-titles]")) {
        titlesOnly = !titlesOnly;
        e.target.closest("[data-titles]").setAttribute("aria-checked", String(titlesOnly));
        menu.hidden = true; run(input.value); input.focus();
      }
      else if (e.target.closest("[data-ns-filter]")) {
        const b = e.target.closest("[data-ns-filter]").getBoundingClientRect(), d = box.querySelector(".ns-search-dialog").getBoundingClientRect();
        menu.style.top = `${b.bottom - d.top + 6}px`; menu.style.right = `${Math.max(14, d.right - b.right)}px`;
        menu.hidden = !menu.hidden;
      }
      else if (e.target.closest("[data-ns-toggle-preview]")) {
        const on = !box.classList.toggle("no-preview");
        e.target.closest("[data-ns-toggle-preview]").setAttribute("aria-pressed", String(on));
      }
    });
    list.addEventListener("mousemove", (e) => { const el = e.target.closest(".ns-si"); if (el && +el.dataset.i !== sel) select(+el.dataset.i); });
    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "p")) { e.preventDefault(); box.hidden ? open() : close(); return; }
      if (box.hidden) return;
      if (e.key === "Escape") { if (!menu.hidden) menu.hidden = true; else close(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); select(sel + 1, true); }
      else if (e.key === "ArrowUp") { e.preventDefault(); select(sel - 1, true); }
      else if (e.key === "Enter" && items[sel]) {
        e.preventDefault();
        const url = items[sel].url || items[sel].page?.url;
        if (e.metaKey || e.ctrlKey) window.open(url, "_blank"); else location.href = url;
      }
    });
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => run(input.value), 90); });
  }

  // ---------- popovers (shared by every "⋯" and database menu) ----------
  let pop;
  const closePop = () => { pop?.remove(); pop = null; };
  function openPop(anchor, html, { align = "start" } = {}) {
    closePop();
    pop = document.createElement("div");
    pop.className = "ns-pop"; pop.setAttribute("role", "menu"); pop.innerHTML = html;
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect(), w = pop.offsetWidth;
    let left = align === "end" ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, innerWidth - w - 8));
    pop.style.left = `${left + scrollX}px`; pop.style.top = `${r.bottom + 6 + scrollY}px`;
    return pop;
  }
  const escH = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const copy = (text, btn) => { navigator.clipboard?.writeText(new URL(text, location.href).href); if (btn) { const t = btn.innerHTML; btn.innerHTML = "Copied"; setTimeout(() => { btn.innerHTML = t; closePop(); }, 700); } };

  // ---------- full-screen image viewer ----------
  function lightbox(src) {
    const box = document.createElement("div");
    box.className = "ns-lightbox"; box.innerHTML = `<img src="${escH(src)}" alt="">`;
    const close = () => { box.remove(); removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape" || e.key === " ") { e.preventDefault(); close(); } };
    box.addEventListener("click", close); addEventListener("keydown", onKey);
    document.body.appendChild(box);
  }

  // ---------- database views: sort / filter / search, client-side ----------
  function db(head) {
    const bar = head.nextElementSibling;
    const data = JSON.parse(bar.nextElementSibling.textContent);
    const grid = bar.nextElementSibling.nextElementSibling;
    const cards = [...grid.querySelectorAll(".ns-card")];
    const state = head.__ns ||= { sorts: data.sorts.map((s) => ({ ...s })), filters: [], q: "", touched: false };
    const S = data.schema;
    const val = (card, k) => JSON.parse(card.dataset.row)[k] || "";
    const optIndex = (k, v) => { const o = (S[k]?.options || []).findIndex((x) => x.value === v.split(",")[0].trim()); return o < 0 ? 1e9 : o; };
    const cmp = (k, a, b) => {
      const t = S[k]?.type, x = val(a, k), y = val(b, k);
      if (!x && y) return 1; if (x && !y) return -1;
      if (t === "select" || t === "multi_select") return optIndex(k, x) - optIndex(k, y);
      if (t === "number") return parseFloat(x) - parseFloat(y);
      const dx = Date.parse(x), dy = Date.parse(y);
      if (!isNaN(dx) && !isNaN(dy)) return dx - dy;
      return x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" });
    };
    function apply() {
      // Notion's own order until the visitor changes the sort.
      const order = state.touched ? [...cards].sort((a, b) => { for (const s of state.sorts) { const c = cmp(s.property, a, b); if (c) return s.direction === "descending" ? -c : c; } return a.dataset.order - b.dataset.order; }) : [...cards].sort((a, b) => a.dataset.order - b.dataset.order);
      order.forEach((c) => c.parentElement.appendChild(c)); // within its own column/body (boards, tables)
      const q = state.q.trim().toLowerCase();
      for (const c of cards) {
        const row = JSON.parse(c.dataset.row);
        let ok = !q || Object.values(row).join(" ").toLowerCase().includes(q);
        for (const f of state.filters) {
          const v = row[f.property] || "", t = S[f.property]?.type;
          if (t === "checkbox") ok &&= (v === "Yes") === f.value;
          else if (t === "select" || t === "multi_select") ok &&= !f.values.length || v.split(",").map((x) => x.trim()).some((x) => f.values.includes(x));
          else ok &&= !f.text || v.toLowerCase().includes(f.text.toLowerCase());
        }
        c.classList.toggle("is-hidden", !ok);
      }
      const chip = bar.querySelector("[data-db-sortcount]");
      if (chip) chip.textContent = `${state.sorts.length} ${state.sorts.length === 1 ? "sort" : "sorts"}`;
      head.querySelector('[data-db="sort"]').classList.toggle("is-on", state.sorts.length > 0);
      const fl = bar.querySelector(".ns-db-filters");
      fl.innerHTML = state.filters.map((f, i) => `<button type="button" class="ns-db-chip is-blue" data-db-filter="${i}">${escH(S[f.property]?.name)}: ${escH(describe(f))} ▾</button>`).join("");
    }
    const describe = (f) => S[f.property]?.type === "checkbox" ? (f.value ? "Checked" : "Unchecked") : f.values ? (f.values.join(", ") || "All") : (f.text ? `contains ${f.text}` : "All");
    const props = Object.entries(S).filter(([, s]) => ["title", "text", "select", "multi_select", "checkbox", "number", "date", "url"].includes(s.type));
    function sortMenu(anchor) {
      const opts = (sel) => props.map(([k, s]) => `<option value="${escH(k)}"${k === sel ? " selected" : ""}>${escH(s.name)}</option>`).join("");
      const p = openPop(anchor, state.sorts.map((s, i) => `<div class="ns-pop-row"><select data-sort-prop="${i}">${opts(s.property)}</select><select data-sort-dir="${i}"><option value="ascending"${s.direction === "ascending" ? " selected" : ""}>Ascending</option><option value="descending"${s.direction === "descending" ? " selected" : ""}>Descending</option></select><button type="button" class="ns-pop-x" data-sort-del="${i}" aria-label="Remove sort">×</button></div>`).join("") + `<button type="button" class="ns-pop-item is-muted" data-sort-add>+ Add sort</button>${state.sorts.length ? '<button type="button" class="ns-pop-item is-muted" data-sort-clear>Delete sort</button>' : ""}`);
      p.addEventListener("change", (e) => { const i = e.target.dataset.sortProp ?? e.target.dataset.sortDir; if (i === undefined) return; if (e.target.dataset.sortProp !== undefined) state.sorts[i].property = e.target.value; else state.sorts[i].direction = e.target.value; state.touched = true; apply(); });
      p.addEventListener("click", (e) => {
        if (e.target.closest("[data-sort-del]")) { state.sorts.splice(+e.target.closest("[data-sort-del]").dataset.sortDel, 1); state.touched = true; apply(); sortMenu(anchor); }
        else if (e.target.closest("[data-sort-add]")) { state.sorts.push({ property: props[0][0], direction: "ascending" }); state.touched = true; apply(); sortMenu(anchor); }
        else if (e.target.closest("[data-sort-clear]")) { state.sorts = []; state.touched = true; apply(); closePop(); }
      });
    }
    function filterEditor(anchor, f) {
      const s = S[f.property];
      let body;
      if (s.type === "checkbox") body = `<button type="button" class="ns-pop-item" data-f-check="1">${f.value ? "✓ " : ""}Checked</button><button type="button" class="ns-pop-item" data-f-check="0">${f.value === false ? "✓ " : ""}Unchecked</button>`;
      else if (s.type === "select" || s.type === "multi_select") body = s.options.map((o) => `<label class="ns-pop-check"><input type="checkbox" data-f-opt="${escH(o.value)}"${f.values.includes(o.value) ? " checked" : ""}> ${escH(o.value)}</label>`).join("");
      else body = `<div class="ns-pop-row"><input type="text" placeholder="Type a value…" data-f-text value="${escH(f.text || "")}"></div>`;
      const p = openPop(anchor, `<div class="ns-pop-label">${escH(s.name)}</div>${body}<div class="ns-pop-sep"></div><button type="button" class="ns-pop-item is-muted" data-f-del>Delete filter</button>`);
      p.querySelector("[data-f-text]")?.focus();
      p.addEventListener("input", (e) => { if (e.target.matches("[data-f-text]")) { f.text = e.target.value; apply(); } });
      p.addEventListener("change", (e) => { if (e.target.matches("[data-f-opt]")) { f.values = [...p.querySelectorAll("[data-f-opt]:checked")].map((x) => x.dataset.fOpt); apply(); } });
      p.addEventListener("click", (e) => {
        if (e.target.closest("[data-f-check]")) { f.value = e.target.closest("[data-f-check]").dataset.fCheck === "1"; apply(); closePop(); }
        else if (e.target.closest("[data-f-del]")) { state.filters.splice(state.filters.indexOf(f), 1); apply(); closePop(); }
      });
    }
    function addFilterMenu(anchor) {
      const p = openPop(anchor, `<div class="ns-pop-label">Filter by</div>` + props.map(([k, s]) => `<button type="button" class="ns-pop-item" data-f-new="${escH(k)}">${escH(s.name)}</button>`).join(""));
      p.addEventListener("click", (e) => {
        const b = e.target.closest("[data-f-new]"); if (!b) return;
        const k = b.dataset.fNew, t = S[k].type;
        const f = { property: k, ...(t === "checkbox" ? { value: true } : t === "select" || t === "multi_select" ? { values: [] } : { text: "" }) };
        state.filters.push(f); apply();
        const chip = bar.querySelector(`[data-db-filter="${state.filters.length - 1}"]`);
        filterEditor(chip || anchor, f);
      });
    }
    return { state, apply, sortMenu, addFilterMenu, filterEditor, bar };
  }

  document.addEventListener("click", (e) => {
    if (pop && !e.target.closest(".ns-pop")) {
      const keep = e.target.closest("[data-db], [data-db-filter], [data-card-menu], [data-image-menu], [data-embed-menu]");
      closePop();
      if (!keep) { /* fall through to other handlers */ }
    }
    const cc = e.target.closest("[data-copy-code]");
    if (cc) { navigator.clipboard?.writeText(cc.closest(".ns-code-box").querySelector("code").innerText); cc.textContent = "Copied"; setTimeout(() => (cc.textContent = "Copy"), 1200); return; }
    const props = e.target.closest("[data-props-toggle]");
    if (props) {
      const open = props.getAttribute("aria-expanded") !== "true";
      props.setAttribute("aria-expanded", String(open));
      props.querySelector("span").textContent = open ? props.dataset.less : props.dataset.more;
      props.parentElement.querySelectorAll(".ns-prop-extra").forEach((r) => (r.hidden = !open));
      return;
    }
    const zoom = e.target.closest("img[data-zoom]");
    if (zoom) { e.preventDefault(); lightbox(zoom.currentSrc || zoom.src); return; }
    const im = e.target.closest("[data-image-menu]");
    if (im) {
      e.preventDefault(); const src = im.dataset.imageMenu;
      const p = openPop(im, `<a class="ns-pop-item" href="${escH(src)}" download>Download</a><button type="button" class="ns-pop-item" data-full>Full screen<span class="ns-pop-hint">Space</span></button><a class="ns-pop-item" href="${escH(src)}" target="_blank" rel="noopener">View original</a>`, { align: "end" });
      p.querySelector("[data-full]").addEventListener("click", () => { closePop(); lightbox(src); });
      return;
    }
    const em = e.target.closest("[data-embed-menu]");
    if (em) {
      e.preventDefault(); const src = em.dataset.embedMenu;
      const p = openPop(em, `<a class="ns-pop-item" href="${escH(src)}" target="_blank" rel="noopener">View original</a><button type="button" class="ns-pop-item" data-copy>Copy link</button>`, { align: "end" });
      p.querySelector("[data-copy]").addEventListener("click", (ev) => copy(src, ev.currentTarget));
      return;
    }
    const cm = e.target.closest("[data-card-menu]");
    if (cm) {
      e.preventDefault(); e.stopPropagation(); const href = cm.dataset.cardMenu;
      const p = openPop(cm, `<div class="ns-pop-label">Open in</div><a class="ns-pop-item" href="${escH(href)}">Full page</a><a class="ns-pop-item" href="${escH(href)}" target="_blank" rel="noopener">New tab</a><div class="ns-pop-sep"></div><button type="button" class="ns-pop-item" data-copy>Copy link</button>`, { align: "end" });
      p.querySelector("[data-copy]").addEventListener("click", (ev) => copy(href, ev.currentTarget));
      return;
    }
    const d = e.target.closest("[data-db], [data-db-filter]");
    if (d) {
      const head = d.closest(".ns-gallery-head") || d.closest(".ns-db-bar").previousElementSibling;
      const v = db(head), what = d.dataset.db;
      const showBar = (on) => { v.bar.hidden = !on; head.querySelector('[data-db="minimize"]').hidden = !on; };
      if (what === "filter" || what === "sort") { showBar(v.bar.hidden || true); if (what === "sort" && v.state.sorts.length) v.sortMenu(v.bar.querySelector('[data-db="sorts"]')); else if (what === "filter") v.addFilterMenu(v.bar.querySelector('[data-db="addfilter"]')); else v.sortMenu(d); }
      else if (what === "minimize") showBar(false);
      else if (what === "sorts") v.sortMenu(d);
      else if (what === "addfilter") v.addFilterMenu(d);
      else if (d.dataset.dbFilter !== undefined) v.filterEditor(d, v.state.filters[+d.dataset.dbFilter]);
      else if (what === "search") {
        const input = head.querySelector(".ns-db-search input");
        input.hidden = false; input.focus();
        if (!input.__ns) { input.__ns = 1; input.addEventListener("input", () => { v.state.q = input.value; v.apply(); }); input.addEventListener("blur", () => { if (!input.value) input.hidden = true; }); input.addEventListener("keydown", (k) => { if (k.key === "Escape") { input.value = ""; v.state.q = ""; v.apply(); input.blur(); } }); }
      }
    }
  });
  addEventListener("keydown", (e) => { if (e.key === "Escape") closePop(); });
  addEventListener("resize", closePop);

  // Outline: darken the dash of the section in view.
  const dashes = [...document.querySelectorAll(".ns-dash")];
  const links = [...document.querySelectorAll(".ns-outline-item")];
  const targets = links.map((a) => document.getElementById(a.getAttribute("href").slice(1)));
  if (dashes.length) {
    const col = dashes[0].parentElement, panel = links[0]?.parentElement;
    // Fit every dash in the window: shrink the gap (12px, down to 4px) on long pages; scroll the rest.
    const fit = () => {
      const room = innerHeight - 214 - 12, n = dashes.length;
      const gap = n > 1 ? Math.max(4, Math.min(12, Math.floor((room - n * 2) / (n - 1)))) : 12;
      col.style.setProperty("--ns-dash-gap", gap + "px");
    };
    const update = () => {
      let i = 0;
      // Headings in closed tabs/toggles aren't rendered (top = 0): skip them or the highlight sticks.
      const live = targets.map((t) => (t && t.getClientRects().length ? t.getBoundingClientRect().top : null));
      // The activation line sits 140px down, and slides to the bottom of the window over the last
      // screen of scrolling, so the final headings (which can never reach the top) still light up in order.
      const left = document.documentElement.scrollHeight - innerHeight - scrollY;
      const line = 140 + Math.max(0, innerHeight - 140 - 24) * Math.max(0, 1 - left / innerHeight);
      live.forEach((top, k) => { if (top !== null && top < line) i = k; });
      dashes.forEach((d, k) => d.classList.toggle("is-active", k === i));
      links.forEach((d, k) => d.classList.toggle("is-active", k === i));
      // Keep the current dash (and panel item) in view when the list is taller than its box.
      const a = dashes[i];
      if (col.scrollHeight > col.clientHeight) col.scrollTop = Math.max(0, a.offsetTop - col.offsetTop - col.clientHeight / 2);
      if (panel && panel.scrollHeight > panel.clientHeight && links[i]) panel.scrollTop = Math.max(0, links[i].offsetTop - panel.clientHeight / 2);
    };
    addEventListener("resize", () => { fit(); update(); });
    // The panel is display:none until hover, so center its current item once it opens.
    col.parentElement.addEventListener("mouseenter", () => requestAnimationFrame(update));
    fit();
    addEventListener("scroll", update, { passive: true });
    update();
  }
})();
