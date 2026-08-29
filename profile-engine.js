/* Shared GaggiMate flavour/profile engine.
 * Single source of truth for both the standalone browser UI and the JSX generator.
 * Pure model code: no DOM, Preact, React, network, or storage dependencies.
 */
(function (root, factory) {
  const engine = factory();
  root.GaggiMateProfileEngine = engine;
  if (typeof module === 'object' && module.exports) module.exports = engine;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const ENGINE_VERSION = '2026.08.14-shared-1';

const ROAST_LABELS = ['Ultra Light', 'Light', 'Medium-Light', 'Medium', 'Medium-Dark', 'Dark'];
const AGE_LABELS   = ['Fresh', 'Rested', 'Old'];
const BASE_PROCESSING = [
  { id:'Washed', label:'Washed', note:'Clean, bright and transparent; typically higher perceived acidity, lighter body, floral/tea-like character.' },
  { id:'Natural', label:'Natural / dry process', note:'Fruit-forward, sweeter and fuller-bodied; often jammy, berry-like or winey.' },
  { id:'Honey', label:'Honey / pulped natural', note:'A balanced middle ground: high sweetness, rounded fruit and medium-to-full body, usually cleaner than natural.' },
];
const FERMENTATIONS = [
  { id:'None', label:'None / conventional', note:'' },
  { id:'Anaerobic', label:'Anaerobic', note:'An oxygen-restricted fermentation overlay. Often highly aromatic, tropical/funky and sweet; acidity and body can vary.' },
  { id:'Carbonic maceration', label:'Carbonic maceration', note:'CO₂-rich fermentation inspired by winemaking; commonly grape/berry-like, floral, sweet and complex with medium-high acidity.' },
];

// Sensory starting points derived from the supplied processing guide.
// Axes not directly supported by that guide (Bitterness, Chocolate, Roastiness, Crema)
// start neutral here and are then shaped by roast/age heuristics below.
const PROCESS_FLAVOUR_DEFAULTS = {
  Washed:  { Acidity:8.0, Sweetness:6.0, Bitterness:5.0, Body:4.0, Clarity:9.0, Fruitiness:6.5, Chocolate:5.0, Roastiness:5.0, Crema:5.0, Floral:8.0 },
  Natural: { Acidity:6.0, Sweetness:9.0, Bitterness:5.0, Body:8.0, Clarity:5.0, Fruitiness:9.0, Chocolate:5.0, Roastiness:5.0, Crema:5.0, Floral:5.5 },
  Honey:   { Acidity:6.5, Sweetness:8.5, Bitterness:5.0, Body:7.0, Clarity:7.0, Fruitiness:7.5, Chocolate:5.0, Roastiness:5.0, Crema:5.0, Floral:6.0 },
};
const FERMENTATION_FLAVOUR_BIASES = {
  None: {},
  Anaerobic: { Sweetness:0.8, Fruitiness:1.2, Floral:0.4, Clarity:-0.5 },
  'Carbonic maceration': { Acidity:0.7, Sweetness:0.7, Fruitiness:1.0, Floral:1.0, Clarity:0.3 },
};

// Roast and bean-age sensory biases are generator heuristics. They are deliberately
// moderate so processing/fermentation still describe origin character instead of
// being overwhelmed by the roast model.
const ROAST_FLAVOUR_BIASES = [
  { Acidity: 1.4, Sweetness:-0.3, Bitterness:-1.2, Body:-1.0, Clarity: 1.0, Fruitiness: 0.8, Chocolate:-1.3, Roastiness:-2.2, Crema:-0.8, Floral: 1.2 }, // Ultra Light
  { Acidity: 0.9, Sweetness: 0.1, Bitterness:-0.8, Body:-0.6, Clarity: 0.8, Fruitiness: 0.6, Chocolate:-0.8, Roastiness:-1.5, Crema:-0.5, Floral: 0.8 }, // Light
  { Acidity: 0.4, Sweetness: 0.4, Bitterness:-0.3, Body:-0.2, Clarity: 0.4, Fruitiness: 0.3, Chocolate:-0.3, Roastiness:-0.7, Crema:-0.2, Floral: 0.4 }, // Medium-Light
  { Acidity: 0.0, Sweetness: 0.5, Bitterness: 0.0, Body: 0.3, Clarity: 0.0, Fruitiness: 0.0, Chocolate: 0.4, Roastiness: 0.2, Crema: 0.2, Floral: 0.0 }, // Medium
  { Acidity:-0.7, Sweetness: 0.1, Bitterness: 0.7, Body: 0.8, Clarity:-0.8, Fruitiness:-0.8, Chocolate: 1.0, Roastiness: 1.2, Crema: 0.6, Floral:-0.8 }, // Medium-Dark
  { Acidity:-1.4, Sweetness:-0.5, Bitterness: 1.4, Body: 1.1, Clarity:-1.4, Fruitiness:-1.5, Chocolate: 1.2, Roastiness: 2.1, Crema: 0.8, Floral:-1.5 }, // Dark
];
const AGE_FLAVOUR_BIASES = [
  { Acidity: 0.2, Sweetness:-0.2, Body: 0.1, Clarity:-0.2, Fruitiness: 0.2, Crema: 1.2, Floral: 0.2 }, // Fresh
  { Sweetness: 0.3, Clarity: 0.3, Crema: 0.2 }, // Rested
  { Acidity:-0.4, Sweetness:-0.5, Body:-0.2, Clarity:-0.6, Fruitiness:-0.6, Roastiness:0.1, Crema:-1.2, Floral:-0.7 }, // Old
];

function beanFlavourDefaults(rl, ra, baseProcess, fermentation) {
  const base = { ...(PROCESS_FLAVOUR_DEFAULTS[baseProcess] ?? PROCESS_FLAVOUR_DEFAULTS.Washed) };
  const fermentationBias = FERMENTATION_FLAVOUR_BIASES[fermentation] ?? {};
  const roastBias = ROAST_FLAVOUR_BIASES[clamp(Math.round(rl), 0, ROAST_FLAVOUR_BIASES.length - 1)] ?? {};
  const ageBias = AGE_FLAVOUR_BIASES[clamp(Math.round(ra), 0, AGE_FLAVOUR_BIASES.length - 1)] ?? {};
  AXES.forEach(axis => {
    base[axis] = clamp(r1(
      (base[axis] ?? 5) +
      (fermentationBias[axis] ?? 0) +
      (roastBias[axis] ?? 0) +
      (ageBias[axis] ?? 0)
    ), 0, 10);
  });
  return base;
}

const AXES         = ['Acidity','Sweetness','Bitterness','Body','Clarity','Fruitiness','Chocolate','Roastiness','Crema','Floral'];
const ARCHETYPE_TENDencies = {
  'Traditional Italian': { Acidity: 3, Sweetness: 5, Bitterness: 7, Body: 9, Clarity: 2, Fruitiness: 3, Chocolate: 9, Roastiness: 8, Crema: 9, Floral: 2 },
  'Modern Sweet':        { Acidity: 6, Sweetness: 9, Bitterness: 4, Body: 6, Clarity: 7, Fruitiness: 7, Chocolate: 5, Roastiness: 4, Crema: 5, Floral: 6 },
  'Lever Style':         { Acidity: 5, Sweetness: 8, Bitterness: 4, Body: 7, Clarity: 6, Fruitiness: 6, Chocolate: 6, Roastiness: 5, Crema: 7, Floral: 8 },
  'Nordic Clarity':      { Acidity: 9, Sweetness: 6, Bitterness: 2, Body: 3, Clarity: 10, Fruitiness: 9, Chocolate: 2, Roastiness: 2, Crema: 2, Floral: 9 },
  'Turbo Shot':          { Acidity: 7, Sweetness: 5, Bitterness: 3, Body: 4, Clarity: 8, Fruitiness: 7, Chocolate: 3, Roastiness: 3, Crema: 4, Floral: 7 },
  'Syrupy Body':         { Acidity: 4, Sweetness: 7, Bitterness: 5, Body: 10, Clarity: 3, Fruitiness: 4, Chocolate: 8, Roastiness: 6, Crema: 8, Floral: 4 },
  'Cafe Allrounder':     { Acidity: 5, Sweetness: 6, Bitterness: 5, Body: 6, Clarity: 6, Fruitiness: 5, Chocolate: 6, Roastiness: 5, Crema: 6, Floral: 5 },
  'Adaptive Dynamic':    { Acidity: 6, Sweetness: 7, Bitterness: 5, Body: 7, Clarity: 6, Fruitiness: 6, Chocolate: 5, Roastiness: 5, Crema: 6, Floral: 6 },
};
const ARCHETYPES = [
  { id:'Traditional Italian', tag:'High pressure · classic crema' },
  { id:'Modern Sweet', tag:'Smooth ramp · sweetness-first' },
  { id:'Lever Style', tag:'Long bloom · pressure decline' },
  { id:'Nordic Clarity', tag:'Lower pressure · flow-driven' },
  { id:'Turbo Shot', tag:'Fast & high-flow extraction' },
  { id:'Syrupy Body', tag:'Slow flow · textured mouthfeel' },
  { id:'Cafe Allrounder', tag:'Balanced · versatile profile' },
  { id:'Adaptive Dynamic', tag:'Multi-stage adaptive curves' },
];

// Automatic archetype recommendation heuristic.
// Recommended espresso brew ratio heuristic. Roast is the main driver;
// bean age and processing add smaller corrections. The recommendation is
// automatically written into the Ratio field when coffee characteristics change.
const ROAST_RATIO_BASE = [2.60, 2.40, 2.20, 2.00, 1.85, 1.70];
const AGE_RATIO_ADJUST = [0.05, 0.00, -0.10]; // Fresh, Rested, Old
const PROCESS_RATIO_ADJUST = { Washed:0.10, Natural:-0.05, Honey:0.00 };
const FERMENTATION_RATIO_ADJUST = { None:0.00, Anaerobic:-0.05, 'Carbonic maceration':0.05 };

function roundTo05(v){ return Math.round(v * 20) / 20; }
function recommendedRatio(rl, ra, baseProcess, fermentation) {
  const roastBase = ROAST_RATIO_BASE[clamp(Math.round(rl),0,ROAST_RATIO_BASE.length-1)] ?? 2.0;
  const ageAdj = AGE_RATIO_ADJUST[clamp(Math.round(ra),0,AGE_RATIO_ADJUST.length-1)] ?? 0;
  const processAdj = PROCESS_RATIO_ADJUST[baseProcess] ?? 0;
  const fermentationAdj = FERMENTATION_RATIO_ADJUST[fermentation] ?? 0;
  return clamp(roundTo05(roastBase + ageAdj + processAdj + fermentationAdj), 1.50, 3.00);
}

function ratioRecommendationReason(rl, ra, baseProcess, fermentation) {
  const parts = [];
  const roast = ROAST_LABELS[rl] ?? 'Selected';
  if (rl <= 1) parts.push(`${roast} roast favours a longer ratio for extraction and clarity`);
  else if (rl >= 4) parts.push(`${roast} roast favours a shorter ratio to limit roast-driven bitterness`);
  else parts.push(`${roast} roast sets a balanced starting ratio`);
  if (ra === 0) parts.push('fresh beans get a small longer-ratio adjustment');
  if (ra === 2) parts.push('older beans get a small shorter-ratio adjustment');
  if (baseProcess === 'Washed') parts.push('washed adds a small clarity-oriented increase');
  if (baseProcess === 'Natural') parts.push('natural adds a small body-oriented decrease');
  if (fermentation === 'Anaerobic') parts.push('anaerobic gets a small intensity-limiting decrease');
  if (fermentation === 'Carbonic maceration') parts.push('carbonic gets a small clarity-oriented increase');
  return parts.join('; ');
}

// Roast drives the extraction style first; processing and fermentation refine it.
// The processing weights follow the supplied sensory guide, while the archetype
// pairing itself is a generator heuristic rather than a claim from that guide.
const ROAST_ARCHETYPE_SCORES = [
  { 'Nordic Clarity':6, 'Turbo Shot':5, 'Lever Style':3, 'Modern Sweet':2, 'Adaptive Dynamic':1, 'Cafe Allrounder':0, 'Syrupy Body':-2, 'Traditional Italian':-3 }, // Ultra Light
  { 'Nordic Clarity':5, 'Turbo Shot':4, 'Lever Style':3, 'Modern Sweet':3, 'Adaptive Dynamic':1, 'Cafe Allrounder':0, 'Syrupy Body':-1, 'Traditional Italian':-2 }, // Light
  { 'Modern Sweet':5, 'Lever Style':4, 'Nordic Clarity':3, 'Turbo Shot':2, 'Adaptive Dynamic':3, 'Cafe Allrounder':2, 'Syrupy Body':0, 'Traditional Italian':-1 }, // Medium-Light
  { 'Cafe Allrounder':5, 'Modern Sweet':5, 'Adaptive Dynamic':4, 'Lever Style':2, 'Syrupy Body':2, 'Traditional Italian':1, 'Turbo Shot':0, 'Nordic Clarity':0 }, // Medium
  { 'Syrupy Body':5, 'Traditional Italian':4, 'Cafe Allrounder':4, 'Modern Sweet':2, 'Adaptive Dynamic':2, 'Lever Style':0, 'Turbo Shot':-2, 'Nordic Clarity':-3 }, // Medium-Dark
  { 'Traditional Italian':7, 'Syrupy Body':5, 'Cafe Allrounder':2, 'Adaptive Dynamic':0, 'Modern Sweet':-1, 'Lever Style':-2, 'Turbo Shot':-4, 'Nordic Clarity':-5 }, // Dark
];
const PROCESS_ARCHETYPE_SCORES = {
  Washed:  { 'Nordic Clarity':4, 'Turbo Shot':2, 'Lever Style':2, 'Modern Sweet':1, 'Cafe Allrounder':1, 'Adaptive Dynamic':1, 'Syrupy Body':-1 },
  Natural: { 'Modern Sweet':4, 'Syrupy Body':3, 'Adaptive Dynamic':2, 'Cafe Allrounder':1, 'Turbo Shot':1, 'Nordic Clarity':-1 },
  Honey:   { 'Modern Sweet':4, 'Lever Style':3, 'Syrupy Body':2, 'Cafe Allrounder':2, 'Adaptive Dynamic':1 },
};
const FERMENTATION_ARCHETYPE_SCORES = {
  None: {},
  Anaerobic: { 'Adaptive Dynamic':4, 'Turbo Shot':3, 'Modern Sweet':2, 'Lever Style':1, 'Syrupy Body':-1 },
  'Carbonic maceration': { 'Lever Style':4, 'Nordic Clarity':3, 'Turbo Shot':2, 'Adaptive Dynamic':2, 'Modern Sweet':1 },
};
function archetypeScores(rl, baseProcess, fermentation) {
  const scores = Object.fromEntries(ARCHETYPES.map(a => [a.id, 0]));
  const add = source => Object.entries(source || {}).forEach(([id, value]) => { if (id in scores) scores[id] += value; });
  add(ROAST_ARCHETYPE_SCORES[clamp(Math.round(rl), 0, ROAST_ARCHETYPE_SCORES.length - 1)]);
  add(PROCESS_ARCHETYPE_SCORES[baseProcess]);
  add(FERMENTATION_ARCHETYPE_SCORES[fermentation]);

  // On darker roasts, processing character should not push the recommendation
  // all the way back toward very light-roast extraction styles.
  if (rl >= 4) {
    scores['Nordic Clarity'] -= 3;
    scores['Turbo Shot'] -= 2;
  }
  if (rl >= 5) scores['Traditional Italian'] += 2;
  return scores;
}

function rankedArchetypes(rl, baseProcess, fermentation) {
  const scores = archetypeScores(rl, baseProcess, fermentation);
  return ARCHETYPES
    .map((item, originalIndex) => ({ ...item, score: scores[item.id] ?? 0, originalIndex }))
    .sort((a, b) => (b.score - a.score) || (a.originalIndex - b.originalIndex));
}

function recommendedArchetype(rl, baseProcess, fermentation) {
  return rankedArchetypes(rl, baseProcess, fermentation)[0]?.id ?? ARCHETYPES[0].id;
}
/* Shared profile-generation engine. */
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
const r1 = v => +v.toFixed(1);
const r2 = v => +v.toFixed(2);

// ─── Single predicted-flavour profile engine ─────────────────────
function buildProfile({ rl, ra, baseProcess, fermentation, ratioTarget, arch, beanBp, cupBp, dose, hasBluetoothScale, profileId, profileLabel, profileDescription }) {
  const hasBase = p => baseProcess === p;
  const hasFermentation = f => fermentation === f;
  const archTend = ARCHETYPE_TENDencies[arch] ?? ARCHETYPE_TENDencies['Cafe Allrounder'];

  // Predicted flavour has a single source of truth. Roast, bean age, processing
  // and fermentation are already represented in beanBp; archetype and intended cup
  // then shape that baseline through the normalized blend below.

  // Base temperature follows roast development: lighter roasts start hotter, darker roasts cooler.
  // Ultra Light 95°C, Light 94°C, Medium-Light 93°C, Medium 92°C, Medium-Dark 91°C, Dark 90°C.
  // Bean age, processing, fermentation and flavour-target corrections are applied below.
  let T0 = 95.0 - rl;
  if (ra === 0) T0 -= 0.4; if (ra === 2) T0 += 0.3;
  if (hasBase('Washed')) T0 -= 0.2; if (hasBase('Natural')) T0 += 0.15; if (hasBase('Honey')) T0 += 0.05;
  // Conservative extraction heuristics for highly aromatic fermentations: avoid amplifying intensity too aggressively.
  if (hasFermentation('Anaerobic')) T0 -= 0.30;
  if (hasFermentation('Carbonic maceration')) T0 -= 0.20;

  const gap = axis => ((cupBp[axis] ?? 5) - (beanBp[axis] ?? 5)) / 10;
  T0 -= gap('Roastiness') * 0.8;  // roasty → slightly lower
  T0 += gap('Floral') * 0.5;  // floral → slightly lower to preserve
  T0 -= gap('Fruitiness') * 0.4;  // fruity → lower to preserve brightness
  T0 += gap('Body') * 0.4;  // body-forward → slightly higher
  T0 -= gap('Chocolate') * 0.3;
  T0 += gap('Crema') * 0.2;
  
  if (gap('Acidity') > 0.1)  T0 += gap('Acidity') * 1.0;
  if (gap('Acidity') < -0.1) T0 += gap('Acidity') * 0.5;
  if (gap('Bitterness') < -0.1) T0 -= Math.abs(gap('Bitterness')) * 0.8;
  T0 = clamp(T0, 79, 98);

  const yv = r1(dose * ratioTarget);
  // Bluetooth scale coast compensation: the beverage keeps flowing briefly after
  // the pump is stopped. Empirical scale profiles in this project use about 1.5 g
  // of coast allowance, so the final scale stop happens before the desired cup yield.
  const scaleCoastCompensation = 1.5;
  const scaleStopYield = r1(Math.max(0.1, yv - scaleCoastCompensation));

  const predictedBp = {};
  AXES.forEach(axis => {
    const baseline = beanBp[axis] ?? 5;
    const tendency = archTend[axis] ?? 5;
    const intended = cupBp[axis] ?? baseline;
    // Predicted flavour is a normalized blend: the bean remains dominant,
    // the archetype shapes the extraction style, and the intended cup nudges
    // the result toward the user's target. Weights sum to 1.0, so a neutral
    // 5 / 5 / 5 input predicts 5 instead of drifting down to 4.
    const score = baseline * 0.50 + tendency * 0.30 + intended * 0.20;
    predictedBp[axis] = clamp(r1(score), 1, 10);
  });

  const clarGap  = gap('Clarity');
  const bodyGap  = gap('Body');
  const bSyrup   = (beanBp.Body      ?? 5) / 10;

  let jsonPhases = [];

  // ── peakP ────────────────────────────────────────────────────────
  // Base: 9.0 bar at neutral. Darker roast pulls it down.
  // Body/Chocolate/Crema push it up; Clarity/Floral/Fruitiness/Roastiness pull it down.
  let peakP = 9.0;
  peakP -= rl * 0.25;                          // darker roast → lower P
  peakP += gap('Body') * 1.2;             // body-forward bean → higher P
  peakP += gap('Chocolate') * 0.8;             // chocolatey bean → slightly higher P
  peakP += gap('Crema') * 1.5;             // crema-focus → higher P
  peakP -= gap('Roastiness') * 1.0;             // already roasty → reduce P to avoid bitterness
  peakP -= gap('Floral') * 0.9;             // floral → lower P preserves aromatics
  peakP -= gap('Fruitiness') * 0.7;             // fruity → lower P preserves brightness
  peakP -= gap('Bitterness')* 0.5;             // bean already bitter → reduce P
  peakP -= gap('Clarity')   * 0.5;             // target wants clarity → lower P
  peakP = clamp(r2(peakP), 5.5, 10.5);

  // ── mainF ────────────────────────────────────────────────────────
  // Base: 2.2 ml/s at neutral. Body/Chocolate slow it; Clarity/Floral/Fruitiness/Acidity speed it.
  let mainF = 2.2;
  mainF -= gap('Body') * 0.8;             // body-forward → slower flow
  mainF -= gap('Chocolate') * 0.5;             // chocolatey → slightly slower
  mainF += gap('Floral') * 0.7;             // floral → faster flow preserves volatiles
  mainF += gap('Fruitiness') * 0.6;             // fruity → faster
  mainF += gap('Roastiness') * 0.4;             // roasty → faster to avoid over-extraction
  mainF += gap('Clarity')   * 0.8;             // targeting clarity → faster flow
  mainF += gap('Acidity')   * 0.5;             // targeting acidity → faster
  mainF -= gap('Sweetness') * 0.3;             // targeting sweetness → slightly slower
  // Processing-informed extraction heuristic. Most of the processing effect already enters through beanBp; these are deliberately small nudges.
  if (hasBase('Washed')) mainF += 0.12;
  if (hasBase('Natural')) mainF -= 0.12;
  if (hasBase('Honey')) mainF -= 0.06;
  if (hasFermentation('Anaerobic')) { mainF += 0.12; peakP -= 0.20; }
  if (hasFermentation('Carbonic maceration')) { mainF += 0.18; peakP -= 0.20; }
  mainF = clamp(r2(mainF), 0.8, 5.5);
  peakP = clamp(r2(peakP), 5.5, 10.5);

  // ── satD / extrD ─────────────────────────────────────────────────
  // Saturation duration: sweet/floral/fruity beans need more bloom time.
  // Extraction duration: body/chocolate/sweetness targets need longer; clarity/turbo shorter.
  let satD = 8;
  satD += (5 - rl) * 1.2;                      // lighter roast → more saturation time
  satD += (1 - ra) * 2.0;                       // fresh beans → more bloom
  satD += gap('Sweetness') * 4;                 // targeting sweetness → longer soak
  satD += gap('Floral') * 3;               // floral bean → longer gentle bloom
  satD += gap('Fruitiness') * 2;               // fruity → longer bloom
  satD -= gap('Roastiness') * 2;               // roasty → less bloom needed
  if (hasBase('Washed')) satD += 1;
  if (hasBase('Honey')) satD += 1;
  if (hasFermentation('Anaerobic')) satD -= 1;
  if (hasFermentation('Carbonic maceration')) satD += 1;
  satD = clamp(Math.round(satD), 4, 22);

  let extrD = 25;
  extrD += rl * 2;
  extrD += gap('Sweetness') * 5;
  extrD += gap('Body') * 8;              // body-forward bean → longer extraction
  extrD += gap('Chocolate') * 6;              // chocolatey → longer
  extrD -= gap('Floral') * 4;              // floral → shorter to preserve aromatics
  extrD -= gap('Fruitiness') * 3;              // fruity → shorter
  extrD -= gap('Clarity')   * 4;
  extrD = clamp(Math.round(extrD), 12, 55);

  // ── ARCHETYPE PROFILE BUILDERS ──────────────────────────────────
  // Each archetype has a distinct, coherent phase structure designed
  // around real espresso technique. Transitions are set as placeholder
  // 'instant' here — they'll be overwritten by applyHolisticTransitions
  // at the end of buildProfile (which has the full phase array context).

  if (arch === 'Traditional Italian') {
    // Classic 9-bar espresso: fast flow fill → brief low-pressure soak → hard ramp → sustained
    // high pressure → moderate taper. Crema-forward, full body, chocolatey.
    const fillD  = clamp(Math.round(3 + (1 - ra) * 2), 2, 6);
    const soakD  = clamp(Math.round(satD * 0.5), 2, 7);
    const rampD  = clamp(Math.round(3 + rl * 0.3), 3, 6);
    const holdD  = clamp(Math.round(extrD * 0.70), 10, 36);
    const taperD = clamp(Math.round(extrD * 0.30), 4, 16);
    const fillF  = clamp(r1(7.0 - rl * 0.2), 4.5, 9.0);
    const holdP  = peakP;
    const taperP = clamp(r2(holdP - 2.0 + gap('Body') * 0.5), 4.5, 8.5);

    jsonPhases = [
      { name:'Fill', phase:'preinfusion', valve:1, duration:fillD, temperature:r1(T0+0.3),
        transition:{type:'instant',duration:0,adaptive:false},
        pump:{target:'flow',pressure:0,flow:fillF},
        targets:[{type:'water_pumped',operator:'gte',value:100}] },
      { name:'Soak', phase:'preinfusion', valve:1, duration:soakD, temperature:r1(T0+0.2),
        transition:{type:'instant',duration:0,adaptive:false},
        pump:{target:'pressure',pressure:2.0,flow:0},
        targets:[{type:'water_pumped',operator:'gte',value:100},{type:'pressure',operator:'gte',value:1.5}] },
      { name:'Ramp', phase:'brew', valve:1, duration:rampD, temperature:r1(T0),
        transition:{type:'instant',duration:0,adaptive:true},
        pump:{target:'pressure',pressure:holdP,flow:r1(mainF*0.6)},
        targets:[{type:'water_pumped',operator:'gte',value:100},{type:'pressure',operator:'gte',value:r2(holdP-0.4)}] },
      { name:'Hold', phase:'brew', valve:1, duration:holdD, temperature:r1(T0),
        transition:{type:'instant',duration:0,adaptive:true},
        pump:{target:'pressure',pressure:holdP,flow:mainF},
        targets:[{type:'water_pumped',operator:'gte',value:100},{type:'volumetric',operator:'gte',value:r1(yv*0.72)}] },
      { name:'Taper', phase:'brew', valve:1, duration:taperD, temperature:r1(T0-0.4),
        transition:{type:'instant',duration:0,adaptive:true},
        pump:{target:'pressure',pressure:taperP,flow:r1(mainF*1.1)},
        targets:[{type:'volumetric',operator:'gte',value:r1(yv)}] },
    ];

  } else if (arch === 'Modern Sweet') {
    // Gentle flow prewet → low-pressure soak → smooth S-curve ramp → flow-controlled extraction.
    // Targets sweetness and clarity. Lower peak P, flow-locked extraction.
    const prewetD = clamp(Math.round(satD * 0.45 + gap('Sweetness') * 1.5), 3, 9);
    const soakD2  = clamp(Math.round(satD * 0.55 + gap('Sweetness') * 2), 3, 12);
    const rampD   = clamp(Math.round(6 + gap('Sweetness') * 2), 5, 10);
    const extrDS  = clamp(Math.round(extrD + gap('Sweetness') * 8), 14, 50);
    const sweetP  = clamp(r2(peakP - 0.8 - gap('Clarity') * 0.5), 5.5, 9.5);
    const sweetF  = clamp(r2(mainF + gap('Clarity') * 0.4), 1.0, 4.5);
    const prewetF = clamp(r1(4.0 + gap('Fruitiness') * 0.5), 2.5, 6.0);

    jsonPhases = [
      { name:'Prewet', phase:'preinfusion', valve:1, duration:prewetD, temperature:r1(T0+0.5),
        transition:{type:'instant',duration:0,adaptive:false},
        pump:{target:'flow',pressure:0,flow:prewetF},
        targets:[{type:'water_pumped',operator:'gte',value:100},{type:'pressure',operator:'gte',value:0.8}] },
      { name:'Soak', phase:'preinfusion', valve:1, duration:soakD2, temperature:r1(T0+0.3),
        transition:{type:'instant',duration:0,adaptive:false},
        pump:{target:'pressure',pressure:2.2,flow:0},
        targets:[{type:'water_pumped',operator:'gte',value:100},{type:'flow',operator:'lte',value:2.0}] },
      { name:'Ramp', phase:'brew', valve:1, duration:rampD, temperature:r1(T0),
        transition:{type:'instant',duration:0,adaptive:true},
        pump:{target:'pressure',pressure:sweetP,flow:sweetF},
        targets:[{type:'water_pumped',operator:'gte',value:100},{type:'pressure',operator:'gte',value:r2(sweetP-0.4)}] },
      { name:'Extraction', phase:'brew', valve:1, duration:extrDS, temperature:r1(T0),
        transition:{type:'instant',duration:0,adaptive:true},
        pump:{target:'flow',pressure:r2(sweetP+0.3),flow:sweetF},
        targets:[{type:'volumetric',operator:'gte',value:r1(yv)}] },
    ];

  } else if (arch === 'Lever Style') {
    // Mimics spring-lever mechanics: low fill → gentle saturation soak → hard rise to peak →
    // brief hold until flow appears → long linear pressure decline through yield.
    const fillD    = clamp(Math.round(2 + (1 - ra) * 1.5), 2, 5);
    const piD      = clamp(Math.round(satD * 0.55), 4, 14);
    const soakD2   = clamp(Math.round(satD * 0.45), 2, 9);
    const riseD    = clamp(Math.round(4 + rl * 0.5), 3, 8);
    const holdD    = clamp(Math.round(5 + gap('Sweetness') * 3), 3, 10);
    const declineD = clamp(Math.round(32 + rl * 4 + gap('Sweetness') * 6), 22, 65);
    const fillP    = clamp(r2(1.5 + (hasBase('Natural') ? 0.3 : (hasBase('Honey') ? 0.15 : 0))), 1.1, 2.5);
    const piP      = clamp(r2(fillP + 0.6), 1.5, 3.2);
    const riseP    = clamp(r2(peakP + 0.5), 7.5, 11.0);
    const declineP = clamp(r2(2.0 + gap('Sweetness') * 0.5), 1.5, 4.0);

    jsonPhases = [
      { name:'Fill Start', phase:'preinfusion', valve:1, duration:fillD, temperature:r1(T0+0.5),
        transition:{type:'instant',duration:0,adaptive:false},
        pump:{target:'pressure',pressure:fillP,flow:0},
        targets:[{type:'water_pumped',operator:'gte',value:100}] },
      { name:'Pre-infusion', phase:'preinfusion', valve:1, duration:piD, temperature:r1(T0+0.3),
        transition:{type:'instant',duration:0,adaptive:false},
        pump:{target:'pressure',pressure:piP,flow:0},
        targets:[{type:'water_pumped',operator:'gte',value:100},{type:'pressure',operator:'gte',value:r2(piP-0.2)}] },
      { name:'Soak', phase:'preinfusion', valve:1, duration:soakD2, temperature:r1(T0+0.2),
        transition:{type:'instant',duration:0,adaptive:false},
        pump:{target:'pressure',pressure:piP,flow:0} },
      { name:'Rise', phase:'brew', valve:1, duration:riseD, temperature:r1(T0),
        transition:{type:'instant',duration:0,adaptive:false},
        pump:{target:'pressure',pressure:riseP,flow:0},
        targets:[{type:'water_pumped',operator:'gte',value:100},{type:'pressure',operator:'gte',value:r2(riseP-0.3)}] },
      { name:'Hold', phase:'brew', valve:1, duration:holdD, temperature:r1(T0),
        transition:{type:'instant',duration:0,adaptive:false},
        pump:{target:'pressure',pressure:riseP,flow:0},
        targets:[{type:'water_pumped',operator:'gte',value:100},{type:'flow',operator:'gte',value:1.2}] },
      { name:'Decline', phase:'brew', valve:1, duration:declineD, temperature:r1(T0-0.3),
        transition:{type:'instant',duration:0,adaptive:true},
        pump:{target:'pressure',pressure:declineP,flow:0},
        targets:[{type:'volumetric',operator:'gte',value:r1(yv)}] },
    ];

  } else if (arch === 'Nordic Clarity') {
    // Lower pressure, flow-first extraction for transparency and acidity.
    // Fill → compress to puck resistance → sharp ramp to moderate pressure →
    // flow-locked extraction that lets the puck resistance govern pressure.
    const prewetD  = clamp(Math.round(satD * 0.4), 3, 8);
    const compD    = clamp(Math.round(satD * 0.35 + 1), 2, 7);
    const rampD    = clamp(Math.round(4 + clarGap * 1.5), 3, 7);
    const extrDN   = clamp(Math.round(extrD - 4 + clarGap * 4), 10, 40);
    const nordicP  = clamp(r2(peakP - 2.0 - clarGap * 0.5), 4.5, 8.0);
    const nordicF  = clamp(r2(mainF + 1.0 + clarGap * 0.5), 2.2, 6.5);
    const prewetF  = clamp(r1(nordicF * 0.65), 1.5, 4.0);
    const compEndP = clamp(r2(2.5 + gap('Acidity') * 0.3), 2.0, 4.0);

    jsonPhases = [
      { name:'Prewet', phase:'preinfusion', valve:1, duration:prewetD, temperature:r1(T0+0.3),
        transition:{type:'instant',duration:0,adaptive:false},
        pump:{target:'flow',pressure:0,flow:prewetF},
        targets:[{type:'water_pumped',operator:'gte',value:100},{type:'pressure',operator:'gte',value:0.6}] },
      { name:'Compress', phase:'preinfusion', valve:1, duration:compD, temperature:r1(T0+0.2),
        transition:{type:'instant',duration:0,adaptive:false},
        pump:{target:'pressure',pressure:compEndP,flow:0},
        targets:[{type:'water_pumped',operator:'gte',value:100},{type:'flow',operator:'lte',value:3.0}] },
      { name:'Ramp', phase:'brew', valve:1, duration:rampD, temperature:r1(T0),
        transition:{type:'instant',duration:0,adaptive:true},
        pump:{target:'flow',pressure:nordicP,flow:nordicF},
        targets:[{type:'water_pumped',operator:'gte',value:100},{type:'pressure',operator:'gte',value:r2(nordicP-0.5)}] },
      { name:'Flow Extraction', phase:'brew', valve:1, duration:extrDN, temperature:r1(T0),
        transition:{type:'instant',duration:0,adaptive:true},
        pump:{target:'flow',pressure:r2(nordicP+0.5),flow:nordicF},
        targets:[{type:'volumetric',operator:'gte',value:r1(yv)}] },
    ];

  } else if (arch === 'Turbo Shot') {
    // Minimal preinfusion, immediate high flow, fast lower-pressure extraction.
    // Short, bright, high-clarity. Works best with medium+ grind and light/medium roasts.
    // Pressure is cut well below the archetype baseline (not just a token -0.3 bar) so
    // Turbo reads as a genuinely lower-pressure, flow-led shot rather than a fast version
    // of a classic 9-bar profile — see barista-model.md's Turbo Shot guidance.
    const piD    = clamp(Math.round(satD * 0.3 + 1), 2, 5);
    const rampD  = clamp(Math.round(3 + gap('Clarity') * 1), 2, 5);
    const turboD = clamp(Math.round(10 + rl * 1.5), 8, 24);
    const turboP = clamp(r2(peakP - 1.5), 5.5, 9.0);
    const turboF = clamp(r2(mainF + 1.8 + clarGap * 0.5), 3.5, 7.0);
    const fillF  = clamp(r1(turboF * 0.8), 2.5, 6.0);

    jsonPhases = [
      { name:'Quick Fill', phase:'preinfusion', valve:1, duration:piD, temperature:r1(T0+0.2),
        transition:{type:'instant',duration:0,adaptive:false},
        pump:{target:'flow',pressure:0,flow:fillF},
        targets:[{type:'water_pumped',operator:'gte',value:100},{type:'pressure',operator:'gte',value:1.5}] },
      { name:'Ramp', phase:'brew', valve:1, duration:rampD, temperature:r1(T0),
        transition:{type:'instant',duration:0,adaptive:true},
        pump:{target:'pressure',pressure:turboP,flow:turboF},
        targets:[{type:'pressure',operator:'gte',value:r2(turboP-0.4)}] },
      { name:'Turbo Extraction', phase:'brew', valve:1, duration:turboD, temperature:r1(T0),
        transition:{type:'instant',duration:0,adaptive:true},
        pump:{target:'flow',pressure:turboP,flow:turboF},
        targets:[{type:'volumetric',operator:'gte',value:r1(yv)}] },
    ];

  } else if (arch === 'Syrupy Body') {
    // Long saturation with drip rest → aggressive ramp → high sustained pressure →
    // slow flow extraction. Dense, textured, chocolatey mouthfeel.
    const fillD   = clamp(Math.round(satD * 0.35), 3, 8);
    const compD   = clamp(Math.round(satD * 0.30), 2, 7);
    const dripD   = clamp(Math.round(satD * 0.35 + bodyGap * 2), 3, 9);
    const rampD   = clamp(Math.round(5 + bodyGap * 2.5), 4, 10);
    const extrDS  = clamp(Math.round(extrD + bodyGap * 8 + bSyrup * 5), 18, 55);
    const syrupP  = clamp(r2(peakP + 0.8 + bodyGap * 0.3), 7.5, 10.5);
    const syrupF  = clamp(r2(mainF - 0.8 - bodyGap * 0.4), 0.5, 2.8);
    const fillF2  = clamp(r1(syrupF * 2.5 + 1.5), 2.0, 6.5);
    const compP   = clamp(r2(3.5 + bodyGap * 0.5), 2.5, 5.0);

    jsonPhases = [
      { name:'Fill', phase:'preinfusion', valve:1, duration:fillD, temperature:r1(T0+0.3),
        transition:{type:'instant',duration:0,adaptive:false},
        pump:{target:'flow',pressure:0,flow:fillF2},
        targets:[{type:'water_pumped',operator:'gte',value:100},{type:'pressure',operator:'gte',value:1.5}] },
      { name:'Compress', phase:'preinfusion', valve:1, duration:compD, temperature:r1(T0+0.2),
        transition:{type:'instant',duration:0,adaptive:false},
        pump:{target:'pressure',pressure:compP,flow:0},
        targets:[{type:'water_pumped',operator:'gte',value:100},{type:'flow',operator:'lte',value:2.5}] },
      { name:'Drip Soak', phase:'preinfusion', valve:1, duration:dripD, temperature:r1(T0+0.1),
        transition:{type:'instant',duration:0,adaptive:false},
        pump:{target:'pressure',pressure:0.2,flow:0} },
      { name:'Ramp', phase:'brew', valve:1, duration:rampD, temperature:r1(T0),
        transition:{type:'instant',duration:0,adaptive:true},
        pump:{target:'pressure',pressure:syrupP,flow:r1(syrupF*0.6)},
        targets:[{type:'pressure',operator:'gte',value:r2(syrupP-0.5)}] },
      { name:'Body Extraction', phase:'brew', valve:1, duration:extrDS, temperature:r1(T0),
        transition:{type:'instant',duration:0,adaptive:true},
        pump:{target:'pressure',pressure:syrupP,flow:syrupF},
        targets:[{type:'volumetric',operator:'gte',value:r1(yv)}] },
    ];

  } else if (arch === 'Cafe Allrounder') {
    // Balanced profile for versatility. Flow fill → compress → moderate ramp →
    // pressure-held main extraction → light taper. Works across all roasts.
    const fillD   = clamp(Math.round(satD * 0.40), 3, 8);
    const compD   = clamp(Math.round(satD * 0.35), 2, 7);
    const rampD   = clamp(Math.round(5 + rl * 0.3), 4, 8);
    const mainDA  = clamp(Math.round(extrD * 0.65), 10, 32);
    const finDA   = clamp(Math.round(extrD * 0.35), 5, 20);
    const compP   = clamp(r2(2.5 + gap('Acidity') * 0.4), 1.8, 4.0);
    const finP    = clamp(r2(peakP - 1.8 + gap('Body') * 0.3), 4.0, 8.0);
    const fillF2  = clamp(r1(6.5 + gap('Clarity') * 0.5), 4.5, 9.0);

    jsonPhases = [
      { name:'Fill', phase:'preinfusion', valve:1, duration:fillD, temperature:r1(T0+0.3),
        transition:{type:'instant',duration:0,adaptive:false},
        pump:{target:'flow',pressure:0,flow:fillF2},
        targets:[{type:'water_pumped',operator:'gte',value:100}] },
      { name:'Compress', phase:'preinfusion', valve:1, duration:compD, temperature:r1(T0+0.1),
        transition:{type:'instant',duration:0,adaptive:false},
        pump:{target:'pressure',pressure:compP,flow:0},
        targets:[{type:'water_pumped',operator:'gte',value:100},{type:'flow',operator:'lte',value:2.5}] },
      { name:'Ramp', phase:'brew', valve:1, duration:rampD, temperature:r1(T0),
        transition:{type:'instant',duration:0,adaptive:true},
        pump:{target:'pressure',pressure:peakP,flow:r1(mainF*0.6)},
        targets:[{type:'pressure',operator:'gte',value:r2(peakP-0.4)},{type:'volumetric',operator:'gte',value:r1(yv*0.12)}] },
      { name:'Extraction', phase:'brew', valve:1, duration:mainDA, temperature:r1(T0),
        transition:{type:'instant',duration:0,adaptive:true},
        pump:{target:mainF >= 2.5 ? 'flow' : 'pressure',pressure:r2(peakP-0.1),flow:mainF},
        targets:[{type:'volumetric',operator:'gte',value:r1(yv*0.75)}] },
      { name:'Finish', phase:'brew', valve:1, duration:finDA, temperature:r1(T0-0.3),
        transition:{type:'instant',duration:0,adaptive:true},
        pump:{target:'pressure',pressure:finP,flow:r1(mainF*1.1)},
        targets:[{type:'volumetric',operator:'gte',value:r1(yv)}] },
    ];

  } else {
    // Adaptive Dynamic: multi-stage adaptive profile.
    // Flow fill → compress → drip decompression → strong pressurize overshoot →
    // flow-controlled extraction → pressure decline. Maximizes shot adaptability.
    const fillD   = clamp(Math.round(satD * 0.35), 3, 8);
    const satD2   = clamp(Math.round(satD * 0.40), 3, 10);
    const dripD   = clamp(Math.round(satD * 0.25), 2, 6);
    const rampD   = clamp(Math.round(5 + rl * 0.4 + gap('Sweetness') * 1.5), 4, 9);
    const highD   = clamp(Math.round(extrD * 0.45), 8, 28);
    const dropD   = clamp(Math.round(extrD * 0.55), 8, 30);
    const compP   = clamp(r2(2.8 + bodyGap * 0.3), 2.0, 4.5);
    const overshP = clamp(r2(peakP + 1.2), 7.5, 11.5);

    jsonPhases = [
      { name:'Prefill', phase:'preinfusion', valve:1, duration:fillD, temperature:r1(T0+0.3),
        transition:{type:'instant',duration:0,adaptive:false},
        pump:{target:'flow',pressure:0,flow:8},
        targets:[{type:'water_pumped',operator:'gte',value:100}] },
      { name:'Fill', phase:'preinfusion', valve:1, duration:satD2, temperature:r1(T0+0.1),
        transition:{type:'instant',duration:0,adaptive:false},
        pump:{target:'flow',pressure:0,flow:8},
        targets:[{type:'water_pumped',operator:'gte',value:100},{type:'pressure',operator:'gte',value:3}] },
      { name:'Compressing', phase:'preinfusion', valve:1, duration:Math.round(satD2*0.5), temperature:r1(T0),
        transition:{type:'instant',duration:0,adaptive:false},
        pump:{target:'pressure',pressure:compP,flow:0},
        targets:[{type:'flow',operator:'lte',value:3}] },
      { name:'Dripping', phase:'preinfusion', valve:1, duration:dripD, temperature:r1(T0),
        transition:{type:'instant',duration:0,adaptive:false},
        pump:{target:'pressure',pressure:0.1,flow:0} },
      { name:'Pressurize', phase:'brew', valve:1, duration:rampD, temperature:r1(T0),
        transition:{type:'instant',duration:0,adaptive:true},
        pump:{target:'pressure',pressure:overshP,flow:r1(mainF*0.7)},
        targets:[{type:'water_pumped',operator:'gte',value:100},{type:'pressure',operator:'gte',value:r2(peakP-0.3)},{type:'volumetric',operator:'gte',value:r1(yv*0.15)}] },
      { name:'Extraction', phase:'brew', valve:1, duration:highD+dropD, temperature:r1(T0),
        transition:{type:'instant',duration:0,adaptive:true},
        pump:{target:'flow',pressure:r2(peakP-0.2),flow:mainF},
        targets:[{type:'water_pumped',operator:'gte',value:100},{type:'volumetric',operator:'gte',value:r1(yv)}] },
    ];
  }

  // Apply holistic transitions AFTER all phases are constructed and final
  // pressure/flow values are known — the classifier needs full phase context.
  jsonPhases = applyHolisticTransitions(jsonPhases, predictedBp);

  // Bluetooth scale mode:
  // - intermediate volumetric targets keep using the desired final yield as their reference;
  // - only the LAST volumetric target becomes the compensated pump-stop target;
  // - without a scale, all volumetric targets are removed and phase duration remains the fallback.
  if (hasBluetoothScale) {
    let finalVolumetricPhase = -1;
    for (let i = jsonPhases.length - 1; i >= 0; i--) {
      if (Array.isArray(jsonPhases[i].targets) && jsonPhases[i].targets.some(t => t.type === 'volumetric')) {
        finalVolumetricPhase = i;
        break;
      }
    }
    if (finalVolumetricPhase >= 0) {
      jsonPhases = jsonPhases.map((ph, phaseIndex) => {
        if (phaseIndex !== finalVolumetricPhase || !Array.isArray(ph.targets)) return ph;
        let lastVolumetricIndex = -1;
        ph.targets.forEach((t, targetIndex) => { if (t.type === 'volumetric') lastVolumetricIndex = targetIndex; });
        return {
          ...ph,
          targets: ph.targets.map((t, targetIndex) =>
            t.type === 'volumetric' && targetIndex === lastVolumetricIndex
              ? { ...t, value: scaleStopYield }
              : t
          )
        };
      });
    }
  } else {
    jsonPhases = jsonPhases.map(ph => {
      if (!Array.isArray(ph.targets)) return ph;
      const targets = ph.targets.filter(t => t.type !== 'volumetric');
      const next = { ...ph };
      if (targets.length) next.targets = targets;
      else delete next.targets;
      return next;
    });
  }

  const curve = buildCurveFromJsonPhases(jsonPhases);
  const totalDuration = jsonPhases.reduce((acc, ph) => acc + (Number(ph.duration) || 0), 0);

  return {
    baseTemp: T0, total: totalDuration, curve: curve, peakP: peakP, mainF: mainF, yv: yv, scaleStopYield: scaleStopYield, scaleCoastCompensation: scaleCoastCompensation, archTend: archTend, predictedBp: predictedBp,
    json: {
      id: profileId || `${arch.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').slice(0, 16)}-${(Date.now() % 10000).toString(36)}`,
      label: profileLabel || `${arch} (${ROAST_LABELS[rl]})`,
      description: profileDescription || `Generated for ${ROAST_LABELS[rl]} roast, ${AGE_LABELS[ra]} age profile via engine layout.`,
      tank_profile: false, preheat_temperature: Math.round(T0 + 1.5), phases: jsonPhases
    }
  };
}

function buildCurveFromJsonPhases(jsonPhases) {
  if (!Array.isArray(jsonPhases) || !jsonPhases.length) return [];

  const easeFns = {
    'instant':     () => 1,
    'linear':      x => x,
    'ease-out':    x => 1 - Math.pow(1 - x, 2),
    'ease-in':     x => x * x,
    'ease-in-out': x => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2,
  };

  const curve = [];
  let t = 0;
  let prevP = 0;
  let prevF = 0;

  const pushPoint = (time, pressure, flow) => {
    const point = {
      t: +time.toFixed(2),
      p: +Math.max(0, pressure).toFixed(2),
      fl: +Math.max(0, flow).toFixed(2),
    };
    const last = curve[curve.length - 1];
    if (last && last.t === point.t && last.p === point.p && last.fl === point.fl) return;
    curve.push(point);
  };

  jsonPhases.forEach(ph => {
    const duration = Math.max(0, Number(ph.duration) || 0);
    const targetP = Number(ph.pump?.pressure) || 0;
    const targetF = Number(ph.pump?.flow) || 0;
    const transitionType = ph.transition?.type ?? 'instant';
    const transitionDuration = clamp(Number(ph.transition?.duration) || 0, 0, duration);
    const ease = easeFns[transitionType] ?? easeFns.linear;

    // A phase transition moves from the previous JSON pump settings to this
    // phase's pump settings only during transition.duration.
    if (transitionType === 'instant' || transitionDuration <= 0) {
      pushPoint(t, prevP, prevF);
      pushPoint(t, targetP, targetF);
    } else {
      const samples = Math.max(2, Math.ceil(transitionDuration * 4)); // 0.25 s resolution
      for (let i = 0; i <= samples; i++) {
        const frac = i / samples;
        const shaped = ease(frac);
        pushPoint(
          t + frac * transitionDuration,
          prevP + (targetP - prevP) * shaped,
          prevF + (targetF - prevF) * shaped
        );
      }
    }

    // The remaining phase time is a hold at the exact JSON pump settings.
    if (duration > transitionDuration) {
      pushPoint(t + duration, targetP, targetF);
    }

    t += duration;
    prevP = targetP;
    prevF = targetF;
  });

  return curve;
}

/* Shared holistic transition engine. */
function classifyPhaseRole(ph, phases, idx) {
  if (!ph) return 'NONE';

  const p = ph.pump?.pressure ?? 0;
  const f = ph.pump?.flow ?? 0;
  const prevP = idx > 0 ? (phases[idx - 1]?.pump?.pressure ?? p) : p;

  if (ph.phase === 'preinfusion') {
    const isFlowFill = ph.pump?.target === 'flow' && f > 2;

    // Near-zero pressure / near-zero flow preinfusion is a true soak or drip-rest.
    // Check this BEFORE the generic low-pressure fill branch so SOAK is reachable.
    if (p <= 0.5 && f <= 1.0) return 'SOAK';
    if (isFlowFill) return 'FILL';
    if (p < 1.5) return 'FILL';
    return 'COMPRESS';
  }

  // Brew phase classification must be based on the actual pressure trajectory,
  // not on the transition type that this classifier is about to generate.
  if (ph.pump?.target === 'off' || p < 2) return 'TAIL';

  const fallingFromPrev = idx > 0 && p < prevP - 0.3;

  if (p < 5) return 'TAIL';
  if (fallingFromPrev) return 'DECLINE';
  return 'PEAK';
}

function deriveTransitionForPhase(ph, phIdx, allPhases, flavour) {
  const prevRole = classifyPhaseRole(allPhases[phIdx - 1], allPhases, phIdx - 1);
  const currRole = classifyPhaseRole(ph, allPhases, phIdx);
  const isFirst  = phIdx === 0;

  // Flavour scores (0–1 range) that shape transition aggressiveness
  const clarity   = (flavour.Clarity    ?? 5) / 10;
  const sweetness = (flavour.Sweetness  ?? 5) / 10;
  const body      = (flavour.Body       ?? 5) / 10;
  const acidity   = (flavour.Acidity    ?? 5) / 10;
  const floral    = (flavour.Floral     ?? 5) / 10;

  // Pressure delta from the previous phase — large swings need shaped curves
  const currP = ph.pump?.pressure ?? 0;
  const prevP = (allPhases[phIdx - 1]?.pump?.pressure) ?? currP;
  const deltaFromPrev = currP - prevP;

  // --- RULE TABLE ---
  // Each rule returns { type, duration, adaptive }

  // 1. Very first phase always starts gently
  if (isFirst) {
    return { type: 'ease-out', duration: Math.min(3, Math.round(ph.duration * 0.4)), adaptive: false };
  }

  // 2. FILL → FILL: same-phase flow continuation — instant, no ramp needed
  if (prevRole === 'FILL' && currRole === 'FILL') {
    return { type: 'instant', duration: 0, adaptive: false };
  }

  // 3. FILL → COMPRESS: start compressing the puck — ease-out (fast initial bite, smooth settle)
  if (prevRole === 'FILL' && currRole === 'COMPRESS') {
    return { type: 'ease-out', duration: Math.min(2, Math.round(ph.duration * 0.3)), adaptive: false };
  }

  // 4. Any preinfusion → SOAK/drip: pump drops to near-zero — ease-out (smooth decompression)
  if (currRole === 'SOAK' && ph.phase === 'preinfusion') {
    return { type: 'ease-out', duration: Math.min(2, Math.round(ph.duration * 0.5)), adaptive: true };
  }

  // 5. COMPRESS/SOAK → RAMP or start of brew (preinfusion → brew boundary)
  if ((prevRole === 'COMPRESS' || prevRole === 'SOAK' || prevRole === 'FILL') &&
      (currRole === 'PEAK' || currRole === 'DECLINE') &&
      ph.phase === 'brew') {
    // Big pressure swing from preinfusion to brew peak — S-curve for smooth onset
    const dur = clamp(Math.round(ph.duration * 0.5 + (clarity - 0.5) * 2), 3, Math.min(ph.duration, 12));
    return { type: 'ease-in-out', duration: dur, adaptive: true };
  }

  // 6. PEAK → PEAK (two sustained high-pressure phases in a row): instant or very short linear
  if (prevRole === 'PEAK' && currRole === 'PEAK') {
    const bigSwing = Math.abs(deltaFromPrev) > 1.5;
    if (bigSwing) return { type: 'linear', duration: Math.round(ph.duration * 0.25), adaptive: true };
    return { type: 'instant', duration: 0, adaptive: true };
  }

  // 7. PEAK → DECLINE (extraction peak then pressure decay):
  //    sweetness/body → ease-in-out (long, smooth decay preserves sweetness)
  //    clarity/acidity → linear (direct decline keeps brightness)
  if (prevRole === 'PEAK' && (currRole === 'DECLINE' || currRole === 'TAIL')) {
    const syrupy = (sweetness + body) / 2;
    if (syrupy > 0.6) {
      const dur = clamp(Math.round(ph.duration * 0.6 + sweetness * 4), 4, Math.min(ph.duration, 20));
      return { type: 'ease-in-out', duration: dur, adaptive: true };
    }
    const dur = clamp(Math.round(ph.duration * 0.4 + clarity * 3), 3, Math.min(ph.duration, 14));
    return { type: 'linear', duration: dur, adaptive: true };
  }

  // 8. DECLINE → DECLINE: continuing decay — linear, duration scaled to remaining time
  if (prevRole === 'DECLINE' && currRole === 'DECLINE') {
    return { type: 'linear', duration: Math.round(ph.duration * 0.5), adaptive: true };
  }

  // 9. DECLINE → TAIL: the tail finish — ease-out (soft end, preserve floral/acidity)
  if ((prevRole === 'DECLINE' || prevRole === 'PEAK') && currRole === 'TAIL') {
    const aromatic = (floral + acidity) / 2;
    if (aromatic > 0.55) return { type: 'ease-out', duration: Math.min(3, ph.duration), adaptive: true };
    return { type: 'linear', duration: Math.min(4, ph.duration), adaptive: true };
  }

  // 10. COMPRESS → COMPRESS: gradual puck saturation — ease-out (soft settle)
  if (prevRole === 'COMPRESS' && currRole === 'COMPRESS') {
    return { type: 'ease-out', duration: Math.min(2, Math.round(ph.duration * 0.4)), adaptive: false };
  }

  // 11. Within-brew moderate transitions (e.g. flow adjustments at sustained pressure)
  if (ph.phase === 'brew' && prevRole === 'PEAK' && currRole === 'PEAK') {
    return { type: 'linear', duration: Math.min(3, Math.round(ph.duration * 0.3)), adaptive: true };
  }

  // Fallback: linear with moderate duration
  const fallDur = clamp(Math.round(ph.duration * 0.35), 1, 6);
  return { type: 'linear', duration: fallDur, adaptive: ph.phase === 'brew' };
}

// Applies the holistic transition system across an entire phases array,
// respecting the full context of prev/curr/next for every phase.
function applyHolisticTransitions(phases, flavour) {
  return phases.map((ph, i) => ({
    ...ph,
    transition: deriveTransitionForPhase(ph, i, phases, flavour)
  }));
}

  return {
    ENGINE_VERSION,
    ROAST_LABELS, AGE_LABELS, BASE_PROCESSING, FERMENTATIONS,
    PROCESS_FLAVOUR_DEFAULTS, FERMENTATION_FLAVOUR_BIASES,
    ROAST_FLAVOUR_BIASES, AGE_FLAVOUR_BIASES,
    AXES, ARCHETYPE_TENDencies, ARCHETYPES,
    clamp, r1, r2,
    beanFlavourDefaults,
    recommendedRatio, ratioRecommendationReason,
    archetypeScores, rankedArchetypes, recommendedArchetype,
    buildProfile, buildCurveFromJsonPhases,
    classifyPhaseRole, deriveTransitionForPhase, applyHolisticTransitions
  };

});
