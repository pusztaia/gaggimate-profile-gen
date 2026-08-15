import { useState, useMemo, useRef, useContext, useEffect } from "preact/hooks";
import { ApiServiceContext, machine } from '../../services/ApiService';

import {
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  TimeScale,
} from 'chart.js';
import 'chartjs-adapter-dayjs-4/dist/chartjs-adapter-dayjs-4.esm';
import { ExtendedProfileChart } from '../../components/ExtendedProfileChart.jsx';
import { ExtendedRadarChart } from '../../components/RadarChart.jsx';
import { computed } from '@preact/signals';
import './profile-engine.js';
// Register chart components
Chart.register(
  LineController,
  TimeScale,
  LinearScale,
  CategoryScale,
  PointElement,
  LineElement,
  Filler,
  Legend,
);
const connected = computed(() => machine.value.connected);

// ─── Design Tokens ────────────────────────────────────────────────
const T = {
  bg:       'var(--color-base-100)',
  surf:     'var(--color-base-200)',
  panel:    'var(--color-base-200)',
  card:     'var(--color-base-300)',
  border:   'color-mix(in srgb, var(--color-base-content) 10%, transparent)',
  borderHi: 'color-mix(in srgb, var(--color-base-content) 18%, transparent)',
  text:     'var(--color-base-content)',
  muted:    'color-mix(in srgb, var(--color-base-content) 55%, transparent)',
  dim:      'color-mix(in srgb, var(--color-base-content) 35%, transparent)',
  accent:   'var(--color-accent)',
  accentLt: 'var(--color-accent-content, var(--color-accent))',
  accentBg: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
  accentBd: 'color-mix(in srgb, var(--color-accent) 38%, transparent)',
  brown:     'var(--statistics-trend-shots-brown)',

  blue:     'var(--analyzer-pressure-text)',
  orange:   'var(--analyzer-temp-text)',
  purple:   'var(--color-secondary)',
  green:    'var(--analyzer-flow-text)'
};
const MONO = { fontFamily: 'ui-monospace, "Cascadia Code", monospace' };

// ─── Shared Profile Engine ───────────────────────────────────────
const engine = globalThis.GaggiMateProfileEngine;
if (!engine) throw new Error('GaggiMateProfileEngine failed to load.');
const {
  ROAST_LABELS, AGE_LABELS, BASE_PROCESSING, FERMENTATIONS, AXES,
  ARCHETYPES,
  clamp, r1, r2, beanFlavourDefaults, recommendedRatio,
  ratioRecommendationReason, rankedArchetypes, recommendedArchetype,
  buildProfile, applyHolisticTransitions
} = engine;

const PHASE_TYPES      = ['preinfusion', 'brew', 'decline'];
const PUMP_TARGETS     = ['pressure', 'flow', 'power', 'off'];
const TRANSITION_TYPES = ['instant', 'linear', 'ease-in', 'ease-out', 'ease-in-out'];
const STOP_TYPES       = ['volumetric', 'water_pumped', 'pressure', 'flow'];
const OPERATORS        = ['gte', 'lte', 'gt', 'lt'];
const DEFAULT_SAVED_PROFILES = [
  { id: 'def_1', title: 'Gentle Decline Signature', description: 'Classic profiling map focusing on high clarity extractions.', target_temperature: 93.5, phases: [{ name: 'Prewet', phase: 'preinfusion', duration: 6, temperature: 94.0, pump: { target: 'flow', pressure: 0, flow: 4.0 } }, { name: 'Main Brew', phase: 'brew', duration: 22, temperature: 93.2, pump: { target: 'pressure', pressure: 8.5, flow: 2.2 } }] }
];
function HDivider({ label }) {
  return (
    <div style={{ display:'flex', alignItems:'center', margin:'10px 0', gap:10 }}>
      <span class="label" style={{ fontSize:10, fontWeight:'bold', textTransform:'uppercase', whiteSpace:'nowrap' }}>{label}</span>
    </div>
  );
}

// Profile generation, flavour defaults, recommendations, transitions and JSON curve
// are provided by the shared profile-engine.js above.

function importedReferenceYield(phases) {
  const values = (phases ?? [])
    .flatMap(ph => ph.targets ?? [])
    .filter(t => t.type === 'volumetric' && Number.isFinite(+t.value))
    .map(t => +t.value);
  return values.length ? Math.max(...values) : 0;
}

function applyParams(phases, {
  baseTemp, targetTemp, refTemp, durMult, refDurMult,
  referenceYield, targetYield, scaleStopYield, hasBluetoothScale,
  flavourProfile,
  targetPeakP, refPeakP, targetMainF, refMainF,
  overwriteFlags = { pressure: true, flow: true, temperature: true, transitions: true }
}) {
  if (!phases || !phases.length) return phases;

  const pressScale = refPeakP   > 0 ? targetPeakP / refPeakP   : 1;
  const flowScale  = refMainF   > 0 ? targetMainF / refMainF   : 1;
  const durScale   = refDurMult > 0 ? durMult     / refDurMult : 1;
  const tempDelta  = targetTemp - refTemp;

  const brewPhases  = phases.filter(p => p.phase === 'brew');
  const importPeak  = brewPhases.length ? Math.max(...brewPhases.map(p => p.pump?.pressure ?? 0)) : 9.0;
  const FILL_THRESH = importPeak * 0.30;

  let result = phases.map(ph => {
    const isFill = ph.phase === 'preinfusion' && (ph.pump?.pressure ?? 0) < FILL_THRESH;

    // Temperature
    let newTemp = ph.temperature ?? baseTemp;
    if (overwriteFlags.temperature) {
      const phOffset = (ph.temperature ?? baseTemp) - baseTemp;
      newTemp = parseFloat(clamp(baseTemp + tempDelta + phOffset, 80, 98).toFixed(1));
    }

    // Duration is independent from beverage yield. Imported phase timing is
    // transformed only by the explicit duration scale, never by flavour/yield math.
    const newDur = Math.max(1, Math.round((ph.duration ?? 5) * durScale));

    // Pump
    let newPump = { ...ph.pump };
    if (ph.pump) {
      if (overwriteFlags.pressure) {
        newPump.pressure = isFill
          ? ph.pump.pressure
          : parseFloat(clamp((ph.pump.pressure ?? 0) * pressScale, 0, 12).toFixed(2));
      }
      if (overwriteFlags.flow && (ph.pump.flow ?? 0) > 0) {
        newPump.flow = parseFloat(clamp(ph.pump.flow * flowScale, 0, 9).toFixed(2));
      }
    }

    // Targets. Beverage yield is never derived from flavour values.
    // Intermediate scale targets preserve their original fraction of the imported
    // profile's final yield and are rebased to the currently selected Dose × Ratio.
    const newTargets = (ph.targets ?? []).flatMap(tgt => {
      if (tgt.type === 'volumetric') {
        if (!hasBluetoothScale) return [];
        const ref = referenceYield > 0 ? referenceYield : targetYield;
        const origV = Number.isFinite(+tgt.value) ? +tgt.value : ref;
        const frac = ref > 0 ? clamp(origV / ref, 0, 1) : 1;
        return [{ ...tgt, value: r1(targetYield * frac) }];
      }
      if (tgt.type === 'pressure' && !isFill && overwriteFlags.pressure) {
        return [{ ...tgt, value: parseFloat(clamp((tgt.value ?? 0) * pressScale, 0, 12).toFixed(2)) }];
      }
      if (tgt.type === 'flow' && !isFill && overwriteFlags.flow) {
        return [{ ...tgt, value: parseFloat(clamp((tgt.value ?? 0) * flowScale, 0, 9).toFixed(2)) }];
      }
      return [tgt];
    });

    const next = { ...ph, temperature: newTemp, duration: newDur, pump: newPump };
    if (newTargets.length) next.targets = newTargets;
    else delete next.targets;
    return next;
  });

  // Apply the shared Bluetooth coast compensation to the LAST volumetric target
  // only. Earlier targets remain proportional phase-change markers.
  if (hasBluetoothScale) {
    let lastPhaseIndex = -1;
    let lastTargetIndex = -1;
    result.forEach((ph, phaseIndex) => {
      (ph.targets ?? []).forEach((tgt, targetIndex) => {
        if (tgt.type === 'volumetric') {
          lastPhaseIndex = phaseIndex;
          lastTargetIndex = targetIndex;
        }
      });
    });
    if (lastPhaseIndex >= 0) {
      result = result.map((ph, phaseIndex) => {
        if (phaseIndex !== lastPhaseIndex) return ph;
        return {
          ...ph,
          targets: ph.targets.map((tgt, targetIndex) =>
            targetIndex === lastTargetIndex
              ? { ...tgt, value: r1(scaleStopYield ?? targetYield) }
              : tgt
          )
        };
      });
    }
  }

  // Apply holistic transitions AFTER all pressure/flow values are resolved,
  // so the role classifier sees the final values for the whole profile.
  if (overwriteFlags.transitions) {
    result = applyHolisticTransitions(result, flavourProfile);
  }

  return result;
}

// ─── Sub-Vector Graphical Renderers ───────────────────────────────
function ExtractionCurve({ curve }) {
  if(!curve.phases || !curve.phases.length) return null;

  return (
    <div style={{ width: '100%', padding: '6px 4px 2px' }}>
      <ExtendedProfileChart data={curve} className='max-h-36' />
    </div>
  );
}

function PhaseRow({ ph, pIdx, updatePhase, removePhase, movePhase, totalPhases }) {
  return (
    <details class="collapse collapse-arrow bg-base-200 border border-base-content/10 rounded-box mb-2">
      <summary class="collapse-title font-medium flex items-center justify-between pr-12 py-3 min-h-0">
        <div class="flex items-center gap-2">
          <span class="badge badge-sm badge-outline opacity-70 font-mono">#{pIdx+1}</span>
          <span class="font-bold">{ph.name || `Unnamed Phase`}</span>
          <span class="text-xs opacity-60 font-mono">({ph.phase || 'brew'}, {ph.duration ?? 0}s)</span>
        </div>
        <div class="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          <button type="button" class="btn btn-xs btn-ghost" disabled={pIdx === 0} onClick={() => movePhase(pIdx, -1)}>↑</button>
          <button type="button" class="btn btn-xs btn-ghost" disabled={pIdx === totalPhases - 1} onClick={() => movePhase(pIdx, 1)}>↓</button>
          <button type="button" class="btn btn-xs btn-error btn-outline ml-1" onClick={() => removePhase(pIdx)}>✕</button>
        </div>
      </summary>
      <div class="collapse-content space-y-4 pt-2 border-t border-base-content/5">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label class="label label-text p-1 text-xs opacity-70">Phase Name</label>
            <input type="text" value={ph.name || ''} class="input input-sm input-bordered w-full" onInput={e => updatePhase(pIdx, { name: e.target.value })} />
          </div>
          <div>
            <label class="label label-text p-1 text-xs opacity-70">Phase Type</label>
            <select value={ph.phase || 'brew'} class="select select-sm select-bordered w-full text-sm" onChange={e => updatePhase(pIdx, { phase: e.target.value })}>
              {PHASE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label class="label label-text p-1 text-xs opacity-70">Duration (sec)</label>
            <input type="number" step="1" min="0" value={ph.duration ?? 5} class="input input-sm input-bordered w-full font-mono" onInput={e => updatePhase(pIdx, { duration: parseInt(e.target.value) || 0 })} />
          </div>
        </div>
        <div class="p-3 bg-base-300 rounded-lg space-y-3 border border-base-content/5">
          <span class="text-xs font-bold uppercase tracking-wider opacity-60">Pump Target Control</span>
          <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label class="label label-text p-1 text-xs opacity-70">Control Mode</label>
              <select value={ph.pump?.target || 'pressure'} class="select select-sm select-bordered w-full text-xs" onChange={e => updatePhase(pIdx, { pump: { ...ph.pump, target: e.target.value } })}>
                {PUMP_TARGETS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label class="label label-text p-1 text-xs opacity-70">Pressure Target (bar)</label>
              <input type="number" step="0.1" min="0" max="13" value={ph.pump?.pressure ?? 0} class="input input-sm input-bordered w-full font-mono" disabled={ph.pump?.target === 'off' || ph.pump?.target === 'flow'} onInput={e => updatePhase(pIdx, { pump: { ...ph.pump, pressure: parseFloat(e.target.value) || 0 } })} />
            </div>
            <div>
              <label class="label label-text p-1 text-xs opacity-70">Flow Limit (ml/s)</label>
              <input type="number" step="0.1" min="0" max="10" value={ph.pump?.flow ?? 0} class="input input-sm input-bordered w-full font-mono" disabled={ph.pump?.target === 'off' || ph.pump?.target === 'power'} onInput={e => updatePhase(pIdx, { pump: { ...ph.pump, flow: parseFloat(e.target.value) || 0 } })} />
            </div>
            <div>
              <label class="label label-text p-1 text-xs opacity-70">Temperature (°C)</label>
              <input type="number" step="0.1" min="70" max="102" value={ph.temperature ?? 93} class="input input-sm input-bordered w-full font-mono" onInput={e => updatePhase(pIdx, { temperature: parseFloat(e.target.value) || 93 })} />
            </div>
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label class="label label-text p-1 text-xs opacity-70">Transition Shape</label>
            <select value={ph.transition?.type || 'linear'} class="select select-sm select-bordered w-full text-xs" onChange={e => updatePhase(pIdx, { transition: { ...ph.transition, type: e.target.value } })}>
              {TRANSITION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div class="flex items-center gap-4 px-2 h-full mt-4">
            <label class="cursor-pointer flex items-center gap-2 select-none text-xs font-medium">
              <input type="checkbox" checked={!!ph.transition?.adaptive} class="checkbox checkbox-xs checkbox-primary" onChange={e => updatePhase(pIdx, { transition: { ...ph.transition, adaptive: e.target.checked } })} />
              Adaptive Ramp
            </label>
            <label class="cursor-pointer flex items-center gap-2 select-none text-xs font-medium">
              <input type="checkbox" checked={ph.valve === 0} class="checkbox checkbox-xs" onChange={e => updatePhase(pIdx, { valve: e.target.checked ? 0 : 1 })} />
              Close Valve
            </label>
          </div>
        </div>
        <div class="p-3 bg-base-300 rounded-lg space-y-2 border border-base-content/5">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold uppercase tracking-wider opacity-60">Phase Cut-off Targets (OR)</span>
            <button type="button" class="btn btn-xs btn-outline btn-ghost" onClick={() => { const arr = [...(ph.targets || [])]; arr.push({ type: 'volumetric', operator: 'gte', value: 0 }); updatePhase(pIdx, { targets: arr }); }}>+ Add Target</button>
          </div>
          {(ph.targets || []).map((tgt, tIdx) => (
            <div key={tIdx} class="flex items-center gap-2p-2 rounded border border-base-content/5">
              <select value={tgt.type || 'volumetric'} class="select select-xs select-bordered text-xs" onChange={e => { const arr = [...ph.targets]; arr[tIdx] = { ...arr[tIdx], type: e.target.value }; updatePhase(pIdx, { targets: arr }); }}>
                {STOP_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={tgt.operator || 'gte'} class="select select-xs select-bordered text-xs" onChange={e => { const arr = [...ph.targets]; arr[tIdx] = { ...arr[tIdx], operator: e.target.value }; updatePhase(pIdx, { targets: arr }); }}>
                {OPERATORS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              <input type="number" step="any" value={tgt.value ?? 0} class="input input-xs input-bordered w-24 font-mono text-xs" onInput={e => { const arr = [...ph.targets]; arr[tIdx] = { ...arr[tIdx], value: parseFloat(e.target.value) || 0 }; updatePhase(pIdx, { targets: arr }); }} />
              <button type="button" class="btn btn-xs btn-square btn-ghost ml-auto text-error" onClick={() => { const arr = ph.targets.filter((_, i) => i !== tIdx); updatePhase(pIdx, { targets: arr }); }}>✕</button>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}

// ─── MAIN COMPONENT DECK ──────────────────────────────────────────
export default function AdvancedProfileDesigner() {
  const apiService = useContext(ApiServiceContext);
  
  // Left side Control Panel Tabs
  const [leftTab, setLeftTab] = useState('variables');
  const [rightTab, setRightTab] = useState('engine');
  const [aiMsg, setAiMsg] = useState('');
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  // Coffee / shot controls shared with the standalone generator.
  const [rl, setRl] = useState(2);
  const [ra, setRa] = useState(1);
  const [baseProcess, setBaseProcess] = useState('Washed');
  const [fermentation, setFermentation] = useState('None');
  const [ratioTarget, setRatioTarget] = useState(() => recommendedRatio(2, 1, 'Washed', 'None'));
  const [arch, setArch] = useState(() => recommendedArchetype(2, 'Washed', 'None'));
  const [dose, setDose] = useState(18.0);
  const [hasBluetoothScale, setHasBluetoothScale] = useState(false);

  const [profileId, setProfileId] = useState('');
  const [profileLabel, setProfileLabel] = useState('');
  const [profileDescription, setProfileDescription] = useState('');

  // API key stored in cookie, never in server/device state
  const readKeyCookie = () => { const m = document.cookie.match(/(?:^|; )gm_ai_key=([^;]*)/); return m ? decodeURIComponent(m[1]) : ''; };
  const writeKeyCookie = k => { document.cookie = `gm_ai_key=${encodeURIComponent(k)}; path=/; max-age=${60*60*24*365}; SameSite=Strict`; };
  const clearKeyCookie = () => { document.cookie = 'gm_ai_key=; path=/; max-age=0'; };
  const [apiKey, setApiKey] = useState(() => readKeyCookie());
  const [showKey, setShowKey] = useState(false);

  // Bean baseline is generated by the shared engine; Intended Cup remains independently editable.
  const [beanBp, setBeanBp] = useState(() => beanFlavourDefaults(2, 1, 'Washed', 'None'));
  const [cupBp, setCupBp] = useState(() => beanFlavourDefaults(2, 1, 'Washed', 'None'));
  const previousBeanBpRef = useRef(beanFlavourDefaults(2, 1, 'Washed', 'None'));
  const [visibleSpiders, setVisibleSpiders] = useState({ bean: true, cup: true, arch: true, final: true });

  // Saved Manifest Registries
  const [storedProfiles, setStoredProfiles] = useState(DEFAULT_SAVED_PROFILES);
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [profileMeta, setProfileMeta] = useState({ id: 'sim_1', title: 'Phases', description: 'Generated matrix engine rules.' });

  // ── Overwrite dimension selector ────────────────────────────────
  // Controls which parameter dimensions applyParams will rewrite when
  // transforming an imported/base profile with the current engine params.
  const [overwriteFlags, setOverwriteFlags] = useState({ pressure: true, flow: true, temperature: true, transitions: true });
  const toggleOverwrite = key => setOverwriteFlags(prev => ({ ...prev, [key]: !prev[key] }));

  // ── Two-layer profile architecture ──────────────────────────────
  const [basePhases, setBasePhases]   = useState(null);
  const [baseTempRef, setBaseTempRef] = useState(null);
  const [editPhases, setEditPhases]   = useState(null);

  // Engine always recomputes from shared coffee/profile inputs.
  const profile = useMemo(() => {
    return buildProfile({
      rl, ra, baseProcess, fermentation, ratioTarget, arch, beanBp, cupBp, dose,
      hasBluetoothScale, profileId, profileLabel, profileDescription
    });
  }, [rl, ra, baseProcess, fermentation, ratioTarget, arch, beanBp, cupBp, dose, hasBluetoothScale, profileId, profileLabel, profileDescription]);

  // Rebase Bean Flavour when coffee characteristics change, while preserving
  // the user's Intended Cup delta. Ratio and archetype follow shared recommendations.
  useEffect(() => {
    const previousBean = previousBeanBpRef.current;
    const nextBean = beanFlavourDefaults(rl, ra, baseProcess, fermentation);
    setCupBp(previousCup => Object.fromEntries(AXES.map(axis => {
      const delta = (previousCup[axis] ?? 5) - (previousBean[axis] ?? 5);
      return [axis, clamp(r1((nextBean[axis] ?? 5) + delta), 0, 10)];
    })));
    setBeanBp(nextBean);
    previousBeanBpRef.current = nextBean;
    setRatioTarget(recommendedRatio(rl, ra, baseProcess, fermentation));
    setArch(recommendedArchetype(rl, baseProcess, fermentation));
  }, [rl, ra, baseProcess, fermentation]);

  const rankedArch = useMemo(
    () => rankedArchetypes(rl, baseProcess, fermentation),
    [rl, baseProcess, fermentation]
  );

  // Neutral reference is used only when transforming an imported/base profile.
  const neutralBp = useMemo(() => Object.fromEntries(AXES.map(k => [k, 5])), []);
  const refProfile = useMemo(() => {
    return buildProfile({
      rl: 2, ra: 1, baseProcess: 'Washed', fermentation: 'None',
      ratioTarget: recommendedRatio(2, 1, 'Washed', 'None'), arch,
      beanBp: neutralBp, cupBp: neutralBp, dose: 18, hasBluetoothScale: false,
      profileId: '', profileLabel: '', profileDescription: ''
    });
  }, [arch, neutralBp]);

  const durMult = 1.0;
  const yv = profile.yv;
  const engineTemp = profile.baseTemp;

  // Template: manual edits > imported base > engine phases
  const templatePhases   = editPhases ?? basePhases ?? profile.json.phases;
  const templateBaseTemp = baseTempRef ?? engineTemp;
  const templateReferenceYield = importedReferenceYield(templatePhases);

  // In pure engine mode, params are already baked into profile.json.phases —
  // activePhases IS profile.json.phases, no transformation needed.
  // In import/edit mode, applyParams shifts the base phases using current params.
  const activePhases = (basePhases === null && editPhases === null)
    ? profile.json.phases
    : applyParams(templatePhases, {
        baseTemp:    templateBaseTemp,
        targetTemp:  engineTemp,
        refTemp:     refProfile.baseTemp,
        durMult,
        refDurMult:  1.0,
        referenceYield: templateReferenceYield,
        targetYield: profile.yv,
        scaleStopYield: profile.scaleStopYield,
        hasBluetoothScale,
        flavourProfile: profile.predictedBp,
        targetPeakP: profile.peakP,
        refPeakP:    refProfile.peakP,
        targetMainF: profile.mainF,
        refMainF:    refProfile.mainF,
        overwriteFlags,
      });

  const loadProfiles = async () => {
    const response = await apiService.request({ tp: 'req:profiles:list' });
    setStoredProfiles(response.profiles);
  };
  useEffect(() => {
    const fetchHardwareProfiles = async () => {
      if (!connected.value) return;
      setLoadingProfiles(true);
      try {
        await loadProfiles();
      } catch (err) {
        console.error("Failed querying GaggiMate profile index:", err);
      } finally {
        setLoadingProfiles(false);
      }
    }
    fetchHardwareProfiles();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected.value]);
function normalizeProfile(p) {
  return {
    id: p.id ?? `import-${Date.now()}`,
    label: p.label ?? p.title ?? 'Imported Profile',
    description: p.description ?? '',
    phases: (p.phases ?? []).map(ph => ({
      ...ph,
      targets: ph.targets ? [...ph.targets] : []
    })),
    type: p.type ?? 'pro',
    temperature: p.temperature ?? p.preheat_temperature ?? 93
  };
}
  // Restores balance by filling both spiders contextually when importing a flat profile
  function importProfile(p) {
    const imported = normalizeProfile(p);

    // Detect reference temperature from the imported profile
    let detectedTemp = imported.temperature ?? 93.0;
    if (p.phases && p.phases.length) {
      const brewPhases = p.phases.filter(ph => ph.phase === 'brew');
      const srcPhases  = brewPhases.length ? brewPhases : p.phases;
      detectedTemp = srcPhases[0].temperature ?? detectedTemp;
    }

    // Store as the immutable base template
    setBasePhases(imported.phases);
    setProfileMeta({...profileMeta, title : p.label ?? p.id ?? 'Imported Profile'});
    setBaseTempRef(detectedTemp);
    
    setEditPhases(imported.phases);

    // Sync metadata fields
    if (p.label)       { setProfileLabel(p.label); }
    if (p.description) { setProfileDescription(p.description); }
    if (p.id)          { setProfileId(p.id); }

    // Infer parameters from the profile so sliders reflect it
    let detectedPeakP = 9.0;
    if (p.phases && p.phases.length) {
      const brewPhases = p.phases.filter(ph => ph.phase === 'brew');
      const srcPhases  = brewPhases.length ? brewPhases : p.phases;
      detectedPeakP = Math.max(...srcPhases.map(ph => ph.pump?.pressure ?? 0));
    }
    if (p.preheat_temperature) detectedTemp = p.preheat_temperature - 1.5;

    const inferredRoast = clamp(Math.round((95.5 - detectedTemp) / 1.4), 0, 5);
    setRl(inferredRoast);

/*    setBeanBp({
      Acidity:    clamp(inferredRoast < 2 ? 7 : 4, 1, 10),
      Sweetness:  5,
      Bitterness: clamp(inferredRoast + 1, 1, 10),
      Body:       clamp(detectedPeakP > 9.0 ? 7 : 5, 1, 10),
      Clarity:    5,
      Fruitiness: clamp(6 - inferredRoast, 1, 10),
      Chocolate:  clamp(inferredRoast + 2, 1, 10),
      Roastiness: clamp(inferredRoast * 1.5, 1, 10),
      Crema:      5,
      Floral:     clamp(5 - inferredRoast, 1, 10)
    });

    setCupBp({
      Acidity:    clamp(detectedPeakP < 7.5 ? 8 : 5, 1, 10),
      Sweetness:  p.label?.toLowerCase().includes('sweet') ? 8 : 6,
      Bitterness: clamp(inferredRoast + 2, 1, 10),
      Body:       clamp(detectedPeakP > 9.0 ? 8 : 5, 1, 10),
      Clarity:    clamp(detectedPeakP < 7.0 ? 8 : 4, 1, 10),
      Fruitiness: clamp(7 - inferredRoast, 1, 10),
      Chocolate:  clamp(inferredRoast + 3, 1, 10),
      Roastiness: clamp(inferredRoast * 2, 1, 10),
      Crema:      clamp(detectedPeakP > 8.5 ? 7 : 4, 1, 10),
      Floral:     clamp(6 - inferredRoast, 1, 10)
    });
*/
    const matchedArch = ARCHETYPES.find(a =>
      p.label?.toLowerCase().includes(a.id.toLowerCase().split(' ')[0])
    );
    if (matchedArch) setArch(matchedArch.id);

    setRightTab('engine');
    setAiMsg('✓ Loaded — imported phases are now the base template. Parameters still apply on top.');
    setTimeout(() => setAiMsg(''), 5000);
  }

  async function sendToGaggiMate(asNew = false) {
    const id = profile.json.id + (asNew ? '-' + (Date.now() % 10000).toString(36) : '');
    const out = {
      id,
      label: profile.json.label,
      type: 'pro',
      description: profile.json.description,
      temperature: r1(profile.baseTemp),
      utility: false,
      phases: activePhases
    };
    try {
      await apiService.request({ tp: 'req:profiles:save', profile: out });
      setAiMsg(asNew ? '✓ Saved as new profile' : '✓ Sent to GaggiMate');
      setTimeout(() => setAiMsg(''), 3000);
      // Refetch stored profiles so registry stays in sync
      try { await loadProfiles(); } catch (_) {}
    } catch (err) {
      setAiMsg('✗ ' + (err?.message ?? 'Send failed'));
      setTimeout(() => setAiMsg(''), 4000);
    }
  }

  const toggleSpider = key => setVisibleSpiders(prev => ({ ...prev, [key]: !prev[key] }));

  // Block Array Adjusters
  const updatePhase = (idx, patch) => {
    setEditPhases(prev => {
      const base = prev ?? JSON.parse(JSON.stringify(activePhases));
      return base.map((p, i) => i === idx ? { ...p, ...patch } : p);
    });
  };
  const removePhase = idx => {
    setEditPhases(prev => {
      const base = prev ?? JSON.parse(JSON.stringify(activePhases));
      return base.filter((_, i) => i !== idx);
    });
  };
  const movePhase = (idx, dir) => {
    setEditPhases(prev => {
      const arr = [...(prev ?? JSON.parse(JSON.stringify(activePhases)))];
      const target = idx + dir;
      if (target < 0 || target >= arr.length) return arr;
      const hold = arr[idx]; arr[idx] = arr[target]; arr[target] = hold;
      return arr;
    });
  };
  const addBlankPhase = () => {
    setEditPhases(prev => {
      const base = prev ?? JSON.parse(JSON.stringify(activePhases));
      return [...base, { name: 'Ext Stage', phase: 'brew', duration: 5, temperature: parseFloat(engineTemp.toFixed(1)), pump: { target: 'pressure', pressure: 6.0, flow: 2.2 }, targets: [] }];
    });
  };

  // ─── PROFILE FILES IO SYSTEM DECK ──────────────────────────────
  const handleLoadStoredProfile = item => importProfile(item);

  const generateAiProfile = async () => {
    if (!prompt.trim()) return;
    if (!apiKey.trim()) { setAiMsg('✗ No HuggingFace token set — add it in the AI tab.'); setTimeout(() => setAiMsg(''), 5000); return; }
    setIsGenerating(true); setAiMsg('Synthesizing profile...');
    try {const currentProfileJson = JSON.stringify(activePhases, null, 2);

const systemPrompt = `You are an expert espresso machine profiling engine for GaggiMate.

Your task is to MODIFY an existing extraction profile according to the user's request.

Output ONLY a raw JSON array of extraction phases.
Do not output explanations, markdown, code fences, comments, or any text before or after the JSON.

Current context:
Roast=${ROAST_LABELS[rl]}
Age=${AGE_LABELS[ra]}
Processing=${baseProcess}${fermentation !== 'None' ? ' + ' + fermentation : ''}
Archetype=${arch}
Dose=${dose}g
Target yield=${r1(dose * ratioTarget)}g

Current profile:
${currentProfileJson}

Phase object schema (targets field is optional):
{"name":string,"phase":"preinfusion"|"brew","valve":1,"duration":number,"temperature":number,"transition":{"type":"instant"|"linear"|"ease-out"|"ease-in","duration":number,"adaptive":boolean},"pump":{"target":"pressure"|"flow","pressure":number,"flow":number},"targets":[{"type":"pressure"|"flow"|"volumetric"|"water_pumped","operator":"gte"|"lte","value":number}]}

Rules:
- Adapt the existing profile rather than creating a completely unrelated one.
- Preserve phases unless the requested change requires modification.
- Keep all values realistic.
- Preinfusion phases must remain before brew phases.
- Pressure: 0-12 bar.
- Flow: 0-8 ml/s.
- Always keep at least one preinfusion phase and one brew phase.

Output ONLY the JSON array, starting with [`;
      // HF OpenAI-compatible endpoint — works with free tokens, no cold-start issues
      const response = await fetch(
        'https://router.huggingface.co/novita/v3/openai/chat/completions',
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'meta-llama/llama-3.1-8b-instruct',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: prompt }
            ],
            max_tokens: 900,
            temperature: 0.3
          })
        }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error?.message ?? err?.error ?? `HTTP ${response.status}`);
      }

      const data = await response.json();
      const raw = data.choices?.[0]?.message?.content ?? '';
      if (!raw) throw new Error('Empty response from model');

      // Extract JSON array — model may still add a tiny preamble
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('No JSON array found in model response');
      const phases = JSON.parse(match[0]);
      if (!Array.isArray(phases) || !phases.length) throw new Error('Parsed result is not a valid phases array');

      setEditPhases(phases);
      setLeftTab('pipeline');
      setAiMsg(`✓ AI generated ${phases.length} phases — loaded into editor.`);
    } catch (e) {
      setAiMsg(`✗ ${e.message}`);
    } finally {
      setIsGenerating(false);
      setTimeout(() => setAiMsg(''), 8000);
    }
  };
const buttonClass = `btn btn-sm flex-1 ${basePhases ? 'bg-base-200 btn-secondary btn-outline' : 'hidden bg-base-300 label'}`
  return (
    <div class="p-4 max-w-7xl mx-auto space-y-6 text-base-content min-h-screen">
      {/* GLOBAL BANNER HEADER */}
      <div class="border-base-content/10">
        <div>
          <h1 class="flex-grow text-2xl font-bold sm:text-3xl">Profile Generator</h1>
        </div>
      </div>
      <div class="tabs tabs-boxed p-1">
        <button class={`tab tab-sm font-bold flex-1 ${leftTab === 'variables' ? 'tab-active' : ''}`} onClick={() => setLeftTab('variables')}>Main Settings</button>
        <button class={`tab tab-sm font-bold flex-1 ${leftTab === 'pipeline' ? 'tab-active' : ''}`} onClick={() => setLeftTab('pipeline')}>Phases ({activePhases.length})</button>
        <button class={`tab tab-sm font-bold flex-1 ${leftTab === 'registry' ? 'tab-active' : ''}`} onClick={() => setLeftTab('registry')}>Saved Files ({storedProfiles.length})</button>
        <button class={`tab tab-sm font-bold flex-1 ${leftTab === 'ai' ? 'tab-active' : ''}`} onClick={() => setLeftTab('ai')}>AI</button>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        

        {/* LEFT COMPONENT DECK ROW */}
        <div class="lg:col-span-7 bg-base-200 rounded-xl border border-base-content/5">

          {/* TAB: VARIABLES */}
          {leftTab === 'variables' && (
            <div class="space-y-6 p-4">
              <div>
                <HDivider label="Processing" />
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label class="form-control">
                    <span class="label-text text-xs font-bold mb-1">Base process</span>
                    <select class="select select-sm select-bordered" value={baseProcess} onChange={e => setBaseProcess(e.target.value)}>
                      {BASE_PROCESSING.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  </label>
                  <label class="form-control">
                    <span class="label-text text-xs font-bold mb-1">Fermentation</span>
                    <select class="select select-sm select-bordered" value={fermentation} onChange={e => setFermentation(e.target.value)}>
                      {FERMENTATIONS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                    </select>
                  </label>
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-base-content/5 pt-4">
                <label class="form-control">
                  <span class="label-text text-xs font-bold mb-1">Roast</span>
                  <select class="select select-sm select-bordered" value={rl} onChange={e => setRl(parseInt(e.target.value))}>
                    {ROAST_LABELS.map((name,i) => <option key={name} value={i}>{name}</option>)}
                  </select>
                </label>
                <label class="form-control">
                  <span class="label-text text-xs font-bold mb-1">Bean age</span>
                  <select class="select select-sm select-bordered" value={ra} onChange={e => setRa(parseInt(e.target.value))}>
                    {AGE_LABELS.map((name,i) => <option key={name} value={i}>{name}</option>)}
                  </select>
                </label>
                <label class="form-control">
                  <span class="label-text text-xs font-bold mb-1">Dose (g)</span>
                  <input type="number" min="5" max="30" step="0.1" value={dose} class="input input-sm input-bordered font-mono" onInput={e => setDose(parseFloat(e.target.value) || 0)} />
                </label>
                <label class="form-control">
                  <span class="label-text text-xs font-bold mb-1">Ratio</span>
                  <input type="number" min="1" max="5" step="0.05" value={ratioTarget} class="input input-sm input-bordered font-mono" onInput={e => setRatioTarget(parseFloat(e.target.value) || 1)} />
                  <span class="text-[9px] opacity-50 mt-1">Recommended: 1:{recommendedRatio(rl,ra,baseProcess,fermentation).toFixed(2)} · {ratioRecommendationReason(rl,ra,baseProcess,fermentation)}</span>
                </label>
              </div>

              <label class="cursor-pointer flex items-start gap-3 p-3 rounded-lg bg-base-300 border border-base-content/10">
                <input type="checkbox" class="checkbox checkbox-sm checkbox-primary mt-0.5" checked={hasBluetoothScale} onChange={e => setHasBluetoothScale(e.target.checked)} />
                <span><b class="text-xs">Bluetooth scale available</b><span class="block text-[10px] opacity-55 mt-1">Uses yield targets and the shared scale coast-compensation logic.</span></span>
              </label>

              <div>
                <HDivider label="Top 3 recommended archetypes" />
                <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
                  {rankedArch.slice(0,3).map((a,index) => (
                    <button key={a.id} type="button" onClick={() => { setArch(a.id); setProfileMeta({...profileMeta, title:a.id}); }}
                      class={`p-2 text-left rounded-md border transition-all text-xs ${arch === a.id ? 'bg-secondary/10 border-secondary text-secondary font-bold' : 'bg-base-300 border-base-content/10'}`}>
                      <div class="font-bold">#{index+1} {a.id}{index===0 ? ' · Recommended' : ''}</div>
                      <div class="text-[9px] opacity-45">{a.tag}</div>
                    </button>
                  ))}
                </div>
                <details class="mt-2 bg-base-300 rounded-lg border border-base-content/10">
                  <summary class="cursor-pointer px-3 py-2 text-xs font-bold">Show {Math.max(0, rankedArch.length-3)} more archetypes</summary>
                  <div class="p-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                    {rankedArch.slice(3).map((a,index) => (
                      <button key={a.id} type="button" onClick={() => { setArch(a.id); setProfileMeta({...profileMeta, title:a.id}); }}
                        class={`p-2 text-left rounded-md border text-xs ${arch === a.id ? 'bg-secondary/10 border-secondary text-secondary font-bold' : 'bg-base-200 border-base-content/10'}`}>
                        <div class="font-bold">#{index+4} {a.id}</div><div class="text-[9px] opacity-45">{a.tag}</div>
                      </button>
                    ))}
                  </div>
                </details>
              </div>

              <div class="text-xs font-mono bg-base-300 rounded-lg border border-base-content/10 p-3">
                Target yield: <b>{profile.yv} g</b>{hasBluetoothScale && profile.scaleStopYield != null ? <> · Pump stop: <b>{profile.scaleStopYield} g</b></> : null}
              </div>
            </div>
          )}

          {/* TAB: PIPELINE */}
          {leftTab === 'pipeline' && (
            <div class="space-y-3 p-4">
              
                <div class="p-3 rounded-lg bg-base-300 border border-base-content/10 space-y-2">
                  <div class="text-[10px] font-bold uppercase tracking-wider opacity-60">Apply Parameters To Imported Profile</div>
                  <div class="flex flex-wrap gap-3">
                    {[
                      { key: 'pressure',    label: 'Pressure',    color: 'var(--analyzer-pressure-text)' },
                      { key: 'flow',        label: 'Flow',        color: 'var(--analyzer-flow-text)' },
                      { key: 'temperature', label: 'Temperature', color: 'var(--analyzer-temp-text)' },
                      { key: 'transitions', label: 'Transitions', color: 'var(--color-secondary)' },
                    ].map(({ key, label, color }) => (
                      <label key={key} class="cursor-pointer flex items-center gap-1.5 select-none text-xs font-medium" style={{ color: overwriteFlags[key] ? color : undefined }}>
                        <input type="checkbox" class="checkbox checkbox-xs" checked={overwriteFlags[key]}
                          style={{ accentColor: color }}
                          onChange={() => toggleOverwrite(key)} />
                        {label}
                      </label>
                    ))}
                  </div>
                  <div class="text-[9px] opacity-40 font-mono">Select which dimensions the engine parameters overwrite on the imported base profile.</div>
                </div>
              
              <div class="flex items-center justify-between px-1">
                <div class="label text-[10px] uppercase font-bold">PHASES</div>
                <div style={{ flex:1, height:1, background:T.border }} />
              </div>
              <div class="flex items-center justify-between px-1">
                <div/>
                <button type="button" class="btn btn-xs btn-primary font-mono" onClick={addBlankPhase}>+ Add Phase</button>
              </div>
              <div class="max-h-[500px] pr-1">
                {activePhases.map((ph, pIdx) => (
                  <PhaseRow key={pIdx} ph={ph} pIdx={pIdx} updatePhase={updatePhase} removePhase={removePhase} movePhase={movePhase} totalPhases={activePhases.length} />
                ))}
              </div>
            </div>
          )}

          {/* TAB: REGISTRY TABLE STORAGE */}
          {leftTab === 'registry' && (
            <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }} class="p-4 rounded-xl border border-base-content/5">
              <HDivider label="Stored Profiles" />
              {loadingProfiles ? (
                <div style={{ fontSize:11, color:T.muted, padding:10, fontStyle:'italic' }}>Querying hardware index...</div>
              ) : (
                <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:4 }}>
                  {storedProfiles.length === 0 && <span class="text-xs opacity-50 p-2 italic">No profiles stored on hardware filesystem.</span>}
                  {storedProfiles.map(p => (
                    <button key={p.id} onClick={() => importProfile(p)} style={{ padding:'6px 10px', textAlign:'left', width:'100%', cursor:'pointer', background:T.card, border:`1px solid ${T.border}`, color:T.text }} class="rounded-lg hover:bg-base-300 transition-colors">
                      <div style={{ fontSize:11, fontWeight:500 }}>{p.label ?? p.id}</div>
                      {p.description && <div style={{ fontSize:9, color:T.muted, marginTop:1 }}>{p.description}</div>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB: AI ENGINE PROMPT */}
          {leftTab === 'ai' && (
            <div class="p-4 space-y-4">
              {/* API KEY SECTION */}
              <div>
                <HDivider label="HuggingFace Token" />
                <div class="flex gap-2 items-center mt-1">
                  <input
                    type={showKey ? 'text' : 'password'}
                    class="input input-bordered input-xs flex-1 font-mono text-[10px]"
                    placeholder="hf_..."
                    value={apiKey}
                    onInput={e => setApiKey(e.target.value)}
                  />
                  <button type="button" class="btn btn-xs btn-ghost opacity-60" onClick={() => setShowKey(s => !s)}>
                    {showKey ? '🙈' : '👁'}
                  </button>
                  {apiKey && (
                    <button type="button" class="btn btn-xs btn-ghost text-error" onClick={() => { clearKeyCookie(); setApiKey(''); }}>
                      Clear
                    </button>
                  )}
                </div>
                <div class="flex gap-2 mt-1.5">
                  <button type="button" class="btn btn-xs btn-outline flex-1" onClick={() => { writeKeyCookie(apiKey); setAiMsg('✓ Token saved to cookie'); setTimeout(() => setAiMsg(''), 3000); }} disabled={!apiKey.trim()}>
                    Save to Cookie
                  </button>
                  <span class={`text-[10px] font-mono my-auto ${apiKey ? 'text-success' : 'opacity-40'}`}>
                    {apiKey ? (readKeyCookie() === apiKey ? '● saved' : '○ unsaved') : 'no token'}
                  </span>
                </div>
                <p class="text-[9px] opacity-40 mt-1 font-mono">Free token from huggingface.co/settings/tokens — stored in browser cookie only.</p>
              </div>

              {/* PROMPT SECTION */}
              <div>
                <HDivider label="Natural Language Prompter" />
                <textarea
                  class="textarea textarea-bordered w-full text-xs h-20 font-mono mt-1"
                  placeholder="e.g., Long lever-style gentle pressure decay for a light Ethiopian natural, targeting clarity and florals..."
                  value={prompt}
                  onInput={e => setPrompt(e.target.value)}
                />
              </div>
              <button type="button" class="btn btn-sm btn-accent w-full" onClick={generateAiProfile} disabled={isGenerating || !prompt.trim() || !apiKey.trim()}>
                {isGenerating ? <span class="loading loading-spinner loading-xs"></span> : 'Synthesize AI Profile'}
              </button>
            </div>
          )}
          
          {aiMsg && <div class="p-2 rounded bg-base-300/80 font-mono text-[11px] border border-base-content/5">{aiMsg}</div>}
          
        </div>

        {/* RIGHT ANALYTICS COMPONENT PANEL */}
        <div class="lg:col-span-5 space-y-6">
          <div class="card bg-base-200 border border-base-content/10 shadow-lg p-4 space-y-4 sticky top-4">
          <HDivider label="Flavour Diagram" />
            
            {/* SPIDER GRID INTERACTIVE VECTOR */}
            <div class="flex flex-col items-center py-4 bg-base-300 rounded-xl border border-base-content/5 space-y-3">
<ExtendedRadarChart
  data={{
    labels: AXES,

    beanFlavour: AXES.map(k => beanBp[k]),
    intendedCupFlavour: AXES.map(k => cupBp[k]),
    archetypeTendency: AXES.map(k => profile.archTend[k]),
    predictedFlavour: AXES.map(k => profile.predictedBp[k]),
  }} className="max-w-[400px] max-h-[400px]" onDragEnd={(dataset) => {
    if (dataset.datasetIndex === 0) {
      setBeanBp(prev => ({ ...prev, [dataset.label]: dataset.value }));
    } else if (dataset.datasetIndex === 1) {
      setCupBp(prev => ({ ...prev, [dataset.label]: dataset.value }));
    }
  }}
/>
            </div>

            {/* PARENT-BOUNDED DYNAMIC SVG CURVE */}
            
            <div class="flex flex-col items-center py-4 bg-base-300 rounded-xl border border-base-content/5 space-y-3">
              <div class="flex w-full text-center text-[10px] font-mono opacity-60 mb-1">
                <div class="flex-1">Calculated Thermal Base: <b style={{ color: T.orange }}>{profile.baseTemp}°C</b></div>
                <div class="flex-1">Shot Duration: <b>{profile.total}s</b></div>
              </div>
              <ExtractionCurve curve=       {{
                    label: profile.json.label,
                    type: 'pro',
                    description: profile.json.description ?? '',
                    temperature: r1(profile.baseTemp),
                    utility: false,
                    phases: activePhases
                  } }/>       

            </div>

            {/* PROFILE META FIELDS */}
            <div class="space-y-2">
              <HDivider label="Profile Identity" />
              <div class="flex gap-2">
                <div class="flex-1">
                  <label class="label text-[10px] font-bold p-0 mb-0.5 opacity-60">ID</label>
                  <input class="input input-bordered input-xs w-full font-mono text-[10px]"
                    placeholder={`${arch.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,16)}-xxxx`}
                    value={profileId}
                    onInput={e => setProfileId(e.target.value)} />
                </div>
                <div class="flex-[2]">
                  <label class="label text-[10px] font-bold p-0 mb-0.5 opacity-60">Label</label>
                  <input class="input input-bordered input-xs w-full text-xs"
                    placeholder={`${arch} (${ROAST_LABELS[rl]})`}
                    value={profileLabel}
                    onInput={e => setProfileLabel(e.target.value)} />
                </div>
              </div>
              <div>
                <label class="label text-[10px] font-bold p-0 mb-0.5 opacity-60">Description</label>
                <input class="input input-bordered input-xs w-full text-xs"
                  placeholder={`Generated for ${ROAST_LABELS[rl]} roast, ${AGE_LABELS[ra]} age profile via engine layout.`}
                  value={profileDescription}
                  onInput={e => setProfileDescription(e.target.value)} />
              </div>
            </div>
          <div class="flex w-full gap-2 p-4">
            {basePhases&&
              <button class="btn btn-sm btn-outline btn-secondary flex-1 bg-base-200" onClick={() => { setBasePhases(null); setBaseTempRef(null); setEditPhases(null); setRightTab('engine'); setProfileMeta({...profileMeta, title : 'Phases'});}}>
                Reset from Imported
              </button>
            }
            <button class="btn btn-sm btn-outline btn-secondary flex-1 bg-base-200" onClick={() => sendToGaggiMate(true)}>
              Save as New
            </button>
            <button class="btn btn-sm btn-outline btn-secondary flex-1 bg-base-200" onClick={() => sendToGaggiMate(false)}>
              Synchronize imported Profile
            </button>
          </div>
            {/* RAW CODE STRUCT PAYLOAD EXPOSE */}
            <details class="collapse collapse-arrow bg-base-200 border border-base-content/5 rounded-lg text-xs">
              <summary class="collapse-title font-mono font-bold py-2 min-h-0">Raw JSON Profile</summary>
              <div class="collapse-content pt-1">
                <pre class="bg-base-300 text-[10px] p-2 rounded overflow-x-auto max-h-40 font-mono">
                  {JSON.stringify({
                    label: profile.json.label,
                    type: 'pro',
                    description: profile.json.description ?? '',
                    temperature: r1(profile.baseTemp),
                    utility: false,
                    phases: activePhases
                  }, null, 2)}
                </pre>
              </div>
            </details>
          </div>
        </div>

      </div>
    </div>
  );
}