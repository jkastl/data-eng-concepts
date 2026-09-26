/* Chapter 7: storage layout. Row vs columnar files and partition pruning, shown as the cells a query reads. */
(function () {
  'use strict';
  const { $, h } = DE;

  const COLS = ['order_id', 'order_date', 'region', 'customer', 'product', 'amount'];
  const COLORS = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6'];
  const DATES = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'];
  const REGIONS = ['North', 'South', 'West'];
  const FILTERS = {
    none: null,
    date: { col: 'order_date', val: '2026-09-03', sql: "order_date = '2026-09-03'" },
    region: { col: 'region', val: 'West', sql: "region = 'West'" },
  };

  // 24 orders: 4 days x 3 regions x 2, with 12 customers.
  const ROWS = [];
  (function () {
    const r = DE.rng(11);
    let n = 1;
    for (const d of DATES) for (const g of REGIONS) for (let k = 0; k < 2; k++) {
      ROWS.push({ order_id: 1000 + n, order_date: d, region: g, customer: `c${String(1 + Math.floor(r() * 12)).padStart(2, '0')}`, product: `p${1 + Math.floor(r() * 5)}`, amount: 5 + Math.round(r() * 95) });
      n++;
    }
  })();

  let layout = 'row', part = 'none', filter = 'none';
  const selected = new Set(['amount']);

  function files() {
    if (part === 'none') return [{ name: layout === 'row' ? 'orders.csv' : 'orders.parquet', key: null, rows: ROWS }];
    const groups = new Map();
    for (const r of ROWS) {
      if (!groups.has(r[part])) groups.set(r[part], []);
      groups.get(r[part]).push(r);
    }
    return [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, rows]) => ({
      name: `${part}=${k}/part-0.${layout === 'row' ? 'csv' : 'parquet'}`, key: k, rows,
    }));
  }

  function render() {
    const f = FILTERS[filter];
    const stored = COLS.filter((c) => c !== part);   // partition column lives in the folder name
    const need = new Set([...selected, ...(f && f.col !== part ? [f.col] : [])]);
    const list = files();
    let cellsRead = 0, filesOpened = 0, totalCells = 0, rowsMatched = 0;

    const blocks = list.map((file) => {
      const skipped = f && f.col === part && file.key !== f.val;
      if (!skipped) filesOpened++;
      const nR = file.rows.length, nC = stored.length;
      totalCells += nR * nC;
      if (!skipped) rowsMatched += file.rows.filter((r) => !f || r[f.col] === f.val).length;
      const cells = [];
      // Draw in on-disk order: row files are row after row, columnar files are column after column.
      if (layout === 'row') {
        for (let i = 0; i < nR; i++) for (const c of stored) cells.push({ c, read: !skipped });
      } else {
        for (const c of stored) for (let i = 0; i < nR; i++) cells.push({ c, read: !skipped && need.has(c) });
      }
      cellsRead += cells.filter((x) => x.read).length;
      const perLine = layout === 'row' ? nC : nR;
      return h('div.file', { class: skipped ? 'skipped' : null, title: skipped ? 'Pruned: never opened' : null },
        h('div.fname', file.name),
        h('div.cells', { style: `grid-template-columns: repeat(${perLine}, 11px)` },
          cells.map((x) => h('i.cell', { class: x.read ? 'read' : null, style: `background: var(${COLORS[COLS.indexOf(x.c)]})` }))));
    });
    $('p7-files').replaceChildren(...blocks);

    $('p7-legend').replaceChildren(...COLS.map((c, i) => h('span', h('i.sw', { style: `background: var(${COLORS[i]})` }), c + (c === part ? ' (in folder name)' : ''))));
    $('p7-sql').textContent = `SELECT ${[...selected].join(', ') || '…'}\nFROM orders${f ? `\nWHERE ${f.sql}` : ''};`;

    DE.stat('p7-files-n', `${filesOpened} / ${list.length}`);
    DE.stat('p7-cells', `${cellsRead} / ${totalCells}`);
    const frac = cellsRead / totalCells;
    DE.stat('p7-frac', DE.pct(frac), frac <= 0.2 ? 'good-text' : frac >= 0.9 ? 'bad-text' : null);
    DE.stat('p7-rows', String(rowsMatched));
    // A crude cost model: bytes scanned plus a fixed price for opening each file.
    const cost = cellsRead + filesOpened * 12;
    DE.stat('p7-cost', DE.int(cost));
    $('p7-small').hidden = part !== 'customer';
  }

  function init() {
    DE.seg('p7-layout', (v) => { layout = v; render(); });
    DE.seg('p7-part', (v) => { part = v; render(); });
    DE.seg('p7-filter', (v) => { filter = v; render(); });
    $('p7-cols').replaceChildren(...COLS.map((c, i) => h('label.check',
      h('input', { type: 'checkbox', checked: selected.has(c), onchange: (e) => { e.target.checked ? selected.add(c) : selected.delete(c); render(); } }),
      h('i.sw', { style: `background: var(${COLORS[i]})` }), c)));
    render();
  }
  init();
})();
