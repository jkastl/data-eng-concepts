/* Chapter 4: incremental loads. A watermark on updated_at is cheap, but misses late commits and deletes. */
(function () {
  'use strict';
  const { $, h, table, tag } = DE;

  // Times are minutes after 10:00. Each change has the updated_at the app stamped on it and the
  // moment its transaction committed (when a query can first see it).
  const CHANGES = [
    { id: 1, op: 'insert', total: 20, u: 1, c: 1 },
    { id: 2, op: 'insert', total: 35, u: 2, c: 2 },
    { id: 3, op: 'insert', total: 12, u: 3, c: 3 },
    { id: 4, op: 'insert', total: 48, u: 4, c: 4 },
    { id: 2, op: 'update', total: 38, u: 7, c: 7 },
    { id: 6, op: 'insert', total: 22, u: 8, c: 8 },
    { id: 5, op: 'insert', total: 90, u: 6, c: 11, late: true },
    { id: 7, op: 'insert', total: 15, u: 12, c: 12 },
    { id: 3, op: 'delete', u: 13, c: 13 },
    { id: 4, op: 'update', total: 44, u: 17, c: 17 },
    { id: 8, op: 'insert', total: 64, u: 18, c: 18 },
  ];
  const SYNCS = [5, 10, 15, 20];

  const clock = (m) => `10:${String(m).padStart(2, '0')}`;

  let strategy = 'incremental', lookback = 0, softDeletes = false;
  let syncIdx, target, watermark, readTotal, lastRead, log;

  // The source table as visible at time `now`.
  function sourceAt(now) {
    const rows = new Map();
    for (const ch of CHANGES) {
      if (ch.c > now) continue;
      if (ch.op === 'delete') {
        if (softDeletes) {
          const r = rows.get(ch.id);
          if (r) rows.set(ch.id, Object.assign({}, r, { deleted: true, u: ch.u }));
        } else rows.delete(ch.id);
      } else {
        rows.set(ch.id, { id: ch.id, total: ch.total, u: ch.u, deleted: false });
      }
    }
    return [...rows.values()].sort((a, b) => a.id - b.id);
  }

  function reset() {
    syncIdx = -1;
    target = new Map();
    watermark = null;
    readTotal = 0;
    lastRead = 0;
    log = [];
  }

  function sync() {
    if (syncIdx >= SYNCS.length - 1) return;
    syncIdx++;
    const now = SYNCS[syncIdx];
    const src = sourceAt(now);
    let read, query;
    if (strategy === 'full') {
      read = src;
      target = new Map(src.filter((r) => !r.deleted).map((r) => [r.id, Object.assign({}, r)]));
      query = 'SELECT * FROM orders';
    } else {
      const from = watermark == null ? null : watermark - lookback;
      read = src.filter((r) => from == null || r.u > from);
      for (const r of read) {
        if (r.deleted) target.delete(r.id);
        else target.set(r.id, Object.assign({}, r));
      }
      query = from == null ? 'SELECT * FROM orders  -- first run' : `SELECT * FROM orders WHERE updated_at > '${clock(from)}'`;
      if (read.length) watermark = Math.max(watermark ?? -Infinity, ...read.map((r) => r.u));
    }
    lastRead = read.length;
    readTotal += read.length;
    log.unshift({ at: now, query, n: read.length });
    render();
  }

  function render() {
    const now = syncIdx < 0 ? 0 : SYNCS[syncIdx];
    const src = sourceAt(now);
    const live = new Map(src.filter((r) => !r.deleted).map((r) => [r.id, r]));

    table('p4-source', [
      { key: 'id' }, { key: 'total', num: true, fmt: DE.money },
      { key: 'u', label: 'updated_at', fmt: clock },
      { key: '_n', label: '', fmt: (_, r) => {
        const late = CHANGES.find((c) => c.id === r.id && c.late);
        return r.deleted ? tag('is_deleted', 'warn') : late ? tag(`committed ${clock(late.c)}`, 'warn') : '';
      } },
    ], src, { empty: 'Nothing yet: run the first sync.', rowClass: (r) => (r.deleted ? 'dim' : null) });

    // Compare target with the live source, row by row.
    const ids = [...new Set([...live.keys(), ...target.keys()])].sort((a, b) => a - b);
    const cmp = ids.map((id) => {
      const s = live.get(id), t = target.get(id);
      const status = !t ? 'missing' : !s ? 'ghost' : s.total !== t.total ? 'stale' : 'ok';
      return { id, total: t ? t.total : null, u: t ? t.u : null, status };
    });
    table('p4-target', [
      { key: 'id' }, { key: 'total', num: true, fmt: (v) => (v == null ? '—' : DE.money(v)) },
      { key: 'u', label: 'updated_at', fmt: (v) => (v == null ? '—' : clock(v)) },
      { key: 'status', label: '', fmt: (v) => ({
        ok: tag('matches', 'good'), missing: tag('missing', 'bad'),
        stale: tag('stale value', 'warn'), ghost: tag('deleted upstream', 'bad'),
      })[v] },
    ], cmp, {
      empty: 'Empty until the first sync.',
      rowClass: (r) => (r.status === 'ok' ? null : r.status === 'stale' ? 'warn' : 'bad'),
    });

    const wrong = cmp.filter((r) => r.status !== 'ok').length;
    DE.stat('p4-clock', syncIdx < 0 ? '10:00' : clock(now));
    DE.stat('p4-wm', strategy === 'full' ? 'n/a' : watermark == null ? '—' : clock(watermark));
    DE.stat('p4-read', `${lastRead} / ${readTotal}`);
    DE.stat('p4-wrong', syncIdx < 0 ? '–' : String(wrong), syncIdx < 0 ? null : wrong ? 'bad-text' : 'good-text');

    $('p4-log').replaceChildren(...(log.length ? log.map((l) =>
      h('li', h('b', clock(l.at)), ' ', h('code', l.query), ` → ${l.n} row${l.n === 1 ? '' : 's'}`))
      : [h('li.lbl', 'No syncs yet')]));

    const next = SYNCS[syncIdx + 1];
    $('p4-sync').textContent = next != null ? `Run sync at ${clock(next)}` : 'Day over';
    $('p4-sync').disabled = next == null;
    $('p4-lookback-wrap').hidden = strategy !== 'incremental';
  }

  function init() {
    const restart = () => { reset(); render(); };
    DE.seg('p4-strategy', (v) => { strategy = v; restart(); });
    DE.range('p4-lookback', (v) => `${v} min`, (v) => { lookback = v; restart(); });
    $('p4-soft').addEventListener('change', (e) => { softDeletes = e.target.checked; restart(); });
    $('p4-sync').addEventListener('click', sync);
    $('p4-reset').addEventListener('click', restart);
    restart();
  }
  init();
})();
