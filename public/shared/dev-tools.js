// Navbar dev tools, loaded on every page: a "Test card" panel and a
// "Products" panel (sample one-time + subscription products), both
// click-to-copy so they can be pasted straight into a checkout or an API
// call. Self-contained: injects its own styles (using the page's theme
// variables where they exist) and mounts itself next to the theme toggle,
// falling back to a small floating bar on pages that have no navbar.

(function () {
  if (window.__devToolsMounted) return;
  window.__devToolsMounted = true;

  // FastSpring test cards. Expiry can be any future date; "12/30" is just a
  // concrete value to copy.
  const TEST_CARD = {
    rows: [
      { label: "Success", value: "4242 4242 4242 4242", tone: "ok" },
      { label: "Decline", value: "4000 0000 0000 0002", tone: "bad" },
      {
        label: "Expiry",
        value: "Any future date",
        copy: "12/30",
      },
      { label: "CVV", value: "*UZPF" },
    ],
  };

  const ICON_CARD =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6.5 15h4"/></svg>';
  const ICON_BOX =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 3.5 7.5v9L12 21l8.5-4.5v-9L12 3Z"/><path d="m3.5 7.5 8.5 4.5 8.5-4.5M12 12v9"/></svg>';

  const css = `
.dt-group{display:inline-flex;align-items:center;gap:.4rem;font-family:inherit}
.dt-btn{display:inline-flex;align-items:center;gap:.45rem;height:36px;padding:0 .8rem;border-radius:8px;
  border:1px solid var(--border,#e3e6eb);background:var(--bg-card,var(--surface,#fff));
  color:var(--text-dim,var(--muted,#5f6672));font:500 .82rem/1 inherit;font-family:inherit;cursor:pointer;
  transition:border-color .15s ease,color .15s ease}
.dt-btn:hover,.dt-btn[aria-expanded="true"]{border-color:var(--accent,#0f62fe);color:var(--text,#16181d)}
.dt-btn:focus-visible{outline:2px solid var(--accent,#0f62fe);outline-offset:2px}
.dt-on-dark .dt-btn{background:#1c1f27;border-color:#2a2d3a;color:#d4d6e0}
.dt-on-dark .dt-btn:hover,.dt-on-dark .dt-btn[aria-expanded="true"]{color:#fff}
.dt-float{position:fixed;top:12px;right:12px;z-index:9998}
.dt-dock{position:fixed;right:12px;bottom:12px;z-index:9998;padding:6px;border-radius:12px;
  background:var(--bg-card,var(--surface,#fff));border:1px solid var(--border,#e3e6eb);
  box-shadow:0 10px 30px -10px rgba(0,0,0,.4)}
@media (max-width:760px){.dt-btn span{display:none}.dt-btn{padding:0;width:36px;justify-content:center}}

.dt-panel{position:fixed;z-index:9999;width:min(360px,calc(100vw - 24px));max-height:min(600px,calc(100vh - 80px));overflow:auto;
  background:var(--bg-card,var(--surface,#fff));color:var(--text,#16181d);
  border:1px solid var(--border,#e3e6eb);border-radius:12px;
  box-shadow:0 18px 48px -12px rgba(0,0,0,.35);padding:0 .5rem .5rem;font:14px/1.4 -apple-system,"Helvetica Neue",Helvetica,Arial,sans-serif}
.dt-panel[hidden]{display:none}
.dt-head{position:sticky;top:0;z-index:1;margin:0 -.5rem;padding:.75rem 1.1rem .45rem;display:flex;align-items:baseline;justify-content:space-between;
  background:var(--bg-card,var(--surface,#fff));border-bottom:1px solid var(--border,#e3e6eb)}
.dt-title{font-weight:700;font-size:.92rem}
.dt-sub{color:var(--text-dim,var(--muted,#5f6672));font-size:.74rem}
.dt-section{padding:.6rem .6rem .1rem;font-size:.68rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-dim,var(--muted,#5f6672))}
.dt-row{display:flex;align-items:center;justify-content:space-between;gap:.8rem;width:100%;text-align:left;
  padding:.38rem .6rem;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;cursor:pointer}
.dt-row:hover,.dt-row:focus-visible{background:var(--bg,rgba(127,127,127,.12));outline:none}
.dt-row:focus-visible{box-shadow:inset 0 0 0 2px var(--accent,#0f62fe)}
.dt-label{display:flex;align-items:center;gap:.5rem;color:var(--text-dim,var(--muted,#5f6672));font-size:.8rem;min-width:0}
.dt-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--text-dim,#999)}
.dt-dot.ok{background:var(--success,#16a34a)}.dt-dot.bad{background:var(--danger,#dc2626)}
.dt-val{font:600 .86rem/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;text-align:right;white-space:nowrap}
.dt-val.plain{font-family:inherit;font-weight:500;color:var(--text-dim,var(--muted,#5f6672))}
.dt-copied{color:var(--success,#16a34a)}
.dt-prod{flex-direction:column;align-items:stretch;gap:.1rem}
.dt-prod-top{display:flex;align-items:center;justify-content:space-between;gap:.8rem}
.dt-path{font:600 .86rem/1.2 ui-monospace,SFMono-Regular,Menlo,monospace}
.dt-price{font-weight:600;font-size:.84rem;white-space:nowrap}
.dt-prod-name{display:flex;align-items:center;justify-content:space-between;gap:.6rem;color:var(--text-dim,var(--muted,#5f6672));font-size:.76rem}
.dt-chip{border:1px solid var(--border,#e3e6eb);border-radius:999px;padding:.05rem .5rem;font-size:.68rem;white-space:nowrap}
.dt-foot{padding:.45rem .6rem .35rem;margin-top:.2rem;border-top:1px solid var(--border,#e3e6eb);color:var(--text-dim,var(--muted,#5f6672));font-size:.72rem}
.dt-msg{padding:1rem .6rem;color:var(--text-dim,var(--muted,#5f6672));font-size:.84rem}
.dt-msg button{margin-left:.4rem;background:none;border:0;padding:0;color:var(--accent,#0f62fe);font:inherit;cursor:pointer;text-decoration:underline}
`;

  function el(tag, props, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const kid of kids) if (kid) node.append(kid);
    return node;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Clipboard API needs a secure context; localhost is fine, but fall
      // back for anything else (e.g. opened over a LAN IP).
      const ta = el("textarea", { style: "position:fixed;opacity:0" });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {}
      ta.remove();
      return ok;
    }
  }

  // Turns a row into a click-to-copy button that flashes "Copied".
  function copyRow(row, hintEl, text) {
    row.addEventListener("click", async () => {
      const ok = await copyText(text);
      const prev = hintEl.textContent;
      hintEl.textContent = ok ? "Copied" : "Copy failed";
      hintEl.classList.add("dt-copied");
      setTimeout(() => {
        hintEl.textContent = prev;
        hintEl.classList.remove("dt-copied");
      }, 1100);
    });
  }

  // ---------- Panels ----------

  function renderCard(panel) {
    panel.replaceChildren(
      el(
        "div",
        { class: "dt-head" },
        el("div", { class: "dt-title", text: "Test card" }),
        el("div", { class: "dt-sub", text: "Click a value to copy" }),
      ),
      ...TEST_CARD.rows.map((r) => {
        const val = el("span", {
          class: "dt-val" + (r.copy ? " plain" : ""),
          text: r.value,
        });
        const row = el(
          "button",
          { class: "dt-row", type: "button", "aria-label": `Copy ${r.label}` },
          el(
            "span",
            { class: "dt-label" },
            r.tone ? el("span", { class: "dt-dot " + r.tone }) : null,
            r.label,
          ),
          val,
        );
        copyRow(row, val, r.copy || r.value);
        return row;
      }),
      el("div", {
        class: "dt-foot",
        text: "Test mode only. These cards never charge anything.",
      }),
    );
  }

  function priceLabel(p) {
    if (p.price == null) return "No price";
    const amount =
      "$" +
      p.price.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    // Managed subs have no fixed interval; a "Managed" chip says so instead.
    if (!p.interval || p.interval === "adhoc") return amount;
    const unit = p.interval;
    return p.intervalLength > 1
      ? `${amount} / ${p.intervalLength} ${unit}s`
      : `${amount} / ${unit}`;
  }

  function productRow(p) {
    const hint = el("span", { class: "dt-chip", text: "Copy path" });
    const bits = [hint];
    if (p.trialDays)
      bits.unshift(el("span", { class: "dt-chip", text: `${p.trialDays} day trial` }));
    if (p.interval === "adhoc")
      bits.unshift(el("span", { class: "dt-chip", text: "Managed", title: "Subscription the seller charges via the API" }));
    const row = el(
      "button",
      { class: "dt-row dt-prod", type: "button", "aria-label": `Copy product path ${p.path}` },
      el(
        "span",
        { class: "dt-prod-top" },
        el("span", { class: "dt-path", text: p.path }),
        el("span", { class: "dt-price", text: priceLabel(p) }),
      ),
      el(
        "span",
        { class: "dt-prod-name" },
        el("span", { text: p.name }),
        el("span", { style: "display:flex;gap:.3rem" }, ...bits),
      ),
    );
    copyRow(row, hint, p.path);
    return row;
  }

  let productsPromise = null;
  function loadProducts() {
    if (!productsPromise) {
      productsPromise = fetch("/api/dev/sample-products").then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
      });
      productsPromise.catch(() => (productsPromise = null));
    }
    return productsPromise;
  }

  function renderProducts(panel) {
    const head = el(
      "div",
      { class: "dt-head" },
      el("div", { class: "dt-title", text: "Sample products" }),
      el("div", { class: "dt-sub", text: "Click to copy the path" }),
    );
    panel.replaceChildren(head, el("div", { class: "dt-msg", text: "Loading..." }));

    loadProducts()
      .then((data) => {
        if (panel.dataset.view !== "products") return;
        panel.replaceChildren(
          head,
          ...data.groups.flatMap((g) => [
            el("div", { class: "dt-section", text: g.title }),
            ...g.items.map(productRow),
          ]),
          el("div", {
            class: "dt-foot",
            text: `Store: ${data.store}. Prices are read live.`,
          }),
        );
      })
      .catch((err) => {
        if (panel.dataset.view !== "products") return;
        const retry = el("button", { type: "button", text: "Retry" });
        retry.addEventListener("click", () => renderProducts(panel));
        panel.replaceChildren(
          head,
          el("div", { class: "dt-msg", text: `Couldn't load products (${err.message}).` }, retry),
        );
      });
  }

  // ---------- Mount ----------

  function mount() {
    document.head.append(el("style", { text: css }));

    const panel = el("div", { class: "dt-panel", role: "dialog", hidden: "" });
    document.body.append(panel);

    const group = el("div", { class: "dt-group" });
    const buttons = {};
    const views = {
      card: { icon: ICON_CARD, label: "Test card", render: renderCard },
      products: { icon: ICON_BOX, label: "Products", render: renderProducts },
    };

    function position(btn) {
      const r = btn.getBoundingClientRect();
      panel.style.right = `${Math.max(12, Math.round(window.innerWidth - r.right))}px`;
      if (group.classList.contains("dt-dock")) {
        // Docked at the bottom: open upward.
        panel.style.top = "auto";
        panel.style.bottom = `${Math.round(window.innerHeight - r.top + 8)}px`;
        panel.style.maxHeight = `${Math.round(r.top - 20)}px`;
      } else {
        panel.style.bottom = "auto";
        panel.style.top = `${Math.round(r.bottom + 8)}px`;
        panel.style.maxHeight = "";
      }
    }

    function close() {
      panel.hidden = true;
      panel.dataset.view = "";
      for (const b of Object.values(buttons)) b.setAttribute("aria-expanded", "false");
    }

    function open(name) {
      if (!panel.hidden && panel.dataset.view === name) return close();
      for (const [n, b] of Object.entries(buttons))
        b.setAttribute("aria-expanded", String(n === name));
      panel.dataset.view = name;
      panel.hidden = false;
      views[name].render(panel);
      position(buttons[name]);
    }

    for (const [name, v] of Object.entries(views)) {
      const btn = el(
        "button",
        { class: "dt-btn", type: "button", "aria-haspopup": "dialog", "aria-expanded": "false" },
      );
      btn.innerHTML = v.icon;
      btn.append(el("span", { text: v.label }));
      btn.setAttribute("aria-label", v.label);
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        open(name);
      });
      buttons[name] = btn;
      group.append(btn);
    }

    // Where it goes: beside the theme toggle when there is one (every demo
    // page), at the end of the simple topbar on the invoice test page, and
    // as a floating bar on pages with no navbar at all.
    const toggle = document.getElementById("theme-toggle");
    const topbar = document.querySelector(".topbar-inner");
    if (toggle && toggle.parentElement) {
      const parent = toggle.parentElement;
      if (parent.tagName === "HEADER") {
        // Toggle sits directly in a space-between header (index page), so
        // group it with the new buttons or they'd float to the middle.
        const wrap = el("div", { style: "display:flex;align-items:center;gap:.8rem" });
        parent.insertBefore(wrap, toggle);
        wrap.append(group, toggle);
      } else {
        parent.insertBefore(group, toggle);
      }
    } else if (topbar?.lastElementChild) {
      // Invoice test page: space-between topbar whose last child is the
      // "All demos" link. Wrap it with ours so it stays on the right.
      const last = topbar.lastElementChild;
      const wrap = el("div", { style: "display:flex;align-items:center;gap:.8rem" });
      last.before(wrap);
      wrap.append(group, last);
    } else if (document.querySelector("header")?.lastElementChild) {
      // A navbar with no theme toggle (cc-tester, the HashiCorp mock): use
      // its right-hand side - the last child if that is already a flex row,
      // otherwise wrap that last child (a plain link) together with ours.
      const last = document.querySelector("header").lastElementChild;
      if (getComputedStyle(last).display === "flex") {
        last.prepend(group);
      } else {
        const wrap = el("div", { style: "display:flex;align-items:center;gap:.8rem" });
        last.before(wrap);
        wrap.append(group, last);
      }
    } else {
      group.classList.add("dt-float");
      document.body.append(group);
    }
    // These two navbars stay dark in both themes, so the buttons can't
    // borrow the page's theme colours there.
    const onDark = !!group.closest(".billing-topbar, .hcp-topbar");
    group.classList.toggle("dt-on-dark", onDark);

    // On phone widths the navbars are already full, so dock the buttons to
    // the bottom-right corner instead. It has to be re-parented to <body>:
    // the sticky header uses backdrop-filter, which would trap a fixed
    // child inside the header.
    if (!group.classList.contains("dt-float")) {
      const marker = document.createComment("dev-tools");
      group.before(marker);
      const narrow = window.matchMedia("(max-width: 560px)");
      const applyDock = () => {
        close();
        if (narrow.matches) {
          group.classList.add("dt-dock");
          group.classList.remove("dt-on-dark");
          document.body.append(group);
        } else {
          group.classList.remove("dt-dock");
          group.classList.toggle("dt-on-dark", onDark);
          marker.after(group);
        }
      };
      narrow.addEventListener("change", applyDock);
      applyDock();
    }

    document.addEventListener("click", (e) => {
      if (!panel.hidden && !panel.contains(e.target)) close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !panel.hidden) {
        const view = panel.dataset.view;
        close();
        buttons[view]?.focus();
      }
    });
    window.addEventListener("resize", () => {
      if (!panel.hidden) position(buttons[panel.dataset.view]);
    });
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
