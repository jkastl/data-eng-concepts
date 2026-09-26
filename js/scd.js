/* Chapter 6: slowly changing dimensions. Move a customer and see what each SCD type does to history. */
(function () {
  'use strict';
  const { $, h, table, tag } = DE;

  const CUSTOMERS = [
    { id: 'C1', name: 'Ana', city: 'Denver' },
    { id: 'C2', name: 'Ben', city: 'Austin' },
    { id: 'C3', name: 'Cy', city: 'Boston' },
  ];
  const CITIES = ['Denver', 'Austin', 'Boston', 'Seattle', 'Chicago'];
  const START = [
    { kind: 'sale', month: '2026-01', cust: 'C1', amount: 120 },
    { kind: 'sale', month: '2026-01', cust: 'C2', amount: 80 },
    { kind: 'sale', month: '2026-01', cust: 'C3', amount: 60 },
    { kind: 'sale', month: '2026-02', cust: 'C1', amount: 90 },
    { kind: 'sale', month: '2026-02', cust: 'C3', amount: 40 },
    { kind: 'sale', month: '2026-03', cust: 'C2', amount: 150 },
    { kind: 'sale', month: '2026-03', cust: 'C1', amount: 30 },
  ];

  let type = '2', events, month, amountRand;

  const nextMonth = (m) => {
    let [y, mo] = m.split('-').map(Number);
    mo++; if (mo > 12) { mo = 1; y++; }
    return `${y}-${String(mo).padStart(2, '0')}`;
  };

  function reset() {
    events = START.map((e) => Object.assign({}, e));
    month = '2026-04';
    amountRand = DE.rng(7);
  }

  // Replay the event log into a dimension and a fact table under the chosen SCD type.
  function build() {
    const dim = [], facts = [], truth = {};
    const current = {};          // customer id -> current dim row
    const city = {};             // customer id -> real current city
    let sk = 0;
    for (const c of CUSTOMERS) {
      city[c.id] = c.city;
      const row = type === '2'
        ? { sk: ++sk, id: c.id, name: c.name, city: c.city, valid_from: '2026-01', valid_to: null, is_current: true }
        : type === '3'
          ? { sk: ++sk, id: c.id, name: c.name, city: c.city, previous_city: null }
          : { sk: ++sk, id: c.id, name: c.name, city: c.city };
      dim.push(row);
      current[c.id] = row;
    }
    for (const e of events) {
      if (e.kind === 'sale') {
        facts.push({ month: e.month, customer_sk: current[e.cust].sk, amount: e.amount });
        truth[city[e.cust]] = (truth[city[e.cust]] || 0) + e.amount;
      } else {
        const old = current[e.cust];
        city[e.cust] = e.city;
        if (type === '1') old.city = e.city;
        else if (type === '3') { old.previous_city = old.city; old.city = e.city; }
        else {
          old.valid_to = e.month;
          old.is_current = false;
          const row = { sk: ++sk, id: e.cust, name: old.name, city: e.city, valid_from: e.month, valid_to: null, is_current: true, fresh: true };
          dim.push(row);
          current[e.cust] = row;
        }
        old.changed = true;
      }
    }
    const bySk = Object.fromEntries(dim.map((d) => [d.sk, d]));
    const report = {};
    for (const f of facts) {
      const c = bySk[f.customer_sk].city;
      report[c] = (report[c] || 0) + f.amount;
    }
    return { dim, facts, bySk, report, truth };
  }

  const DIM_COLS = {
    '1': [{ key: 'sk', label: 'customer_sk' }, { key: 'id', label: 'customer_id' }, { key: 'name' }, { key: 'city' }],
    '2': [{ key: 'sk', label: 'customer_sk' }, { key: 'id', label: 'customer_id' }, { key: 'name' }, { key: 'city' },
      { key: 'valid_from' }, { key: 'valid_to', fmt: (v) => v ?? 'NULL' }, { key: 'is_current', fmt: String }],
    '3': [{ key: 'sk', label: 'customer_sk' }, { key: 'id', label: 'customer_id' }, { key: 'name' }, { key: 'city' },
      { key: 'previous_city', fmt: (v) => v ?? 'NULL' }],
  };
  const SQL = {
    '1': `UPDATE dim_customer
SET city = :new_city
WHERE customer_id = :id;`,
    '2': `UPDATE dim_customer
SET valid_to = :today, is_current = FALSE
WHERE customer_id = :id AND is_current;

INSERT INTO dim_customer
  (customer_sk, customer_id, name, city,
   valid_from, valid_to, is_current)
VALUES (:next_sk, :id, :name, :new_city,
        :today, NULL, TRUE);`,
    '3': `UPDATE dim_customer
SET previous_city = city,
    city = :new_city
WHERE customer_id = :id;`,
  };

  function render() {
    const b = build();
    table('p6-dim', DIM_COLS[type], b.dim, { rowClass: (r) => (r.fresh ? 'new' : r.changed ? (type === '2' ? 'dim' : 'warn') : null) });
    table('p6-facts', [
      { key: 'month' }, { key: 'customer_sk', label: 'customer_sk' },
      { key: '_c', label: '(city via join)', fmt: (_, r) => b.bySk[r.customer_sk].city },
      { key: 'amount', num: true, fmt: DE.money },
    ], b.facts.slice().reverse());

    const cities = CITIES.filter((c) => b.report[c] || b.truth[c]);
    const rows = cities.map((c) => ({ city: c, report: b.report[c] || 0, truth: b.truth[c] || 0 }));
    table('p6-report', [
      { key: 'city' },
      { key: 'report', label: 'Report says', num: true, fmt: DE.money },
      { key: 'truth', label: 'Where sales happened', num: true, fmt: DE.money },
      { key: '_s', label: '', fmt: (_, r) => (Math.abs(r.report - r.truth) < 0.005 ? tag('correct', 'good') : tag('rewritten', 'bad')) },
    ], rows, { rowClass: (r) => (Math.abs(r.report - r.truth) < 0.005 ? null : 'bad') });

    const wrong = rows.some((r) => Math.abs(r.report - r.truth) >= 0.005);
    const moved = events.some((e) => e.kind === 'move');
    const msg = $('p6-msg');
    if (!moved) { msg.className = 'msg'; msg.textContent = 'Nobody has moved yet, so every type agrees. Move someone.'; }
    else if (wrong) {
      msg.className = 'msg bad';
      msg.textContent = type === '3'
        ? 'Type 3 keeps the previous city as a column, but facts still join to the current one, and only one move is remembered.'
        : 'Type 1 overwrote the city, so every past sale followed the customer to their new city. History was quietly rewritten.';
    } else { msg.className = 'msg good'; msg.textContent = 'Type 2 kept the old row and added a new one. Old sales still point at the old version, so history holds.'; }

    $('p6-sql').textContent = SQL[type];
    $('p6-month').textContent = month;
  }

  function init() {
    const cust = $('p6-cust'), city = $('p6-city');
    cust.replaceChildren(...CUSTOMERS.map((c) => h('option', { value: c.id }, c.name)));
    city.replaceChildren(...CITIES.map((c) => h('option', { value: c }, c)));
    city.value = 'Seattle';
    DE.seg('p6-type', (v) => { type = v; render(); });
    $('p6-move').addEventListener('click', () => {
      const moves = events.filter((e) => e.kind === 'move' && e.cust === cust.value);
      const now = moves.length ? moves[moves.length - 1].city : CUSTOMERS.find((c) => c.id === cust.value).city;
      if (now === city.value) return;
      events.push({ kind: 'move', month, cust: cust.value, city: city.value });
      month = nextMonth(month);
      render();
    });
    $('p6-sale').addEventListener('click', () => {
      events.push({ kind: 'sale', month, cust: cust.value, amount: 20 + Math.round(amountRand() * 16) * 5 });
      month = nextMonth(month);
      render();
    });
    $('p6-reset').addEventListener('click', () => { reset(); render(); });
    reset();
    render();
  }
  init();
})();
