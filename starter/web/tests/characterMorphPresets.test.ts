import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { applyElvenEarPreset, ELVEN_EAR_PRESET_MORPHS } from '../src/characterMorphPresets.ts';

const cc5Manifest = JSON.parse(
  readFileSync(new URL('../../shared/cc5_rlcc3plus_manifest.json', import.meta.url), 'utf8'),
) as {
  controls: Array<{ id: string; minimum: number; maximum: number }>;
};

test('elven ear preset uses supported CC3+ morphs within their manifest ranges', () => {
  const controls = new Map(cc5Manifest.controls.map((control) => [control.id, control]));

  for (const [id, value] of Object.entries(ELVEN_EAR_PRESET_MORPHS)) {
    const control = controls.get(id);
    assert.ok(control, `Expected ${id} to be an installed CC3+ control`);
    assert.ok(value >= control.minimum && value <= control.maximum, `${id} must be in range`);
  }
});

test('applying elven ears preserves unrelated morph values without mutating the draft', () => {
  const current = {
    '2019-08-25-17-39-45_ear pointed': 0.2,
    '2022-01-25-09-03-07_01_inner_l_high': 0.4,
  };
  const updated = applyElvenEarPreset(current);

  assert.notEqual(updated, current);
  assert.deepEqual(current, {
    '2019-08-25-17-39-45_ear pointed': 0.2,
    '2022-01-25-09-03-07_01_inner_l_high': 0.4,
  });
  assert.equal(updated['2019-08-25-17-39-45_ear pointed'], 1);
  assert.equal(updated['2022-01-25-09-03-07_01_inner_l_high'], 0.4);
  assert.deepEqual(
    Object.keys(updated).filter((id) => id in ELVEN_EAR_PRESET_MORPHS).sort(),
    Object.keys(ELVEN_EAR_PRESET_MORPHS).sort(),
  );
});
