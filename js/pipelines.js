/* Chapter 1: ETL vs ELT. Step a tiny order export through both pipelines, then change a rule. */
(function () {
  'use strict';
  const { $, h, table } = DE;

  const RAW = [
    { id: 'A-1001', date: '2026-09-01', amount: ' 12.50 ', currency: 'usd' },
    { id: 'A-1002', date: '09/02/2026', amount: '8', currency: 'USD' },
    { id: 'A-1003', date: '2026-09-02', amount: '15.00', currency: 'EUR' },
    { id: 'A-1004', date: '2026-09-03', amount: '', currency: 'USD' },
    { id: 'A-1005', date: '2026-09-04', amount: '22.10', currency: 'usd' },
    { id: 'A-1006', date: '2026-09-05', amount: '5.25', currency: 'EUR' },
  ];
  // The source app only keeps recent orders; by the time the rule changes, the oldest are gone.
  const PURGED = new Set(['A-1001', 'A-1002', 'A-1003']);
  const EUR_USD = 1.1;

  const isoDate = (d) => {
    const m = d.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[1]}-${m[2]}` : d.trim();
  };
  // Rule v1: clean, convert to USD, drop rows without an amount.
  function transformV1(rows) {
    return rows.filter((r) => r.amount.trim() !== '').map((r) => {
      const amt = parseFloat(r.amount);
      const cur = r.currency.toUpperCase();
      return { order_id: r.id, order_date: isoDate(r.date), amount_usd: +(cur === 'EUR' ? amt * EUR_USD : amt).toFixed(2) };
    });
  }
  // Rule v2: finance also wants the original currency, and missing amounts kept and flagged.
  function transformV2(rows) {
    return rows.map((r) => {
      const has = r.amount.trim() !== '';
      const amt = has ? parseFloat(r.amount) : null;
      const cur = r.currency.toUpperCase();
      return {
        order_id: r.id, order_date: isoDate(r.date),
        amount_usd: has ? +(cur === 'EUR' ? amt * EUR_USD : amt).toFixed(2) : null,
        amount_local: amt, currency: cur, missing_amount: !has,
      };
    });
  }

  const RAW_COLS = [
    { key: 'id', label: 'id' }, { key: 'date', label: 'date' },
    { key: 'amount', label: 'amount', fmt: (v) => JSON.stringify(v) }, { key: 'currency', label: 'currency' },
  ];
  const V1_COLS = [
    { key: 'order_id' }, { key: 'order_date' }, { key: 'amount_usd', num: true, fmt: (v) => v.toFixed(2) },
  ];
  const V2_COLS = [
    { key: 'order_id' }, { key: 'order_date' },
    { key: 'amount_usd', num: true, fmt: (v) => (v == null ? 'NULL' : v.toFixed(2)) },
    { key: 'amount_local', num: true, fmt: (v) => (v == null ? 'NULL' : v.toFixed(2)) },
    { key: 'currency', fmt: (v) => v ?? 'NULL' },
    { key: 'missing_amount', fmt: (v) => (v == null ? 'NULL' : String(v)) },
  ];

  const CODE = {
    etl: `<span class="kw"># runs in the pipeline, before the warehouse sees anything</span>
for row in extract("orders_export.csv"):
    if not row.amount.strip():
        continue                       <span class="kw"># dropped for good</span>
    amt = float(row.amount)
    if row.currency.upper() == "EUR":
        amt *= 1.10
    load("orders", order_id=row.id,
         order_date=to_iso(row.date), amount_usd=round(amt, 2))`,
    elt: `<span class="kw">-- runs inside the warehouse, on the raw copy</span>
CREATE OR REPLACE TABLE orders AS
SELECT id AS order_id,
       CAST(parse_date(date) AS DATE) AS order_date,
       ROUND(CAST(TRIM(amount) AS DECIMAL)
             * CASE WHEN UPPER(currency) = 'EUR'
                    THEN 1.10 ELSE 1 END, 2) AS amount_usd
FROM raw_orders
WHERE TRIM(amount) &lt;&gt; '';`,
  };

  let mode = 'etl';
  let step = 0;
  let changed = false;

  function stepNames() {
    return mode === 'etl' ? ['Extract', 'Transform', 'Load'] : ['Extract', 'Load', 'Transform'];
  }

  function lane(title, sub, active, blocks) {
    return h('div.lane', { class: active ? 'active' : null },
      h('h3', title), h('p.panel-sub', sub),
      blocks.length ? blocks : h('p.lbl', 'empty'));
  }
  function block(name, cols, rows) {
    const d = h('div', { style: 'margin-bottom:.5rem' });
    table(d, cols, rows, { caption: name });
    return d;
  }

  function render() {
    const names = stepNames();
    $('p1-flow').replaceChildren(...names.flatMap((n, i) => [
      i ? h('span.arr', '→') : null,
      h('span.st', { class: i + 1 < step ? 'done' : i + 1 === step ? 'now' : null }, `${i + 1}. ${n}`),
    ]).filter(Boolean));

    const source = changed ? RAW.filter((r) => !PURGED.has(r.id)) : RAW;
    let inflight = [], wh = [], activeLane = step === 0 ? -1 : 0;
    const v1 = transformV1(RAW);
    if (mode === 'etl') {
      if (step === 1) { inflight = [block('extracted rows', RAW_COLS, RAW)]; activeLane = 1; }
      if (step === 2) { inflight = [block('cleaned rows', V1_COLS, v1)]; activeLane = 1; }
      if (step >= 3) { wh = [block('orders', V1_COLS, v1)]; activeLane = 2; }
    } else {
      if (step === 1) { inflight = [block('extracted rows', RAW_COLS, RAW)]; activeLane = 1; }
      if (step >= 2) { wh.push(block('raw_orders (untouched copy)', RAW_COLS, RAW)); activeLane = 2; }
      if (step >= 3) wh.push(block('orders', V1_COLS, v1));
    }
    $('p1-lanes').replaceChildren(
      lane('Source app', changed ? 'Keeps only recent orders' : 'orders_export.csv', activeLane === 0, [block('orders', RAW_COLS, source)]),
      lane(mode === 'etl' ? 'Pipeline server' : 'Pipeline (just moves data)', mode === 'etl' ? 'Transform happens here' : 'No business logic here', activeLane === 1, inflight),
      lane('Warehouse', mode === 'etl' ? 'Only clean data arrives' : 'Raw lands, then SQL transforms it', activeLane === 2, wh),
    );

    $('p1-code').innerHTML = CODE[mode];
    $('p1-next').textContent = step < 3 ? `Run step ${step + 1}: ${names[step]}` : 'Pipeline finished';
    $('p1-next').disabled = step >= 3;
    $('p1-change').disabled = step < 3 || changed;
    renderRebuild();
  }

  function renderRebuild() {
    const out = $('p1-rebuild');
    const msg = $('p1-rebuild-msg');
    if (!changed) {
      table(out, V2_COLS, [], { empty: 'Finish the pipeline, then change the rule.' });
      msg.className = 'msg';
      msg.textContent = 'Nothing rebuilt yet.';
      return;
    }
    let rows;
    if (mode === 'elt') {
      rows = transformV2(RAW);
      msg.className = 'msg good';
      msg.textContent = 'ELT: the raw copy is still in the warehouse, so the new SQL rebuilds all 6 orders, including A-1004, the one v1 dropped. No trip back to the source.';
    } else {
      const fresh = transformV2(RAW.filter((r) => !PURGED.has(r.id)));
      const old = transformV1(RAW).filter((r) => PURGED.has(r.order_id))
        .map((r) => Object.assign({}, r, { amount_local: null, currency: null, missing_amount: null, _lost: true }));
      rows = old.concat(fresh);
      msg.className = 'msg bad';
      msg.textContent = 'ETL: the pipeline has to re-extract, but the source already purged A-1001 to A-1003. Those rows keep their old shape with NULLs, forever. A-1004 only survives because it was still in the source.';
    }
    table(out, V2_COLS, rows, { rowClass: (r) => (r._lost ? 'bad' : r.missing_amount ? 'warn' : null) });
  }

  function init() {
    DE.seg('p1-mode', (v) => { mode = v; step = 0; changed = false; render(); });
    $('p1-next').addEventListener('click', () => { if (step < 3) { step++; render(); } });
    $('p1-change').addEventListener('click', () => { changed = true; render(); });
    $('p1-reset').addEventListener('click', () => { step = 0; changed = false; render(); });
    render();
  }
  init();
})();
