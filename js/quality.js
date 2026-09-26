/* Chapter 8: data quality. Turn tests on and off, choose what a failure does, and watch the dashboard. */
(function () {
  'use strict';
  const { $, h, table, tag } = DE;

  const TODAY = '2026-09-26';
  const PRODUCTS = new Set(['P-1', 'P-2', 'P-3', 'P-4']);
  const COUNTRIES = new Set(['US', 'CA', 'MX', 'GB', 'DE']);
  const BATCH = [
    { order_id: 'Q-01', email: 'ana@example.com', country: 'US', product_id: 'P-1', amount: 42, order_date: '2026-09-26' },
    { order_id: 'Q-02', email: 'ben@example.com', country: 'CA', product_id: 'P-2', amount: 18, order_date: '2026-09-26' },
    { order_id: 'Q-03', email: null, country: 'US', product_id: 'P-3', amount: 25, order_date: '2026-09-25' },
    { order_id: 'Q-04', email: 'dee@example.com', country: 'GB', product_id: 'P-1', amount: 60, order_date: '2026-09-26' },
    { order_id: 'Q-05', email: 'eli@example.com', country: 'US', product_id: 'P-4', amount: -20, order_date: '2026-09-26' },
    { order_id: 'Q-06', email: 'fay@example.com', country: 'DE', product_id: 'P-2', amount: 33, order_date: '2026-09-25' },
    { order_id: 'Q-02', email: 'ben@example.com', country: 'CA', product_id: 'P-2', amount: 18, order_date: '2026-09-26' },
    { order_id: 'Q-08', email: 'hal@example.com', country: 'US', product_id: 'P-3', amount: 27, order_date: '2026-09-26' },
    { order_id: 'Q-09', email: 'ivy@example.com', country: 'XX', product_id: 'P-1', amount: 51, order_date: '2026-09-26' },
    { order_id: 'Q-10', email: 'jo@example.com', country: 'MX', product_id: 'P-999', amount: 14, order_date: '2026-09-26' },
    { order_id: 'Q-11', email: 'kai@example.com', country: 'US', product_id: 'P-4', amount: 38, order_date: '2027-01-15' },
    { order_id: 'Q-12', email: 'lu@example.com', country: 'CA', product_id: 'P-3', amount: 22, order_date: '2026-09-26' },
  ];

  const CHECKS = [
    { id: 'not_null', label: 'email is not null', test: (r) => r.email != null },
    { id: 'unique', label: 'order_id is unique', test: (r, i, rows) => rows.findIndex((x) => x.order_id === r.order_id) === i },
    { id: 'range', label: 'amount ≥ 0', test: (r) => r.amount == null || r.amount >= 0 },
    { id: 'accepted', label: 'country in accepted list', test: (r) => COUNTRIES.has(r.country) },
    { id: 'fk', label: 'product_id exists in products', test: (r) => PRODUCTS.has(r.product_id) },
    { id: 'future', label: 'order_date not in the future', test: (r) => r.order_date <= TODAY },
  ];

  const on = new Set(CHECKS.map((c) => c.id));
  let contract = true, schemaDrift = false, policy = 'quarantine';

  function render() {
    // Upstream renamed amount -> amount_usd: our code reads `amount`, which is now missing.
    const rows = BATCH.map((r) => (schemaDrift ? Object.assign({}, r, { amount: null, amount_usd: r.amount }) : r));
    const active = CHECKS.filter((c) => on.has(c.id));
    const results = rows.map((r, i) => ({ r, fails: active.filter((c) => !c.test(r, i, rows)).map((c) => c.id) }));
    const failing = results.filter((x) => x.fails.length).length;

    let status, loaded, cls;
    if (schemaDrift && contract) {
      status = 'Batch rejected: schema contract broken (column amount missing, unexpected amount_usd)';
      cls = 'bad'; loaded = [];
    } else if (policy === 'fail' && failing) {
      status = `Pipeline stopped: ${failing} row${failing > 1 ? 's' : ''} failed tests. Yesterday's data stays on the dashboard.`;
      cls = 'bad'; loaded = [];
    } else if (policy === 'quarantine') {
      loaded = results.filter((x) => !x.fails.length);
      status = failing ? `Loaded ${loaded.length} rows; ${failing} held in quarantine for review.` : `Loaded all ${loaded.length} rows.`;
      cls = failing ? 'warn' : 'good';
    } else {
      loaded = results;
      status = failing ? `Loaded all ${loaded.length} rows with ${failing} warning${failing > 1 ? 's' : ''} that nobody reads.` : `Loaded all ${loaded.length} rows.`;
      cls = failing ? 'warn' : 'good';
    }
    if (schemaDrift && !contract && cls !== 'bad') {
      status += ' Every amount is NULL, so revenue silently reads $0.';
      cls = 'bad';
    }
    const loadedSet = new Set(loaded);

    table('p8-batch', [
      { key: 'order_id' }, { key: 'email', fmt: (v) => v ?? 'NULL', cls: (r) => (r.email == null ? 'bad-cell' : '') },
      { key: 'country' }, { key: 'product_id' },
      { key: schemaDrift ? 'amount_usd' : 'amount', num: true, fmt: (v) => (v == null ? 'NULL' : v) },
      { key: 'order_date' },
      { key: '_r', label: 'result', fmt: (_, r) => {
        const x = results.find((y) => y.r === r);
        return h('span', x.fails.length ? x.fails.map((f) => tag(f, 'bad')) : tag('pass', 'good'), loadedSet.has(x) ? '' : tag('not loaded'));
      } },
    ], rows, { rowClass: (r) => {
      const x = results.find((y) => y.r === r);
      return !loadedSet.has(x) ? (x.fails.length ? 'bad' : 'dim') : x.fails.length ? 'warn' : null;
    } });

    const rev = loaded.reduce((s, x) => s + (x.r.amount || 0), 0);
    const truth = BATCH.filter((r, i) => CHECKS.every((c) => c.test(r, i, BATCH))).reduce((s, r) => s + r.amount, 0);
    const msg = $('p8-status');
    msg.className = `msg ${cls}`;
    msg.textContent = status;
    DE.stat('p8-loaded', String(loaded.length));
    DE.stat('p8-failing', String(failing), failing ? 'bad-text' : 'good-text');
    DE.stat('p8-rev', DE.money(rev), Math.abs(rev - truth) < 0.005 ? 'good-text' : 'bad-text');
    $('p8-truth').textContent = `clean rows: ${DE.money(truth)}`;
  }

  function init() {
    $('p8-checks').replaceChildren(...CHECKS.map((c) => h('label.check',
      h('input', { type: 'checkbox', checked: true, onchange: (e) => { e.target.checked ? on.add(c.id) : on.delete(c.id); render(); } }),
      h('span', h('code', c.id), ' ', c.label))));
    DE.seg('p8-policy', (v) => { policy = v; render(); });
    $('p8-contract').addEventListener('change', (e) => { contract = e.target.checked; render(); });
    $('p8-drift').addEventListener('change', (e) => { schemaDrift = e.target.checked; render(); });
    render();
  }
  init();
})();
