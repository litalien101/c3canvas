import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applySkinDefinitionPatch,
  DEFAULT_SKIN_DEFINITION,
  skinMaterialParameters,
} from '../src/semanticSkin.ts';

test('skin patches update only the named semantic properties', () => {
  const updated = applySkinDefinitionPatch(DEFAULT_SKIN_DEFINITION, {
    base: { undertone: 'warm' },
    surface: { roughness: 0.7 },
  });

  assert.deepEqual(updated, {
    version: 1,
    base: { tone: 0.62, undertone: 'warm' },
    surface: { roughness: 0.7 },
  });
});

test('skin material parameters deterministically map tone, undertone, and roughness', () => {
  assert.deepEqual(skinMaterialParameters(DEFAULT_SKIN_DEFINITION), {
    colorMultiplier: [1.01, 1.01, 1.01],
    roughnessScale: 1,
  });
  assert.deepEqual(skinMaterialParameters({
    version: 1,
    base: { tone: 1, undertone: 'cool' },
    surface: { roughness: 0.21 },
  }), {
    colorMultiplier: [1.164, 1.188, 1.248],
    roughnessScale: 0.5,
  });
});
