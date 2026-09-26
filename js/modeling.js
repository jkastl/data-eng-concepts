/* Chapter 5: normalized (3NF) vs star schema. Pick a question, see which tables each design touches. */
(function () {
  'use strict';
  const { $, svg } = DE;

  const LINE = 16, HEAD = 24, BOXW = 150;

  const MODELS = {
    norm: {
      w: 540, h: 360,
      tables: {
        regions: { x: 10, y: 10, cols: ['region_id', 'name'] },
        cities: { x: 10, y: 110, cols: ['city_id', 'name', 'region_id'] },
        customers: { x: 10, y: 230, cols: ['customer_id', 'name', 'segment', 'city_id'] },
        orders: { x: 195, y: 120, cols: ['order_id', 'customer_id', 'ordered_at'] },
        order_items: { x: 195, y: 250, cols: ['order_id', 'product_id', 'qty', 'unit_price'] },
        categories: { x: 380, y: 10, cols: ['category_id', 'name'] },
        products: { x: 380, y: 120, cols: ['product_id', 'name', 'category_id'] },
      },
      edges: [['regions', 'cities'], ['cities', 'customers'], ['customers', 'orders'], ['orders', 'order_items'], ['order_items', 'products'], ['products', 'categories']],
    },
    star: {
      w: 540, h: 360,
      tables: {
        dim_date: { x: 10, y: 20, cols: ['date_key', 'date', 'month', 'is_weekend', 'year'] },
        dim_customer: { x: 10, y: 220, cols: ['customer_key', 'name', 'segment', 'city', 'region'] },
        fact_sales: { x: 195, y: 120, cols: ['date_key', 'customer_key', 'product_key', 'qty', 'revenue'], fact: true },
        dim_product: { x: 380, y: 120, cols: ['product_key', 'name', 'category', 'brand'] },
      },
      edges: [['dim_date', 'fact_sales'], ['dim_customer', 'fact_sales'], ['dim_product', 'fact_sales']],
    },
  };

  const QUESTIONS = {
    region: {
      norm: { tables: ['order_items', 'orders', 'customers', 'cities', 'regions'], sql:
`SELECT r.name AS region,
       DATE_TRUNC('month', o.ordered_at) AS month,
       SUM(oi.qty * oi.unit_price) AS revenue
FROM order_items oi
JOIN orders o     ON o.order_id = oi.order_id
JOIN customers c  ON c.customer_id = o.customer_id
JOIN cities ci    ON ci.city_id = c.city_id
JOIN regions r    ON r.region_id = ci.region_id
GROUP BY 1, 2;` },
      star: { tables: ['fact_sales', 'dim_customer', 'dim_date'], sql:
`SELECT c.region, d.month,
       SUM(f.revenue) AS revenue
FROM fact_sales f
JOIN dim_customer c USING (customer_key)
JOIN dim_date d     USING (date_key)
GROUP BY 1, 2;` },
      note: 'Analysts ask this every week. The star schema already did the region lookup once, when the dimension was built.',
    },
    category: {
      norm: { tables: ['order_items', 'products', 'categories'], sql:
`SELECT cat.name AS category, SUM(oi.qty) AS units
FROM order_items oi
JOIN products p     ON p.product_id = oi.product_id
JOIN categories cat ON cat.category_id = p.category_id
GROUP BY 1
ORDER BY units DESC
LIMIT 5;` },
      star: { tables: ['fact_sales', 'dim_product'], sql:
`SELECT p.category, SUM(f.qty) AS units
FROM fact_sales f
JOIN dim_product p USING (product_key)
GROUP BY 1
ORDER BY units DESC
LIMIT 5;` },
      note: 'Closer. Short chains of joins are fine either way; the gap grows with every hop.',
    },
    weekend: {
      norm: { tables: ['order_items', 'orders', 'customers'], sql:
`SELECT c.segment,
       EXTRACT(DOW FROM o.ordered_at) IN (0, 6) AS weekend,
       SUM(oi.qty * oi.unit_price) AS revenue
FROM order_items oi
JOIN orders o    ON o.order_id = oi.order_id
JOIN customers c ON c.customer_id = o.customer_id
GROUP BY 1, 2;` },
      star: { tables: ['fact_sales', 'dim_customer', 'dim_date'], sql:
`SELECT c.segment, d.is_weekend,
       SUM(f.revenue) AS revenue
FROM fact_sales f
JOIN dim_customer c USING (customer_key)
JOIN dim_date d     USING (date_key)
GROUP BY 1, 2;` },
      note: 'Same number of joins, but the star answer uses a ready-made is_weekend flag. A date dimension holds holidays, fiscal periods and anything else everyone keeps recomputing.',
    },
    rename: {
      norm: { tables: ['categories'], rows: 1, sql:
`UPDATE categories
SET name = 'Home & Kitchen'
WHERE name = 'Kitchen';
<span class="kw">-- 1 row</span>` },
      star: { tables: ['dim_product'], rows: 340, sql:
`UPDATE dim_product
SET category = 'Home & Kitchen'
WHERE category = 'Kitchen';
<span class="kw">-- 340 rows: every Kitchen product</span>` },
      note: 'Now the tables turn. Normalized data stores each fact once, so writes are small and can\'t contradict each other. That is why apps (OLTP) use it, and why warehouses rebuild dimensions in batch instead of editing them by hand.',
    },
  };

  function box(name, t, hit) {
    const hgt = HEAD + t.cols.length * LINE + 6;
    return svg('g', { class: `tbox${t.fact ? ' fact' : ''}${hit ? ' hit' : ''}` },
      svg('rect', { x: t.x, y: t.y, width: BOXW, height: hgt, rx: 6 }),
      svg('text', { x: t.x + 10, y: t.y + 17, class: 'tn' }, name),
      t.cols.map((c, i) => svg('text', { x: t.x + 10, y: t.y + HEAD + 12 + i * LINE }, c)));
  }
  function center(t) {
    return [t.x + BOXW / 2, t.y + (HEAD + t.cols.length * LINE + 6) / 2];
  }

  function drawModel(key, q) {
    const m = MODELS[key], hit = new Set(q[key].tables);
    const edges = m.edges.map(([a, b]) => {
      const [x1, y1] = center(m.tables[a]), [x2, y2] = center(m.tables[b]);
      return svg('line', { x1, y1, x2, y2, class: `edge${hit.has(a) && hit.has(b) ? ' hit' : ''}` });
    });
    const boxes = Object.entries(m.tables).map(([n, t]) => box(n, t, hit.has(n)));
    const s = svg('svg', { viewBox: `0 0 ${m.w} ${m.h}`, role: 'img', 'aria-label': `${key === 'norm' ? 'Normalized' : 'Star'} schema, ${hit.size} tables highlighted` }, edges, boxes);
    $(`p5-${key}-svg`).replaceChildren(s);
    $(`p5-${key}-sql`).innerHTML = q[key].sql;
    const n = q[key].tables.length;
    DE.stat(`p5-${key}-tables`, String(n));
    if (q[key].rows) {
      $(`p5-${key}-joins-l`).textContent = 'Rows changed';
      DE.stat(`p5-${key}-joins`, DE.int(q[key].rows), q[key].rows > 1 ? 'warn-text' : 'good-text');
    } else {
      $(`p5-${key}-joins-l`).textContent = 'Joins';
      DE.stat(`p5-${key}-joins`, String(n - 1));
    }
  }

  function render(qk) {
    const q = QUESTIONS[qk];
    drawModel('norm', q);
    drawModel('star', q);
    $('p5-note').textContent = q.note;
  }

  function init() {
    const seg = DE.seg('p5-q', render);
    render(seg.get());
  }
  init();
})();
