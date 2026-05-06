# Changelog

## 1.3.0 (Unreleased)

### Breaking Changes

- Minimum Grafana version bumped to 10.0.0
- Variable queries now use a typed editor (query type / dataset / label / metric / regex / PromQL). Legacy string-based variable queries are still accepted by `metricFindQuery` for backwards compatibility

### Added

- Full PromQL support across Explore, Dashboards and Unified Alerting, on par with Grafana's native Prometheus plugin in Code mode
- Go backend PromQL path (`/prometheus/api/v1/query`, `/prometheus/api/v1/query_range`) so Unified Alerting can evaluate PromQL directly through the plugin backend; handles matrix / vector / scalar result types and both unix and RFC3339 timestamps
- PromQL code editor (Monaco) with syntax highlighting, bracket matching, and UTF-8 metric name support (e.g. `process.cpu.time`)
- Context-aware PromQL autocomplete: metric names, label names and label values scoped to the current metric (via `/labels` and `/label/{name}/values` with `match[]`), aggregation & function snippets, `by` / `without` / `on` / `ignoring` grouping, `@` / `offset` modifiers, and duration completions inside range selectors
- Function signature help and hover documentation for 70+ PromQL functions / aggregations, plus hover docs for metrics (type + help from `/prometheus/api/v1/metadata`, with SQL fallback)
- Inline PromQL parse-error squiggles powered by the Prometheus Lezer grammar
- Per-datasource PromQL query history surfaced as completion items
- Typed variable query editor for PromQL: `label_names`, `label_values(metric, label)`, `metrics(regex)`, and `query_result(expr)`
- Range / Instant / Both toggle for PromQL queries in Explore (instant queries power Stat / Gauge / Table panels)
- Run queries button in Dashboard and Alerting (Explore keeps Grafana's native top-bar Run)
- Local-dev Alertmanager service in `docker-compose.yaml` for alert delivery testing (not part of the plugin release bundle)

### Changed

- Upgraded Grafana compatibility to 12.x
- Improved query editor UI
- Improved datasource connection handling
- Alerting on metrics datasets offers a Builder / Code toggle: Builder mirrors the logs/traces monitor flow (Field + Aggregate + Filters → SQL) while Code runs the full PromQL editor. Non-metrics datasets keep SQL with a default backfill so `/eval` never fires with an empty query
- Blur on the PromQL editor commits the text without auto-running; execution is explicit (Run queries button, Shift+Enter, or a committed UI action like changing dataset/mode/filter)
- Dataset picker sorts actively-ingesting datasets first, then alphabetically; in PromQL mode the list is filtered to `metrics`-type datasets
- Plugin logo paths switched from remote GitHub URLs to the bundled `img/logo.svg` so logos render without network access

### Fixed

- PromQL backend requests now preserve the query string correctly (previously `url.JoinPath` URL-escaped `?`, causing 404s on `/prometheus/api/v1/query_range`)
- Empty PromQL / SQL queries are rejected up front with a clear message instead of hitting the backend and returning a generic 500
- Scoped label / value fetches use a bounded 6-hour lookback window so Parseable's `match[]` endpoints return promptly instead of hanging
- High CPU during PromQL typing: metric detection moved inside a debounce and uses substring + char-code checks in the hot path
- Removed the 2-second debounced auto-run on keystroke; queries no longer execute until the user commits them

## 1.2.1 (2024-06-11)

### Fixed

- Fixed table header generation from schema and query results (#45)
- Improved datasource connection test reliability (#42)

## 1.2.0 (2024-03-14)

### Added

- Alerting support (#37, #38)
- Dynamic template variables from Parseable (#31)
- Multi-valued variable interpolation in queries (#32)

### Fixed

- Variable formatter handling for edge cases (#36)

## 1.1.0 (2023-06-18)

### Added

- Log stream querying with SQL query editor
- Dataset schema discovery and stats
- Grafana template variable support
- Pre-built log view dashboard
