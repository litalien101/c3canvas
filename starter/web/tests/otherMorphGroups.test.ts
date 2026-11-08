import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { morphAreaForControl } from '../src/morphAreas.ts';
import {
  isOtherMorphAreaId,
  OTHER_MORPH_AREA_IDS,
  OTHER_MORPH_GROUPS,
  otherMorphGroupForControl,
} from '../src/otherMorphGroups.ts';

type MorphControl = {
  id: string;
  label: string;
  category: string;
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
    expectedAreaCounts: { nose: 189, mouth: 436, arms: 26, hands: 14, legs: 25, feet: 16, misc: 414 },
  },
  {
    name: 'CC3 Female',
    path: '../../shared/cc3_morph_manifest.json',
    expectedAreaCounts: { nose: 8, mouth: 17, arms: 8, hands: 10, legs: 10, feet: 10, misc: 21 },
  },
  {
    name: 'CC3 Male',
    path: '../../shared/cc3_male_morph_manifest.json',
    expectedAreaCounts: { nose: 8, mouth: 17, arms: 8, hands: 10, legs: 10, feet: 10, misc: 22 },
  },
].map((manifest) => ({ ...manifest, controls: readControls(manifest.path) }));

test('all remaining CC5/CC3+ controls are assigned to a non-empty functional group exactly once', () => {
  const { controls } = manifests[0];
  const areaCounts = new Map<string, number>();
  const groupCounts = new Map<string, number>();
  const ids = new Set<string>();

  for (const control of controls) {
    const area = morphAreaForControl(control);
    if (!isOtherMorphAreaId(area)) continue;

    assert.ok(!ids.has(control.id), `Duplicate control identifier ${control.id}`);
    ids.add(control.id);
    areaCounts.set(area, (areaCounts.get(area) ?? 0) + 1);

    const groupId = otherMorphGroupForControl(area, control);
    assert.ok(OTHER_MORPH_GROUPS[area].some(({ id }) => id === groupId), `Unknown group ${groupId} for ${control.id}`);
    groupCounts.set(groupId, (groupCounts.get(groupId) ?? 0) + 1);
  }

  assert.deepEqual(Object.fromEntries([...areaCounts].sort(([a], [b]) => a.localeCompare(b))), {
    arms: 26,
    feet: 16,
    hands: 14,
    legs: 25,
    misc: 414,
    mouth: 436,
    nose: 189,
  });
  assert.equal(ids.size, 1120);
  assert.ok(OTHER_MORPH_AREA_IDS.every((area) => (areaCounts.get(area) ?? 0) > 0));
  assert.ok([...groupCounts.values()].every((count) => count > 0));
  assert.equal([...groupCounts.values()].reduce((sum, count) => sum + count, 0), 1120);
  assert.deepEqual(Object.fromEntries([...groupCounts].sort(([a], [b]) => a.localeCompare(b))), {
    'arms--elbow': 3,
    'arms--forearm': 7,
    'arms--general': 10,
    'arms--upper-arm': 2,
    'arms--wrist': 4,
    'feet--foot': 6,
    'feet--heel': 3,
    'feet--toes': 7,
    'hands--fingers': 2,
    'hands--general': 4,
    'hands--nails': 4,
    'hands--palm': 4,
    'legs--ankle': 1,
    'legs--general': 6,
    'legs--knee': 14,
    'legs--lower-leg': 1,
    'legs--thigh': 3,
    'misc--base-shape': 9,
    'misc--body-pose': 16,
    'misc--dental': 140,
    'misc--eyeball': 17,
    'misc--eye-orbit': 21,
    'misc--face-detail': 3,
    'misc--numbered': 180,
    'misc--tearline': 28,
    'mouth--cheeks': 110,
    'mouth--expression': 124,
    'mouth--jaw': 94,
    'mouth--lips': 45,
    'mouth--teeth': 56,
    'mouth--tongue': 7,
    'nose--nostrils': 96,
    'nose--shape': 67,
    'nose--tip': 26,
  });
});

test('all remaining morphs stay grouped across the CC3 Female and Male manifests', () => {
  for (const { name, controls, expectedAreaCounts } of manifests.slice(1)) {
    const actualCounts = new Map<string, number>();
    for (const control of controls) {
      const area = morphAreaForControl(control);
      if (!isOtherMorphAreaId(area)) continue;
      actualCounts.set(area, (actualCounts.get(area) ?? 0) + 1);
      assert.ok(
        OTHER_MORPH_GROUPS[area].some(({ id }) => id === otherMorphGroupForControl(area, control)),
        `${name} control ${control.id} has no group`,
      );
    }
    assert.deepEqual(
      Object.fromEntries([...actualCounts].sort(([a], [b]) => a.localeCompare(b))),
      expectedAreaCounts,
      `${name} category inventory changed`,
    );
  }
});

test('miscellaneous labels with clear function are not treated as anonymous numbered controls', () => {
  const controls = manifests[0].controls;
  const find = (label: RegExp) => {
    const control = controls.find(({ label: name }) => label.test(name));
    assert.ok(control, `Expected a control matching ${label}`);
    return control;
  };

  assert.equal(otherMorphGroupForControl('misc', find(/^EO /i)), 'misc--eye-orbit');
  assert.equal(otherMorphGroupForControl('misc', find(/^TL /i)), 'misc--tearline');
  assert.equal(otherMorphGroupForControl('misc', find(/^Tear Duct /i)), 'misc--tearline');
  assert.equal(otherMorphGroupForControl('misc', find(/^01_/)), 'misc--numbered');
  assert.equal(otherMorphGroupForControl('misc', find(/Central Incisor/)), 'misc--dental');
});
