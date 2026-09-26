/* Chapter 2: batch vs streaming. Events arrive continuously; the schedule decides when they show up. */
(function () {
  'use strict';
  const { $ } = DE;

  const WINDOW = 120;        // minutes shown on the timeline
  const SIM_PER_SEC = 8;     // simulated minutes per real second
  const RATE = 1.2;          // events per simulated minute
  const JOB_COST = 1;        // cost units per scheduled job
  const STREAM_COST = 0.4;   // cost units per minute for an always-on worker
  const STREAM_DELAY = 0.05; // minutes (~3 s) from arrival to visible when streaming

  const MODES = {
    daily: { interval: 1440, label: 'Nightly batch' },
    hourly: { interval: 60, label: 'Hourly batch' },
    m15: { interval: 15, label: 'Every 15 min' },
    micro: { interval: 1, label: 'Micro-batch (1 min)' },
    stream: { interval: 0, label: 'Streaming' },
  };

  let mode = 'hourly';
  let t = 0, events = [], jobs = [], nextJob = 0, lastFrame = 0, raf = 0, playing = true, rand;
  let canvas, ctx, W = 0, H = 0;

  function reset() {
    rand = DE.rng(42);
    t = 0;
    events = [];
    jobs = [];
    const iv = MODES[mode].interval;
    nextJob = iv || Infinity;
    // Warm up so the timeline starts full (and, for the nightly job, just after a run).
    advance(iv >= 1440 ? iv + 45 : WINDOW + 30);
  }

  function advance(dt) {
    const end = t + dt;
    const iv = MODES[mode].interval;
    while (t < end) {
      const step = Math.min(0.25, end - t);
      // Poisson arrivals, with a busier stretch every couple of hours.
      const rate = RATE * (1 + 0.8 * Math.sin(t / 25));
      if (rand() < rate * step) {
        const e = { at: t + rand() * step, visible: null };
        if (!iv) e.visible = e.at + STREAM_DELAY;
        events.push(e);
      }
      t += step;
      if (iv && t >= nextJob) {
        for (const e of events) if (e.visible == null && e.at <= nextJob) e.visible = nextJob;
        jobs.push(nextJob);
        nextJob += iv;
      }
    }
    const cut = t - WINDOW * 2 - 1440;
    if (events.length > 3000) events = events.filter((e) => e.at > cut);
    if (jobs.length > 500) jobs = jobs.filter((j) => j > cut);
  }

  function resize() {
    const box = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    W = Math.max(280, box.width);
    H = W < 500 ? 190 : 220;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function draw() {
    const c = { ink: css('--ink'), ink2: css('--ink-2'), muted: css('--muted'), grid: css('--grid'), s1: css('--s1'), s2: css('--s2'), accent: css('--accent') };
    ctx.clearRect(0, 0, W, H);
    const L = 12, R = W - 12;
    const x = (tm) => L + ((tm - (t - WINDOW)) / WINDOW) * (R - L);
    const yA = H * 0.3, yV = H * 0.72;

    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = c.muted;
    ctx.fillText('Events happen', L, yA - 26);
    ctx.fillText('Visible in the warehouse', L, yV + 34);

    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1;
    for (const y of [yA, yV]) { ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke(); }

    // Job runs
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = c.accent;
    for (const j of jobs) {
      if (j < t - WINDOW) continue;
      ctx.beginPath(); ctx.moveTo(x(j), yA - 14); ctx.lineTo(x(j), yV + 14); ctx.stroke();
    }
    ctx.setLineDash([]);

    // Links and dots
    for (const e of events) {
      if (e.at < t - WINDOW) continue;
      const done = e.visible != null && e.visible <= t;
      if (done) {
        ctx.strokeStyle = c.s1 + '55';
        ctx.beginPath(); ctx.moveTo(x(e.at), yA); ctx.lineTo(x(e.visible), yV); ctx.stroke();
      }
    }
    for (const e of events) {
      if (e.at < t - WINDOW) continue;
      const done = e.visible != null && e.visible <= t;
      ctx.fillStyle = done ? c.s1 : c.s2;
      ctx.beginPath(); ctx.arc(x(e.at), yA, 3.2, 0, Math.PI * 2); ctx.fill();
      if (done) { ctx.fillStyle = c.s1; ctx.beginPath(); ctx.arc(x(e.visible), yV, 3.2, 0, Math.PI * 2); ctx.fill(); }
    }

    ctx.fillStyle = c.ink2;
    ctx.textAlign = 'right';
    ctx.fillText('now', R, H - 6);
    ctx.textAlign = 'left';
    ctx.fillStyle = c.muted;
    ctx.fillText(`${WINDOW / 60} hours ago`, L, H - 6);
  }

  function stats() {
    const iv = MODES[mode].interval;
    const recent = events.filter((e) => e.visible != null && e.visible <= t && e.visible > t - WINDOW);
    const lat = recent.reduce((s, e) => s + (e.visible - e.at), 0) / (recent.length || 1);
    const waiting = events.filter((e) => e.at <= t && (e.visible == null || e.visible > t)).length;
    const oldestWaiting = events.filter((e) => e.at <= t && (e.visible == null || e.visible > t)).reduce((m, e) => Math.max(m, t - e.at), 0);
    const fmtMin = (m) => (m < 1 ? `${Math.round(m * 60)} s` : m < 90 ? `${m.toFixed(m < 10 ? 1 : 0)} min` : `${(m / 60).toFixed(1)} h`);
    const jobsPerDay = iv ? 1440 / iv : 0;
    const costPerDay = iv ? jobsPerDay * JOB_COST : STREAM_COST * 1440;
    DE.stat('p2-lat', recent.length ? fmtMin(lat) : '–');
    DE.stat('p2-wait', String(waiting));
    DE.stat('p2-stale', fmtMin(oldestWaiting));
    DE.stat('p2-jobs', iv ? DE.int(jobsPerDay) : 'always on');
    DE.stat('p2-cost', DE.int(costPerDay), costPerDay > 300 ? 'bad-text' : costPerDay > 50 ? 'warn-text' : null);
  }

  function frame(now) {
    const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    if (playing) advance(dt * SIM_PER_SEC);
    draw();
    stats();
    raf = requestAnimationFrame(frame);
  }

  function start() { if (!raf) { lastFrame = 0; raf = requestAnimationFrame(frame); } }
  function stop() { cancelAnimationFrame(raf); raf = 0; }

  function init() {
    canvas = $('p2-canvas');
    ctx = canvas.getContext('2d');
    DE.seg('p2-mode', (v) => { mode = v; reset(); explain(); });
    $('p2-play').addEventListener('click', () => {
      playing = !playing;
      $('p2-play').textContent = playing ? 'Pause' : 'Play';
    });
    window.addEventListener('resize', () => { if (raf) resize(); });
    reset();
    explain();
    DE.onView('streaming', { enter: () => { resize(); start(); }, leave: stop });
  }

  function explain() {
    const text = {
      daily: 'One job a night. Cheapest to run and simplest to reason about, but this morning\'s dashboard shows yesterday. Most of the timeline above is waiting.',
      hourly: 'The classic scheduled batch. Each job picks up everything since the last one, so data is on average half an interval old when it lands.',
      m15: 'Four times the jobs of hourly for a quarter of the delay. Still simple: each run is an ordinary batch job.',
      micro: 'Tiny batches every minute. Fresh, but starting a job 1,440 times a day is expensive unless something keeps the worker warm between runs, which is how Spark Structured Streaming does it.',
      stream: 'A worker is always running and handles each event as it arrives, in seconds. You pay for it around the clock, and it has to cope with restarts, ordering and duplicates on its own.',
    };
    $('p2-explain').textContent = text[mode];
  }

  init();
})();
