# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A GaggiMate espresso profile generator: given bean/roast characteristics and a desired flavour, it computes machine extraction phases (pressure/flow/temperature curves over time) and exports them as GaggiMate-compatible JSON profiles. There are two front ends over one shared engine:

- `index.html` — standalone, buildless browser tool. Loads `profile-engine.js` via a plain `<script>` tag and reads the exported global `globalThis.GaggiMateProfileEngine`. No npm, no bundler, no test runner in this repo — open `index.html` directly in a browser to run/verify changes.
- `gaggimate-generator.jsx` / `Chart.jsx` / `RadarChart.jsx` — Preact components meant to be dropped into the actual GaggiMate device web UI (imports like `../../services/ApiService`, `../../components/ExtendedProfileChart.jsx` point at that external app, which does not live in this repo). These files can't be run standalone; treat them as source to be copied into the GaggiMate frontend project.

There is no build/lint/test tooling in this repo — it's plain ES5-compatible JS/JSX files meant to be consumed directly. Verify changes by opening `index.html` in a browser and exercising the UI (drag radar points, change roast/process/archetype, check the generated JSON/curve/phases update correctly).

## Architecture

### `profile-engine.js` — single source of truth

Pure, dependency-free model code (no DOM/Preact/React/network/storage). Exposed as `GaggiMateProfileEngine` via UMD-style wrapper (`globalThis` in browser, `module.exports` in Node/CJS). Both `index.html` and `gaggimate-generator.jsx` import *this exact file* — never duplicate model logic into either front end. Key exports and how they compose:

1. **Bean flavour model** — `beanFlavourDefaults(rl, ra, baseProcess, fermentation)` computes a 10-axis flavour baseline (`AXES`) by layering `PROCESS_FLAVOUR_DEFAULTS` + `FERMENTATION_FLAVOUR_BIASES` + `ROAST_FLAVOUR_BIASES` + `AGE_FLAVOUR_BIASES`. This baseline is called "Bean Flavour" in the UI.

2. **Recommendation heuristics** — `recommendedRatio`/`ratioRecommendationReason` (roast-driven brew ratio) and `rankedArchetypes`/`recommendedArchetype` (scores all 8 `ARCHETYPES` via `archetypeScores`, combining `ROAST_ARCHETYPE_SCORES` + `PROCESS_ARCHETYPE_SCORES` + `FERMENTATION_ARCHETYPE_SCORES`). These re-run automatically whenever roast/age/process/fermentation change, in both front ends.

3. **`buildProfile(state)`** — the core generator. Given roast/age/process/fermentation, `ratioTarget`, `arch`, `beanBp` (bean flavour), `cupBp` (intended cup), dose, and bluetooth-scale flag, it:
   - Derives base temperature `T0` from roast, then nudges it based on gaps between intended cup and bean flavour (`gap(axis) = (cupBp[axis] - beanBp[axis]) / 10`).
   - Blends `predictedBp` as a fixed weighted average: bean 50% + archetype tendency 30% + intended cup 20% (weights intentionally sum to 1.0 so a neutral 5/5/5 input predicts 5, not drift).
   - Computes `peakP` (peak pressure) and `mainF` (main flow) from roast + the same axis gaps.
   - Dispatches to one of 8 **archetype builders** (`Traditional Italian`, `Modern Sweet`, `Lever Style`, `Nordic Clarity`, `Turbo Shot`, `Syrupy Body`, `Cafe Allrounder`, `Adaptive Dynamic`) — each is a distinct, hand-designed phase sequence (fill/soak/ramp/hold/taper etc.) with durations and pump values derived from `peakP`/`mainF`/flavour gaps. When adding a new archetype, follow this same pattern: build both `jsonPhases` (final GaggiMate JSON) and `internalPhases` (for the preview curve — though `buildCurveFromJsonPhases` is now the actual curve source, see below).
   - Calls `applyHolisticTransitions(jsonPhases, predictedBp)` *after* all phases are built, so the transition classifier sees full before/after context — never set final transition types inline while building phases.
   - Applies bluetooth-scale coast compensation: only the *last* volumetric target is shifted by `scaleCoastCompensation` (1.5 g); without a scale, all volumetric targets are stripped and duration is the fallback stop condition.
   - Returns `{ baseTemp, total, curve, peakP, mainF, yv, scaleStopYield, archTend, predictedBp, json }`.

4. **Holistic transition engine** (`classifyPhaseRole`, `deriveTransitionForPhase`, `applyHolisticTransitions`) — classifies every phase into a role (`FILL`/`COMPRESS`/`SOAK`/`PEAK`/`DECLINE`/`TAIL`) from its pump target/pressure trajectory relative to neighbours, then picks a transition shape/duration/adaptive flag from a **rule table keyed on (prevRole → currRole)** pairs, further shaped by flavour axes (clarity, sweetness, body, acidity, floral, roastiness). This runs as a final pass over a complete phases array — any code that mutates phases after construction (e.g. `applyParams` in the JSX) must re-run `applyHolisticTransitions` afterward if transitions should stay consistent.

5. **`buildCurveFromJsonPhases(jsonPhases)`** — converts final JSON phases into a sampled `{t, p, fl}` point array for chart rendering, honoring each phase's `transition.type`/`duration` with easing functions (linear/ease-in/ease-out/ease-in-out/instant). This is the single source for both the standalone SVG curve and the Preact `ExtendedProfileChart`.

When changing sensory/extraction heuristics, prefer editing the bias tables and gap-weighted formulas over adding new branching logic — the model is deliberately table-driven so both UIs stay in sync automatically.

### `index.html`

Self-contained: inline `<style>`, inline `<script>` at the bottom driving a single mutable `state` object (roast/age/process/fermentation/ratio/archetype/dose/bean+cup flavour/profile metadata). `renderAll()` is the one function that recomputes `currentProfile = buildProfile(state)` and re-renders every dependent view (metrics, radar SVG, flavour table, curve SVG, phase table, raw JSON, archetype comparison cards, ratio/process notes). Any state mutation should be followed by `renderAll()`, not a piecemeal re-render. The radar chart is hand-drawn SVG with pointer-based drag handling (`drag` global + `updateDrag`), not a charting library.

### `gaggimate-generator.jsx` (`AdvancedProfileDesigner`)

Preact component for the real GaggiMate UI. Same engine, but adds a **two-layer profile architecture**:
- **Engine mode** (default): `activePhases = profile.json.phases` directly — no transformation.
- **Import mode**: once a profile is imported (`importProfile`) or manually edited (`editPhases`), `basePhases`/`editPhases` become the template, and `applyParams()` *rescales* that template's pressure/flow/temperature/duration/yield toward the current engine-computed targets (via ratios against a neutral `refProfile`) rather than regenerating phases from scratch. `overwriteFlags` (pressure/flow/temperature/transitions) control which dimensions `applyParams` is allowed to touch — respect these flags in any change to that function.
- Template precedence is `editPhases ?? basePhases ?? profile.json.phases` — manual edits always win over the imported base, which wins over pure-engine output.
- Includes an experimental AI tab (`generateAiProfile`) that calls an external HuggingFace-compatible chat endpoint with a hardcoded system prompt describing the phase JSON schema, to mutate `activePhases` via natural language. The API token is stored only in a browser cookie (`gm_ai_key`), never sent anywhere but that HF endpoint.
- Talks to the actual device over `ApiServiceContext` (`req:profiles:list` / `req:profiles:save`) — this context only exists inside the real GaggiMate app, so this component cannot run standalone in this repo.

### `Chart.jsx` / `RadarChart.jsx`

Thin Preact wrappers around Chart.js for the GaggiMate UI (`ChartComponent` handles mount/update/destroy/resize once; `ExtendedRadarChart` layers `chartjs-plugin-dragdata` for the two draggable datasets — Bean Flavour and Intended Cup Flavour, indices 0 and 1 only — plus `chartjs-plugin-annotation`, registered once here). These are UI-only; no model logic belongs here.

## Working across the two front ends

Because `index.html` and `gaggimate-generator.jsx` intentionally duplicate UI logic (control layout, defaults-application flow, archetype comparison rendering) on top of the *same* `profile-engine.js`, a change to sensory/extraction behavior should go in the engine only. A change to how a control behaves (e.g. "roast change re-applies bean defaults but keeps the cup delta") is UI-side and typically needs mirroring in both `index.html`'s `pullCoffeeCharacteristicsAndApplyDefaults`/`applyBeanFlavourDefaults` and the JSX's `useEffect` on `[rl, ra, baseProcess, fermentation]` — check both when touching this behavior.
