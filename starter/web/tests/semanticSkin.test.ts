import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_SKIN_DEFINITION,
  applySkinDefinitionPatch,
  generateFreckleSpots,
  normalizeSkinDefinition,
  skinMaterialParameters,
} from '../src/semanticSkin.ts';
import {
  skinPaintPoint,
  skinPaintPressure,
  shouldConnectSkinPaintPoints,
} from '../src/skinPaint.ts';

test('skin paint maps pen pressure and separates large UV jumps', () => {
  assert.equal(skinPaintPressure('mouse', 0.2), 1);
  assert.equal(skinPaintPressure('pen', 0), 1);
  assert.equal(skinPaintPressure('pen', 0.01), 0.05);
  assert.equal(skinPaintPressure('pen', 0.6), 0.6);
  assert.deepEqual(skinPaintPoint(0.2, 1.1, 'pen', 0.6), {
    u: 0.2,
    v: 1,
    pressure: 0.6,
  });
  assert.equal(shouldConnectSkinPaintPoints(
    { u: 0.2, v: 0.4 },
    { u: 0.25, v: 0.45 },
  ), true);
  assert.equal(shouldConnectSkinPaintPoints(
    { u: 0.2, v: 0.4 },
    { u: 0.9, v: 0.95 },
  ), false);
});

test('legacy skin definitions receive disabled freckle defaults', () => {
  assert.deepEqual(normalizeSkinDefinition({
    version: 1,
    base: { tone: 0.4, undertone: 'warm' },
    surface: { roughness: 0.7 },
  }), {
    version: 2,
    base: { tone: 0.4, undertone: 'warm' },
    surface: { roughness: 0.7 },
    features: DEFAULT_SKIN_DEFINITION.features,
  });
});

test('skin patches update only the named semantic properties', () => {
  const updated = applySkinDefinitionPatch(DEFAULT_SKIN_DEFINITION, {
    base: { undertone: 'warm' },
    surface: { roughness: 0.7 },
    features: { freckles: { enabled: true, density: 0.5 } },
  });

  assert.deepEqual(updated, {
    version: 2,
    base: { tone: 0.62, undertone: 'warm' },
    surface: { roughness: 0.7 },
    features: {
      freckles: {
        enabled: true,
        density: 0.5,
        size: 0.45,
        strength: 0.35,
        color: '#80513F',
        seed: 24301,
        pattern: 'natural',
      },
    },
  });
});

test('skin material parameters deterministically map tone, undertone, and roughness', () => {
  assert.deepEqual(skinMaterialParameters(DEFAULT_SKIN_DEFINITION), {
    colorMultiplier: [1.01, 1.01, 1.01],
    roughnessScale: 1,
  });
  assert.deepEqual(skinMaterialParameters({
    version: 2,
    base: { tone: 1, undertone: 'cool' },
    surface: { roughness: 0.21 },
    features: DEFAULT_SKIN_DEFINITION.features,
  }), {
    colorMultiplier: [1.164, 1.188, 1.248],
    roughnessScale: 0.5,
  });
});

test('freckle spots are deterministic, bounded, and disabled by default', () => {
  const freckles = {
    ...DEFAULT_SKIN_DEFINITION.features.freckles,
    enabled: true,
    density: 0.1,
  };
  const first = generateFreckleSpots(freckles, 128, 64);
  const second = generateFreckleSpots(freckles, 128, 64);

  assert.equal(first.length, 80);
  assert.deepEqual(first, second);
  assert.deepEqual(first[0], {
    x: 56.19259175658226,
    y: 16.706750452518463,
    radius: 0.08027152073171737,
    opacity: 0.13194720307271926,
  });
  assert.ok(first.every(({ x, y, radius, opacity }) =>
    x >= 0 && x < 128 && y >= 0 && y < 64 && radius > 0 && opacity > 0));
  assert.deepEqual(
    generateFreckleSpots(DEFAULT_SKIN_DEFINITION.features.freckles, 128, 64),
    [],
  );
});

test('freckle pattern selection changes deterministic distribution', () => {
  const base = {
    ...DEFAULT_SKIN_DEFINITION.features.freckles,
    enabled: true,
    density: 0.5,
  };
  const natural = generateFreckleSpots({ ...base, pattern: 'natural' }, 128, 128);
  const clustered = generateFreckleSpots({ ...base, pattern: 'cheek_clusters' }, 128, 128);

  assert.equal(natural.length, 400);
  assert.equal(clustered.length, 400);
  assert.notDeepEqual(natural, clustered);
  assert.ok(clustered.every(({ x, y }) =>
    x >= 0 && x < 128 && y >= 0 && y < 128));
});

test('surface paint additions do not trigger texture-wide replay clearing', () => {
  const source = readFileSync(new URL('../src/CC3ModelPreview.tsx', import.meta.url), 'utf8');
  assert.match(source, /previousIsPrefixOfNext/);
  assert.match(source, /if \(previousIsPrefixOfNext\) return;/);
});
