import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BODY_MORPH_GROUPS, bodyMorphGroupForControl } from '../src/bodyMorphGroups.ts';
import { morphAreaForControl } from '../src/morphAreas.ts';

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
    expectedCount: 180,
  },
  {
    name: 'CC3 Female',
    path: '../../shared/cc3_morph_manifest.json',
    expectedCount: 21,
  },
  {
    name: 'CC3 Male',
    path: '../../shared/cc3_male_morph_manifest.json',
    expectedCount: 26,
  },
].map((manifest) => ({ ...manifest, controls: readControls(manifest.path) }));

test('all 180 CC5/CC3+ Body-category controls are grouped exactly once', () => {
  const { controls } = manifests[0];
  const bodyControls = controls.filter((control) => morphAreaForControl(control) === 'body');
  const counts = new Map<string, number>();

  for (const control of bodyControls) {
    const groupId = bodyMorphGroupForControl(control);
    assert.ok(BODY_MORPH_GROUPS.some(({ id }) => id === groupId), `Unknown group ${groupId} for ${control.id}`);
    counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
  }

  assert.equal(bodyControls.length, 180);
  assert.equal(new Set(bodyControls.map(({ id }) => id)).size, 180);
  assert.ok(BODY_MORPH_GROUPS.every(({ id }) => (counts.get(id) ?? 0) > 0));
  assert.equal([...counts.values()].reduce((total, count) => total + count, 0), 180);
  assert.deepEqual(Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right))), {
    chest: 10,
    eyes: 32,
    face: 1,
    hips: 6,
    limbs: 4,
    neck: 27,
    other: 25,
    overall: 20,
    shoulders: 8,
    teeth: 24,
    tearline: 20,
    torso: 3,
  });
});

test('all visible Body-category controls in each supported manifest remain represented', () => {
  for (const { name, controls, expectedCount } of manifests) {
    const bodyControls = controls.filter((control) => (
      morphAreaForControl(control) === 'body' && control.id !== 'torso_length'
    ));
    const ids = bodyControls.map(({ id }) => id);

    assert.equal(bodyControls.length, expectedCount, `${name} Body control count changed`);
    assert.equal(new Set(ids).size, ids.length, `${name} contains duplicate Body control identifiers`);
    for (const control of bodyControls) {
      assert.ok(
        BODY_MORPH_GROUPS.some(({ id }) => id === bodyMorphGroupForControl(control)),
        `${name} control ${control.id} has no Body group`,
      );
    }
  }
});

test('legacy eye-orbit, tearline, and dental controls stay in their semantic groups', () => {
  const controls = manifests[0].controls;
  const findControl = (predicate: (control: MorphControl) => boolean) => {
    const control = controls.find(predicate);
    assert.ok(control, 'Expected representative control was not found in the pinned manifest');
    return control;
  };

  assert.equal(bodyMorphGroupForControl(findControl(({ label }) => label.startsWith('EO '))), 'eyes');
  assert.equal(bodyMorphGroupForControl(findControl(({ label }) => label.startsWith('TL '))), 'tearline');
  assert.equal(bodyMorphGroupForControl(findControl(({ label }) => /\b(tooth|teeth|incisor|canine|molar)\b/i.test(label))), 'teeth');
});
