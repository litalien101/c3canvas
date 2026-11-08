import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { EYE_MORPH_GROUPS, eyeMorphGroupForControl } from '../src/eyeMorphGroups.ts';
import { morphAreaForControl } from '../src/morphAreas.ts';

type MorphControl = {
  id: string;
  label: string;
};

function readControls(path: string): MorphControl[] {
  const manifest = JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as {
    controls: MorphControl[];
  };
  return manifest.controls;
}

const manifests = [
  {
    name: 'CC5/CC3+',
    path: '../../shared/cc5_rlcc3plus_manifest.json',
    expectedCount: 322,
  },
  {
    name: 'CC3 Female',
    path: '../../shared/cc3_morph_manifest.json',
    expectedCount: 14,
  },
  {
    name: 'CC3 Male',
    path: '../../shared/cc3_male_morph_manifest.json',
    expectedCount: 14,
  },
].map((manifest) => ({ ...manifest, controls: readControls(manifest.path) }));

test('all 322 CC5/CC3+ Eyes-category controls are grouped exactly once', () => {
  const eyeControls = manifests[0].controls.filter((control) => morphAreaForControl(control) === 'eyes');
  const counts = new Map<string, number>();

  for (const control of eyeControls) {
    const groupId = eyeMorphGroupForControl(control);
    assert.ok(EYE_MORPH_GROUPS.some(({ id }) => id === groupId), `Unknown group ${groupId} for ${control.id}`);
    counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
  }

  assert.equal(eyeControls.length, 322);
  assert.equal(new Set(eyeControls.map(({ id }) => id)).size, 322);
  assert.ok(EYE_MORPH_GROUPS.every(({ id }) => (counts.get(id) ?? 0) > 0));
  assert.equal([...counts.values()].reduce((total, count) => total + count, 0), 322);
  assert.deepEqual(Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right))), {
    corners: 24,
    'eye-shape': 9,
    expression: 15,
    'iris-pupil': 3,
    lashes: 7,
    'lashes-lower': 30,
    'lashes-upper': 48,
    lids: 91,
    'lid-presets': 2,
    position: 62,
    socket: 19,
    'under-eye': 12,
  });
});

test('all Eyes-category controls in the supported manifests remain accessible', () => {
  for (const { name, controls, expectedCount } of manifests) {
    const eyeControls = controls.filter((control) => morphAreaForControl(control) === 'eyes');
    const ids = eyeControls.map(({ id }) => id);

    assert.equal(eyeControls.length, expectedCount, `${name} Eyes control count changed`);
    assert.equal(new Set(ids).size, ids.length, `${name} contains duplicate Eyes control identifiers`);
    for (const control of eyeControls) {
      assert.ok(
        EYE_MORPH_GROUPS.some(({ id }) => id === eyeMorphGroupForControl(control)),
        `${name} control ${control.id} has no Eyes group`,
      );
    }
  }
});

test('eye controls are classified by their region and function', () => {
  const getGroup = (label: string, id: string) => eyeMorphGroupForControl({ label, id });
  assert.equal(getGroup('Eye Inner Corner Depth L', 'eye_inner_corner_depth_l'), 'corners');
  assert.equal(getGroup('Eyelid Upper Outer Fold R', 'eyelid_upper_outer_fold_r'), 'lids');
  assert.equal(getGroup('Eye Lower Opening L', 'eye_lower_opening_l'), 'lids');
  assert.equal(getGroup('Eye Bags_preset', 'eye_bag'), 'under-eye');
  assert.equal(getGroup('Sunken Eye Sockets_preset', 'eye_sockets_sunken'), 'socket');
  assert.equal(getGroup('Eyeball Pupil Scale', 'eyeball_pupil_scale'), 'iris-pupil');
  assert.equal(getGroup('Eye Squint Scale', 'eye_squint_scale'), 'expression');
  assert.equal(getGroup('Eyelash Upper Scale L', 'eyelash_upper_scale_l'), 'lashes-upper');
  assert.equal(getGroup('Eyelash Lower Scale R', 'eyelash_lower_scale_r'), 'lashes-lower');
  assert.equal(getGroup('Eye Almond', 'eye_almond'), 'eye-shape');
  assert.equal(getGroup('Monolid_preset', 'eye_monolid'), 'lid-presets');
  assert.equal(getGroup('Eye Deep Set', 'eye_deep_set'), 'position');
});
