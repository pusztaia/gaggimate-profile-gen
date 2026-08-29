# GaggiMate Flavour Profile Generator

Generates GaggiMate espresso extraction profiles (pressure/flow/temperature phases over time) from bean characteristics and a desired flavour target. One shared engine, two front ends:

- **`index.html`** — a standalone, buildless browser tool. It loads `profile-engine.js` via a plain `<script>` tag; just open the file in a browser, no install or build step required.
- **`gaggimate-generator.jsx`** (with `Chart.jsx` / `RadarChart.jsx`) — Preact components meant to be copied into the actual [GaggiMate](https://github.com/jniebuhr/gaggimate) device web UI. They import things like `../../services/ApiService` that only exist in that app, so they can't run standalone here.

See `CLAUDE.md` for a deeper architectural walkthrough of the shared engine.

## Development

Requires Node.js 20+.

```bash
npm install
npm test          # run the profile-engine.js test suite (Vitest)
npm run test:watch
npm run lint       # ESLint over profile-engine.js, the .jsx files, and tests
npm run format     # Prettier — applies to tests/ and config files only
npm run format:check
```

`index.html` and `profile-engine.js` are intentionally not passed through Prettier or a bundler — they ship as-is to the browser, and their dense, compact style predates this tooling. Formatting is scoped to newly added files (tests, configs) to avoid unrelated diffs on the shipped code.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs `npm run lint` and `npm test` on every push/PR to `main`.
