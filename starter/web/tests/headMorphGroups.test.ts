import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { HEAD_MORPH_GROUPS, headMorphGroupForControl } from '../src/headMorphGroups.ts';
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
    expectedCount: 103,
  },
  {
    name: 'CC3 Female',
    path: '../../shared/cc3_morph_manifest.json',
    expectedCount: 4,
  },
  {
    name: 'CC3 Male',
    path: '../../shared/cc3_male_morph_manifest.json',
    expectedCount: 4,
  },
].map((manifest) => ({ ...manifest, controls: readControls(manifest.path) }));

test('all 103 CC5/CC3+ Head-category controls are grouped exactly once', () => {
  const headControls = manifests[0].controls.filter((control) => morphAreaForControl(control) === 'head');
  const counts = new Map<string, number>();

  for (const control of headControls) {
    const groupId = headMorphGroupForControl(control);
    assert.ok(HEAD_MORPH_GROUPS.some(({ id }) => id === groupId), `Unknown group ${groupId} for ${control.id}`);
    counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
  }

  assert.equal(headControls.length, 103);
  assert.equal(new Set(headControls.map(({ id }) => id)).size, 103);
  assert.ok(HEAD_MORPH_GROUPS.every(({ id }) => (counts.get(id) ?? 0) > 0));
  assert.equal([...counts.values()].reduce((total, count) => total + count, 0), 103);
  assert.deepEqual(Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right))), {
    forehead: 24,
    orientation: 4,
    overall: 13,
    proportions: 13,
    skull: 49,
  });
});

test('all Head-category controls in the supported manifests remain accessible', () => {
  for (const { name, controls, expectedCount } of manifests) {
    const headControls = controls.filter((control) => morphAreaForControl(control) === 'head');
    const ids = headControls.map(({ id }) => id);

    assert.equal(headControls.length, expectedCount, `${name} Head control count changed`);
    assert.equal(new Set(ids).size, ids.length, `${name} contains duplicate Head control identifiers`);
    for (const control of headControls) {
      assert.ok(
        HEAD_MORPH_GROUPS.some(({ id }) => id === headMorphGroupForControl(control)),
        `${name} control ${control.id} has no Head group`,
      );
    }
  }
});

test('head controls are classified by their anatomical target and function', () => {
  const getGroup = (label: string, id: string) => headMorphGroupForControl({ label, id });
  assert.equal(getGroup('Skull Back Contour Depth A', 'skull_back_contour_depth_a'), 'skull');
  assert.equal(getGroup('Sunken Temples_preset', 'skull_temple_depth'), 'skull');
  assert.equal(getGroup('Forehead Width', 'forehead_width'), 'forehead');
  assert.equal(getGroup('Head Upper Width L', 'head_upper_width_l'), 'proportions');
  assert.equal(getGroup('Head Tilt R L', 'head_tilt_r_l'), 'orientation');
  assert.equal(getGroup('CC3+_Katherine_Head', 'cc3plus_female_head'), 'overall');
});
