# data-eng-concepts

The core ideas of data engineering, one interactive demo at a time. Every chapter is a small working
model you can poke: run a load twice, crash it halfway, move a customer across the country, break a
task in a DAG, and see what each design choice does to the numbers.

**[jkastl.github.io/data-eng-concepts](https://jkastl.github.io/data-eng-concepts/)**

| # | Topic | What you do |
|---|---|---|
| 1 | ETL vs ELT | Step an order export through both pipelines, then change a business rule after the source purged its history |
| 2 | Batch vs streaming | Switch between nightly, hourly, 15-minute, micro-batch and streaming; compare delay against compute |
| 3 | Idempotent loads | Append, overwrite a partition or merge; re-run, crash after 3 rows, retry, correct a row upstream |
| 4 | Incremental loads | Sync with a watermark and find the late commit and hard delete it misses; fix with a lookback and soft deletes |
| 5 | Normalized vs star schema | Pick a business question and compare tables, joins and SQL in each design; then rename a category |
| 6 | Slowly changing dimensions | Move a customer under SCD type 1, 2 and 3 and watch revenue by city |
| 7 | Row vs columnar, partitioning | See which values a query reads and which files get pruned; meet the small files problem |
| 8 | Data quality and contracts | Toggle tests, choose warn/quarantine/fail, and simulate an upstream schema change |
| 9 | Orchestration | Run a DAG with limited workers, make tasks flaky or broken, retry, clear and backfill |

A wrap-up page turns the nine chapters into a checklist for a new pipeline.

This site covers the fundamentals only. Advanced topics (stream processing internals, log-based CDC,
open table formats, distributed execution, lineage and governance, semantic layers) are left for a
separate project.

All data is a few dozen rows generated in the page by seeded formulas, so every visit sees the same
thing. Nothing is fetched or sent anywhere.

## Running it

No build step and no dependencies. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server
```

GitHub Pages serves the repo root from `main`. Commit and push changes directly to `main`; there are
no feature branches or pull requests.

## Layout

```
index.html            all chapter text and page structure; hash routes like #/scd
style.css             dark theme, responsive down to phone width
js/core.js            seeded RNG, element and table builders, controls, router
js/pipelines.js       1: ETL vs ELT
js/streaming.js       2: batch vs streaming (canvas timeline)
js/idempotency.js     3: idempotent loads
js/incremental.js     4: incremental loads and watermarks
js/modeling.js        5: normalized vs star schema (SVG diagrams)
js/scd.js             6: slowly changing dimensions
js/storage.js         7: row vs columnar storage and partitioning
js/quality.js         8: data quality tests and contracts
js/orchestration.js   9: DAG scheduler, retries and backfills
```

Chapters with animations (2 and 9) register `enter`/`leave` hooks with the router, so they stop
when you navigate away.

## Versioning

The version and date in the footer of `index.html` are **updated by hand**. Nothing bumps them
automatically. Change both in the same commit as the change they describe, following
[semver](https://semver.org/):

- **Patch** (`1.2.0` → `1.2.1`): fixing a typo, a bug or tweaking the wording.
- **Minor** (`1.2.0` → `1.3.0`): adding, removing, or changing a chapter or demo, or a small
  visual change.
- **Major** (`1.2.0` → `2.0.0`): a redesign or restructure of the app.

The date is the day of the change, in `YYYY-MM-DD` format.
