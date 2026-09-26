/* Chapter 9: orchestration. A small DAG with workers, retries, failures and backfills. */
(function () {
  'use strict';
  const { $, h, svg } = DE;

  const TASKS = {
    extract_orders: { deps: [], dur: 3, x: 0, y: 0 },
    extract_customers: { deps: [], dur: 2, x: 0, y: 1 },
    extract_products: { deps: [], dur: 2, x: 0, y: 2 },
    stg_orders: { deps: ['extract_orders'], dur: 2, x: 1, y: 0 },
    stg_customers: { deps: ['extract_customers'], dur: 2, x: 1, y: 1 },
    stg_products: { deps: ['extract_products'], dur: 1, x: 1, y: 2 },
    fct_sales: { deps: ['stg_orders', 'stg_products'], dur: 3, x: 2, y: 0.5 },
    dim_customer: { deps: ['stg_customers'], dur: 2, x: 2, y: 1.7 },
    revenue_dash: { deps: ['fct_sales', 'dim_customer'], dur: 1, x: 3, y: 0.5 },
    churn_features: { deps: ['dim_customer'], dur: 2, x: 3, y: 1.9 },
  };
  const NAMES = Object.keys(TASKS);
  const TICK_MS = 380;
  const NW = 150, NH = 44, GX = 180, GY = 70;

  const STATUS_LABEL = {
    none: 'not started', queued: 'queued', running: 'running', success: 'success',
    failed: 'failed', upstream_failed: 'upstream failed', up_for_retry: 'retry pending',
  };

  let workers = 2, retries = 1;
  const faults = {};                   // task -> 'flaky' | 'broken'
  let runs = [], queue = [], active = null, timer = 0, dayCounter = 0, viewing = true;

  const descendants = (t) => NAMES.filter((n) => TASKS[n].deps.includes(t)).flatMap((c) => [c, ...descendants(c)]);

  function newRun(date) {
    const st = {}, att = {}, left = {};
    for (const n of NAMES) { st[n] = 'queued'; att[n] = 0; left[n] = 0; }
    return { date, st, att, left, ticks: 0, done: false };
  }

  function dateLabel(offset) {
    const d = new Date(Date.UTC(2026, 8, 26 + offset));
    return d.toISOString().slice(5, 10);
  }

  function tick() {
    if (!active) {
      active = queue.shift() || null;
      if (!active) { stop(); render(); return; }
    }
    const r = active;
    r.ticks++;
    // Progress running tasks.
    for (const n of NAMES) {
      if (r.st[n] === 'running' && --r.left[n] <= 0) {
        const f = faults[n];
        const fail = f === 'broken' || (f === 'flaky' && r.att[n] === 1);
        if (!fail) r.st[n] = 'success';
        else if (r.att[n] <= retries) r.st[n] = 'up_for_retry';
        else {
          r.st[n] = 'failed';
          for (const d of descendants(n)) if (r.st[d] === 'queued') r.st[d] = 'upstream_failed';
        }
      } else if (r.st[n] === 'up_for_retry' && r.left[n] <= 0) {
        r.st[n] = 'queued';           // back in line after one tick of backoff
      }
    }
    // Start whatever is ready, up to the worker limit.
    let busy = NAMES.filter((n) => r.st[n] === 'running').length;
    for (const n of NAMES) {
      if (busy >= workers) break;
      if (r.st[n] === 'queued' && TASKS[n].deps.every((d) => r.st[d] === 'success')) {
        r.st[n] = 'running';
        r.att[n]++;
        r.left[n] = TASKS[n].dur;
        busy++;
      }
    }
    if (!NAMES.some((n) => ['queued', 'running', 'up_for_retry'].includes(r.st[n]))) {
      r.done = true;
      active = null;
      if (!queue.length) stop();
    }
    render();
  }

  function start() { if (!timer) timer = setInterval(tick, TICK_MS); }
  function stop() { clearInterval(timer); timer = 0; }

  function trigger(offsets) {
    for (const o of offsets) {
      const r = newRun(dateLabel(o));
      runs.push(r);
      queue.push(r);
    }
    if (runs.length > 8) runs = runs.slice(-8);
    start();
    render();
  }

  function clearFailed() {
    const r = runs[runs.length - 1];
    if (!r || !r.done) return;
    for (const n of NAMES) if (r.st[n] === 'failed' || r.st[n] === 'upstream_failed') { r.st[n] = 'queued'; r.att[n] = 0; }
    r.done = false;
    queue.push(r);
    start();
    render();
  }

  function shown() { return active || runs[runs.length - 1] || null; }

  function drawDag() {
    const r = shown();
    const W = 3 * GX + NW + 20, H = 2.9 * GY + NH;
    const pos = (n) => [10 + TASKS[n].x * GX, 10 + TASKS[n].y * GY];
    const edges = NAMES.flatMap((n) => TASKS[n].deps.map((d) => {
      const [x1, y1] = pos(d), [x2, y2] = pos(n);
      const sx = x1 + NW, sy = y1 + NH / 2, ex = x2 - 4, ey = y2 + NH / 2;
      const mx = (sx + ex) / 2;
      return svg('path', { class: 'edge', d: `M${sx},${sy} C${mx},${sy} ${mx},${ey} ${ex},${ey}` });
    }));
    const nodes = NAMES.map((n) => {
      const [x, y] = pos(n);
      const st = r ? r.st[n] : 'none';
      const att = r ? r.att[n] : 0;
      const f = faults[n];
      let sub = STATUS_LABEL[st] + (att > 1 ? ` · try ${att}` : '');
      if (f) sub += ` · ${f}`;
      const g = svg('g', { class: `node ${st}`, tabindex: 0, role: 'button', 'aria-label': `${n}: ${sub}. Activate to change fault.` },
        svg('rect', { x, y, width: NW, height: NH, rx: 7 }),
        f ? svg('circle', { class: 'flag', cx: x + NW - 10, cy: y + 10, r: 4 }) : null,
        svg('text', { x: x + 10, y: y + 18 }, n),
        svg('text', { x: x + 10, y: y + 35, class: 'st' }, sub));
      const cycle = () => { faults[n] = !f ? 'flaky' : f === 'flaky' ? 'broken' : undefined; render(); };
      g.addEventListener('click', cycle);
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cycle(); } });
      return g;
    });
    const defs = svg('defs', null, svg('marker', { id: 'dag-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' },
      svg('path', { d: 'M0,0 L10,5 L0,10 z', fill: 'var(--axis)' })));
    $('p9-dag').replaceChildren(svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': 'Pipeline DAG' }, defs, edges, nodes));
  }

  function drawGrid() {
    const host = $('p9-grid');
    if (!runs.length) { host.replaceChildren(h('p.lbl', 'No runs yet.')); return; }
    host.style.gridTemplateColumns = `minmax(6rem, 9rem) repeat(${runs.length}, minmax(1.4rem, 2.6rem))`;
    const cells = [h('span'), ...runs.map((r) => h('span.gh', r.date))];
    for (const n of NAMES) {
      cells.push(h('span.gl', n));
      for (const r of runs) cells.push(h('span.gc', { class: r.st[n], title: `${n} on ${r.date}: ${STATUS_LABEL[r.st[n]]}` }));
    }
    host.replaceChildren(...cells);
  }

  function render() {
    if (!viewing) return;
    drawDag();
    drawGrid();
    const r = shown();
    const count = (s) => (r ? NAMES.filter((n) => r.st[n] === s).length : 0);
    const state = !r ? 'idle' : !r.done ? 'running' : count('success') === NAMES.length ? 'success' : 'failed';
    DE.stat('p9-run', r ? `${r.date} · ${state}` : '–', state === 'success' ? 'good-text' : state === 'failed' ? 'bad-text' : null);
    DE.stat('p9-ok', `${count('success')} / ${NAMES.length}`);
    DE.stat('p9-time', r ? `${r.ticks} ticks` : '–');
    DE.stat('p9-queue', String(queue.length));
    const last = runs[runs.length - 1];
    $('p9-clear').disabled = !(last && last.done && NAMES.some((n) => ['failed', 'upstream_failed'].includes(last.st[n])));
  }

  function init() {
    DE.range('p9-workers', null, (v) => { workers = v; });
    DE.seg('p9-retries', (v) => { retries = +v; });
    retries = 1;
    $('p9-trigger').addEventListener('click', () => trigger([dayCounter++]));
    $('p9-backfill').addEventListener('click', () => trigger([-3, -2, -1]));
    $('p9-clear').addEventListener('click', clearFailed);
    $('p9-reset').addEventListener('click', () => {
      stop(); runs = []; queue = []; active = null; dayCounter = 0;
      for (const k in faults) delete faults[k];
      render();
    });
    DE.onView('orchestration', {
      enter: () => { viewing = true; render(); if (active || queue.length) start(); },
      leave: () => { viewing = false; stop(); },
    });
    render();
    viewing = false;
  }
  init();
})();
