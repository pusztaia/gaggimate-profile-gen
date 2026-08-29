import { describe, expect, it } from 'vitest';
import engine from '../profile-engine.js';

const {
  AXES,
  ARCHETYPES,
  BASE_PROCESSING,
  FERMENTATIONS,
  beanFlavourDefaults,
  recommendedRatio,
  rankedArchetypes,
  recommendedArchetype,
  buildProfile,
  buildCurveFromJsonPhases,
  classifyPhaseRole,
  applyHolisticTransitions,
} = engine;

function neutral() {
  return Object.fromEntries(AXES.map((axis) => [axis, 5]));
}

function baseState(overrides = {}) {
  return {
    rl: 2,
    ra: 1,
    baseProcess: 'Washed',
    fermentation: 'None',
    ratioTarget: 2,
    arch: 'Cafe Allrounder',
    beanBp: neutral(),
    cupBp: neutral(),
    dose: 18,
    hasBluetoothScale: false,
    profileId: 'test-id',
    profileLabel: 'Test',
    profileDescription: 'Test profile',
    ...overrides,
  };
}

describe('beanFlavourDefaults', () => {
  it('stays within [0, 10] across every process/fermentation/roast/age combination', () => {
    BASE_PROCESSING.forEach(({ id: process }) => {
      FERMENTATIONS.forEach(({ id: fermentation }) => {
        for (let rl = 0; rl <= 5; rl++) {
          for (let ra = 0; ra <= 2; ra++) {
            const bp = beanFlavourDefaults(rl, ra, process, fermentation);
            AXES.forEach((axis) => {
              expect(bp[axis]).toBeGreaterThanOrEqual(0);
              expect(bp[axis]).toBeLessThanOrEqual(10);
            });
          }
        }
      });
    });
  });

  it('gives Natural process higher body and fruitiness than Washed, all else equal', () => {
    const washed = beanFlavourDefaults(2, 1, 'Washed', 'None');
    const natural = beanFlavourDefaults(2, 1, 'Natural', 'None');
    expect(natural.Body).toBeGreaterThan(washed.Body);
    expect(natural.Fruitiness).toBeGreaterThan(washed.Fruitiness);
  });

  it('shifts flavour toward roastiness/bitterness as roast level increases', () => {
    const light = beanFlavourDefaults(0, 1, 'Washed', 'None');
    const dark = beanFlavourDefaults(5, 1, 'Washed', 'None');
    expect(dark.Roastiness).toBeGreaterThan(light.Roastiness);
    expect(dark.Bitterness).toBeGreaterThan(light.Bitterness);
    expect(dark.Acidity).toBeLessThan(light.Acidity);
  });
});

describe('recommendedRatio', () => {
  it('clamps to [1.50, 3.00]', () => {
    for (let rl = 0; rl <= 5; rl++) {
      for (let ra = 0; ra <= 2; ra++) {
        BASE_PROCESSING.forEach(({ id: process }) => {
          FERMENTATIONS.forEach(({ id: fermentation }) => {
            const ratio = recommendedRatio(rl, ra, process, fermentation);
            expect(ratio).toBeGreaterThanOrEqual(1.5);
            expect(ratio).toBeLessThanOrEqual(3.0);
          });
        });
      }
    }
  });

  it('matches the documented roast/age/process/fermentation formula', () => {
    // Ultra Light + Fresh + Washed + None: 2.60 + 0.05 + 0.10 + 0 = 2.75
    expect(recommendedRatio(0, 0, 'Washed', 'None')).toBeCloseTo(2.75, 5);
    // Dark + Old + Natural + Anaerobic: 1.70 - 0.10 - 0.05 - 0.05 = 1.50 (clamped floor)
    expect(recommendedRatio(5, 2, 'Natural', 'Anaerobic')).toBeCloseTo(1.5, 5);
  });

  it('shortens the ratio as roast gets darker', () => {
    const light = recommendedRatio(0, 1, 'Washed', 'None');
    const dark = recommendedRatio(5, 1, 'Washed', 'None');
    expect(dark).toBeLessThan(light);
  });
});

describe('rankedArchetypes / recommendedArchetype', () => {
  it('recommends a flow-driven archetype for light roasts, washed process', () => {
    expect(recommendedArchetype(0, 'Washed', 'None')).toBe('Nordic Clarity');
    expect(recommendedArchetype(1, 'Washed', 'None')).toBe('Nordic Clarity');
  });

  it('recommends Traditional Italian for dark roasts', () => {
    expect(recommendedArchetype(5, 'Washed', 'None')).toBe('Traditional Italian');
  });

  it('returns every archetype exactly once, ranked by descending score', () => {
    const ranked = rankedArchetypes(3, 'Honey', 'Carbonic maceration');
    expect(ranked).toHaveLength(ARCHETYPES.length);
    expect(new Set(ranked.map((a) => a.id)).size).toBe(ARCHETYPES.length);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
    }
  });
});

describe('buildProfile', () => {
  ARCHETYPES.forEach(({ id: arch }) => {
    it(`produces a valid phase sequence for ${arch}`, () => {
      const profile = buildProfile(baseState({ arch }));

      expect(Array.isArray(profile.json.phases)).toBe(true);
      expect(profile.json.phases.length).toBeGreaterThan(0);

      profile.json.phases.forEach((phase) => {
        expect(phase.transition).toBeTruthy();
        expect(typeof phase.transition.type).toBe('string');
        expect(phase.duration).toBeGreaterThanOrEqual(0);
      });

      expect(profile.baseTemp).toBeGreaterThanOrEqual(79);
      expect(profile.baseTemp).toBeLessThanOrEqual(98);
      expect(profile.peakP).toBeGreaterThanOrEqual(5.5);
      expect(profile.peakP).toBeLessThanOrEqual(10.5);
      expect(profile.mainF).toBeGreaterThanOrEqual(0.8);
      expect(profile.mainF).toBeLessThanOrEqual(5.5);
      expect(profile.yv).toBeCloseTo(18 * 2, 5);
    });
  });

  it('removes all volumetric targets when no bluetooth scale is available', () => {
    const profile = buildProfile(
      baseState({ arch: 'Traditional Italian', hasBluetoothScale: false }),
    );
    const volumetricTargets = profile.json.phases
      .flatMap((ph) => ph.targets ?? [])
      .filter((t) => t.type === 'volumetric');
    expect(volumetricTargets).toHaveLength(0);
  });

  it('shifts only the final volumetric target by the coast compensation when a bluetooth scale is available', () => {
    const dose = 18;
    const ratioTarget = 2;
    const profile = buildProfile(
      baseState({ arch: 'Traditional Italian', hasBluetoothScale: true, dose, ratioTarget }),
    );
    const yv = dose * ratioTarget;
    const scaleStopYield = Math.round((yv - 1.5) * 10) / 10;
    expect(profile.scaleStopYield).toBeCloseTo(scaleStopYield, 5);

    const volumetricTargets = profile.json.phases
      .flatMap((ph) => ph.targets ?? [])
      .filter((t) => t.type === 'volumetric');
    expect(volumetricTargets.length).toBeGreaterThan(0);

    const last = volumetricTargets[volumetricTargets.length - 1];
    expect(last.value).toBeCloseTo(scaleStopYield, 5);

    // Every earlier volumetric target should be untouched (still referencing the full yield curve).
    volumetricTargets.slice(0, -1).forEach((t) => {
      expect(t.value).not.toBeCloseTo(scaleStopYield, 5);
    });
  });
});

describe('classifyPhaseRole', () => {
  it('classifies a near-zero pressure/flow preinfusion phase as SOAK', () => {
    const phases = [
      { phase: 'preinfusion', pump: { target: 'pressure', pressure: 0.2, flow: 0.1 } },
    ];
    expect(classifyPhaseRole(phases[0], phases, 0)).toBe('SOAK');
  });

  it('classifies a high-flow preinfusion phase as FILL', () => {
    const phases = [{ phase: 'preinfusion', pump: { target: 'flow', pressure: 0, flow: 6 } }];
    expect(classifyPhaseRole(phases[0], phases, 0)).toBe('FILL');
  });

  it('classifies a moderate-pressure preinfusion phase as COMPRESS', () => {
    const phases = [{ phase: 'preinfusion', pump: { target: 'pressure', pressure: 2.5, flow: 0 } }];
    expect(classifyPhaseRole(phases[0], phases, 0)).toBe('COMPRESS');
  });

  it('classifies a sustained high-pressure brew phase as PEAK', () => {
    const phases = [
      { phase: 'brew', pump: { target: 'pressure', pressure: 9, flow: 2 } },
      { phase: 'brew', pump: { target: 'pressure', pressure: 9, flow: 2 } },
    ];
    expect(classifyPhaseRole(phases[1], phases, 1)).toBe('PEAK');
  });

  it('classifies a falling-pressure brew phase as DECLINE', () => {
    const phases = [
      { phase: 'brew', pump: { target: 'pressure', pressure: 9, flow: 2 } },
      { phase: 'brew', pump: { target: 'pressure', pressure: 6, flow: 2 } },
    ];
    expect(classifyPhaseRole(phases[1], phases, 1)).toBe('DECLINE');
  });

  it('classifies a low-pressure brew phase as TAIL', () => {
    const phases = [{ phase: 'brew', pump: { target: 'pressure', pressure: 3, flow: 2 } }];
    expect(classifyPhaseRole(phases[0], phases, 0)).toBe('TAIL');
  });
});

describe('applyHolisticTransitions', () => {
  it('always eases the very first phase in gently, non-adaptively', () => {
    const phases = [
      { phase: 'preinfusion', duration: 6, pump: { target: 'flow', pressure: 0, flow: 5 } },
      { phase: 'brew', duration: 20, pump: { target: 'pressure', pressure: 9, flow: 2 } },
    ];
    const [first] = applyHolisticTransitions(phases, neutral());
    expect(first.transition.type).toBe('ease-out');
    expect(first.transition.adaptive).toBe(false);
  });

  it('uses an instant transition between two consecutive FILL phases', () => {
    const phases = [
      { phase: 'preinfusion', duration: 3, pump: { target: 'flow', pressure: 0, flow: 6 } },
      { phase: 'preinfusion', duration: 3, pump: { target: 'flow', pressure: 0, flow: 6 } },
    ];
    const [, second] = applyHolisticTransitions(phases, neutral());
    expect(second.transition).toEqual({ type: 'instant', duration: 0, adaptive: false });
  });

  it('shapes preinfusion-to-brew-peak transitions as an adaptive S-curve', () => {
    const phases = [
      { phase: 'preinfusion', duration: 4, pump: { target: 'pressure', pressure: 2, flow: 0 } },
      { phase: 'brew', duration: 20, pump: { target: 'pressure', pressure: 9, flow: 2 } },
    ];
    const [, second] = applyHolisticTransitions(phases, neutral());
    expect(second.transition.type).toBe('ease-in-out');
    expect(second.transition.adaptive).toBe(true);
  });
});

describe('buildCurveFromJsonPhases', () => {
  it('returns an empty curve for an empty phase list', () => {
    expect(buildCurveFromJsonPhases([])).toEqual([]);
  });

  it('produces an instant jump followed by a hold for an instant transition', () => {
    const curve = buildCurveFromJsonPhases([
      {
        duration: 10,
        pump: { pressure: 9, flow: 2 },
        transition: { type: 'instant', duration: 0 },
      },
    ]);
    expect(curve[0]).toMatchObject({ t: 0, p: 0, fl: 0 });
    expect(curve.some((pt) => pt.t === 0 && pt.p === 9 && pt.fl === 2)).toBe(true);
    expect(curve[curve.length - 1]).toMatchObject({ t: 10, p: 9, fl: 2 });
  });

  it('samples intermediate points for an eased transition', () => {
    const curve = buildCurveFromJsonPhases([
      { duration: 8, pump: { pressure: 8, flow: 4 }, transition: { type: 'linear', duration: 8 } },
    ]);
    const midpoints = curve.filter((pt) => pt.t > 0 && pt.t < 8);
    expect(midpoints.length).toBeGreaterThan(0);
    midpoints.forEach((pt) => {
      expect(pt.p).toBeGreaterThan(0);
      expect(pt.p).toBeLessThan(8);
    });
    expect(curve[curve.length - 1]).toMatchObject({ t: 8, p: 8, fl: 4 });
  });
});
