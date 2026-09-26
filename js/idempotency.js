/* Chapter 3: idempotent loads. Run the same daily load again, crash it halfway, and compare strategies. */
(function () {
  'use strict';
  const { $, h, table, tag } = DE;

  const DAY = '2026-09-26';
  const BASE_FILE = [
    { order_id: 'O-201', amount: 40 },
    { order_id: 'O-202', amount: 25 },
    { order_id: 'O-203', amount: 60 },
    { order_id: 'O-204', amount: 15 },
    { order_id: 'O-205', amount: 35 },
  ];
  const YESTERDAY = [
    { order_id: 'O-198', order_date: '2026-09-25', amount: 30, run: 0 },
    { order_id: 'O-199', order_date: '2026-09-25', amount: 55, run: 0 },
  ];

  const SQL = {
    append: `INSERT INTO sales
SELECT order_id, '${DAY}', amount
FROM daily_file;`,
    overwrite: `BEGIN;
DELETE FROM sales WHERE order_date = '${DAY}';
INSERT INTO sales
SELECT order_id, '${DAY}', amount FROM daily_file;
COMMIT;  <span class="kw">-- all or nothing</span>`,
    merge: `MERGE INTO sales t
USING daily_file s ON t.order_id = s.order_id
WHEN MATCHED THEN
  UPDATE SET amount = s.amount
WHEN NOT MATCHED THEN
  INSERT VALUES (s.order_id, '${DAY}', s.amount);`,
  };

  let strategy = 'append';
  let file, rows, runs, log;

  function reset() {
    file = BASE_FILE.map((r) => Object.assign({}, r));
    rows = YESTERDAY.map((r) => Object.assign({}, r));
    runs = 0;
    log = [];
  }

  // Load the file; if crashAfter is set, the job dies after writing that many rows.
  function load(crashAfter) {
    runs++;
    const n = crashAfter ?? file.length;
    const crashed = crashAfter != null;
    const incoming = file.slice(0, n).map((r) => ({ order_id: r.order_id, order_date: DAY, amount: r.amount, run: runs }));
    let note;
    if (strategy === 'append') {
      rows.push(...incoming);
      note = crashed ? `appended ${n} rows, then crashed` : `appended ${n} rows`;
    } else if (strategy === 'overwrite') {
      if (crashed) {
        note = 'crashed mid-transaction: rolled back, table unchanged';
      } else {
        const before = rows.filter((r) => r.order_date === DAY).length;
        rows = rows.filter((r) => r.order_date !== DAY).concat(incoming);
        note = `replaced ${before} rows for ${DAY} with ${n}`;
      }
    } else {
      let ins = 0, upd = 0;
      for (const r of incoming) {
        const hit = rows.find((x) => x.order_id === r.order_id);
        if (hit) { hit.amount = r.amount; hit.run = r.run; upd++; } else { rows.push(r); ins++; }
      }
      note = `inserted ${ins}, updated ${upd}` + (crashed ? ', then crashed' : '');
    }
    log.unshift({ run: runs, what: crashed ? 'crash' : 'ok', note });
    render();
  }

  function render() {
    const counts = {};
    rows.forEach((r) => (counts[r.order_id] = (counts[r.order_id] || 0) + 1));
    const truthToday = file.reduce((s, r) => s + r.amount, 0);
    const truth = truthToday + YESTERDAY.reduce((s, r) => s + r.amount, 0);
    const total = rows.reduce((s, r) => s + r.amount, 0);
    const fileAmt = Object.fromEntries(file.map((r) => [r.order_id, r.amount]));

    table('p3-file', [
      { key: 'order_id' }, { key: 'amount', num: true, fmt: DE.money },
    ], file, { rowClass: (r) => (r.corrected ? 'new' : null) });

    table('p3-table', [
      { key: 'order_id' }, { key: 'order_date' },
      { key: 'amount', num: true, fmt: DE.money },
      { key: 'run', label: 'loaded by', fmt: (v) => (v ? `run ${v}` : 'earlier') },
      { key: '_s', label: '', fmt: (_, r) => (counts[r.order_id] > 1 ? tag('duplicate', 'bad')
        : r.order_date === DAY && fileAmt[r.order_id] !== r.amount ? tag('stale', 'warn') : '') },
    ], rows, {
      rowClass: (r) => (counts[r.order_id] > 1 ? 'bad' : r.order_date === DAY && fileAmt[r.order_id] !== r.amount ? 'warn' : null),
    });

    const dupes = rows.length - Object.keys(counts).length;
    const missing = file.filter((r) => !counts[r.order_id]).length;
    DE.stat('p3-rows', String(rows.length));
    DE.stat('p3-dupes', String(dupes), dupes ? 'bad-text' : 'good-text');
    DE.stat('p3-missing', String(missing), missing ? 'bad-text' : 'good-text');
    DE.stat('p3-rev', DE.money(total), Math.abs(total - truth) < 0.005 ? 'good-text' : 'bad-text');
    $('p3-truth').textContent = `should be ${DE.money(truth)}`;

    $('p3-sql').innerHTML = SQL[strategy];
    $('p3-log').replaceChildren(...(log.length ? log.slice(0, 6).map((l) =>
      h('li', tag(`run ${l.run}`, l.what === 'crash' ? 'bad' : 'good'), ' ', l.note)) : [h('li.lbl', 'No runs yet')]));
  }

  function init() {
    DE.seg('p3-strategy', (v) => { strategy = v; reset(); render(); });
    $('p3-run').addEventListener('click', () => load(null));
    $('p3-crash').addEventListener('click', () => load(3));
    $('p3-correct').addEventListener('click', () => {
      const r = file.find((x) => x.order_id === 'O-202');
      r.amount = r.amount === 25 ? 52 : 25;
      r.corrected = r.amount !== 25;
      render();
    });
    $('p3-reset').addEventListener('click', () => { reset(); render(); });
    reset();
    render();
  }
  init();
})();
