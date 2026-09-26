/* Shared helpers: seeded randomness, DOM building, tables, controls, routing. */
(function () {
  'use strict';
  const DE = (window.DE = {});

  // ---------- numbers ----------

  // Mulberry32: small, fast, seedable. Every dataset here is reproducible.
  DE.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  DE.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  DE.money = (v) => (Number.isFinite(v) ? '$' + v.toFixed(2) : '–');
  DE.int = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '–');
  DE.pct = (v, d = 0) => (Number.isFinite(v) ? (v * 100).toFixed(d) + '%' : '–');

  // ---------- DOM ----------

  DE.$ = (id) => document.getElementById(id);

  // h('div.panel', {onclick}, child, 'text', ...) — tiny element builder.
  DE.h = function (tag, attrs, ...kids) {
    const [name, ...cls] = tag.split('.');
    const el = document.createElement(name || 'div');
    if (cls.length) el.className = cls.join(' ');
    if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
      kids.unshift(attrs);
      attrs = null;
    }
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  };

  DE.svg = function (tag, attrs, ...kids) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs || {}) if (attrs[k] != null) el.setAttribute(k, attrs[k]);
    for (const kid of kids.flat()) {
      if (kid == null) continue;
      el.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  };

  // Render rows into a scrollable table.
  // cols: [{ key, label, num, fmt(v, row), cls(row) }]
  // opts: { rowClass(row), empty, caption }
  DE.table = function (host, cols, rows, opts = {}) {
    host = typeof host === 'string' ? DE.$(host) : host;
    const thead = DE.h('thead', DE.h('tr', cols.map((c) => DE.h('th', { class: c.num ? 'num' : null }, c.label ?? c.key))));
    const body = rows.length
      ? rows.map((r) => DE.h('tr', { class: opts.rowClass ? opts.rowClass(r) : null },
        cols.map((c) => {
          const v = c.fmt ? c.fmt(r[c.key], r) : r[c.key];
          const td = DE.h('td', { class: [c.num ? 'num' : '', c.cls ? c.cls(r) : ''].join(' ').trim() || null });
          if (v instanceof Node) td.appendChild(v);
          else td.textContent = v == null ? 'NULL' : v;
          return td;
        })))
      : [DE.h('tr', DE.h('td.empty', { colspan: cols.length }, opts.empty || 'No rows'))];
    const table = DE.h('table.data', opts.caption ? DE.h('caption', { class: 'lbl' }, opts.caption) : null, thead, DE.h('tbody', body));
    host.replaceChildren(DE.h('div.tbl-wrap', table));
  };

  DE.tag = (text, kind) => DE.h('span.tag', { class: kind || null }, text);

  // Segmented control: buttons with data-v inside a .seg. Calls onChange(value) on click.
  DE.seg = function (id, onChange) {
    const host = DE.$(id);
    const btns = [...host.querySelectorAll('button')];
    const state = { value: (btns.find((b) => b.getAttribute('aria-pressed') === 'true') || btns[0]).dataset.v };
    const set = (v, fire = true) => {
      state.value = v;
      btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
      if (fire && onChange) onChange(v);
    };
    btns.forEach((b) => b.addEventListener('click', () => set(b.dataset.v)));
    set(state.value, false);
    return { get: () => state.value, set };
  };

  // Range input bound to its <output>. Calls onInput(number).
  DE.range = function (id, fmt, onInput) {
    const input = DE.$(id);
    const out = document.querySelector(`output[for="${id}"]`);
    const upd = (fire) => {
      const v = +input.value;
      if (out) out.textContent = fmt ? fmt(v) : v;
      if (fire && onInput) onInput(v);
    };
    input.addEventListener('input', () => upd(true));
    upd(false);
    return { get: () => +input.value, set: (v) => { input.value = v; upd(true); } };
  };

  DE.stat = function (id, value, cls) {
    const el = DE.$(id);
    el.textContent = value;
    el.className = 'stat-value' + (cls ? ' ' + cls : '');
  };

  // ---------- routing ----------
  // Hash routes: #/ is home, #/<view> is a chapter. Chapters register enter/leave hooks so
  // animations stop when you navigate away.

  const hooks = {};
  DE.onView = function (name, h) { hooks[name] = h; };

  function route() {
    const name = (location.hash.replace(/^#\/?/, '').split('/')[0]) || 'home';
    const views = [...document.querySelectorAll('.view')];
    const target = views.find((v) => v.dataset.view === name) || views[0];
    for (const v of views) {
      const on = v === target;
      if (!on && !v.hidden && hooks[v.dataset.view] && hooks[v.dataset.view].leave) hooks[v.dataset.view].leave();
      v.hidden = !on;
    }
    document.querySelectorAll('.topnav a').forEach((a) => {
      const on = a.dataset.view === target.dataset.view;
      a.classList.toggle('active', on);
      if (on) {
        a.setAttribute('aria-current', 'page');
        a.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } else a.removeAttribute('aria-current');
    });
    const h1 = target.querySelector('h1');
    document.title = target.dataset.view === 'home' ? 'Data Engineering Concepts' : `${h1 ? h1.textContent : ''} · Data Engineering Concepts`;
    if (hooks[target.dataset.view] && hooks[target.dataset.view].enter) hooks[target.dataset.view].enter();
    window.scrollTo(0, 0);
  }

  // "Next chapter" footers, built from data-next so the order lives in one place.
  function buildFooters() {
    document.querySelectorAll('.view.chapter').forEach((v) => {
      const next = v.dataset.next && document.querySelector(`.view[data-view="${v.dataset.next}"]`);
      const foot = DE.h('div.chapter-foot',
        DE.h('a.btn.ghost', { href: '#/' }, '← All topics'),
        next ? DE.h('a.btn.primary', { href: `#/${v.dataset.next}` }, `Next: ${next.dataset.short} →`) : null);
      v.appendChild(foot);
    });
  }

  DE.start = function () {
    buildFooters();
    window.addEventListener('hashchange', route);
    route();
  };
})();
