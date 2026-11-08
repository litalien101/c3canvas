import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { FACE_MORPH_GROUPS, faceMorphGroupForControl } from '../src/faceMorphGroups.ts';
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
    expectedCount: 93,
  },
  {
    name: 'CC3 Female',
    path: '../../shared/cc3_morph_manifest.json',
    expectedCount: 5,
  },
  {
    name: 'CC3 Male',
    path: '../../shared/cc3_male_morph_manifest.json',
    expectedCount: 5,
  },
].map((manifest) => ({ ...manifest, controls: readControls(manifest.path) }));

test('all 93 CC5/CC3+ Face-category controls are grouped exactly once', () => {
  const faceControls = manifests[0].controls.filter((control) => morphAreaForControl(control) === 'face');
  const counts = new Map<string, number>();

  for (const control of faceControls) {
    const groupId = faceMorphGroupForControl(control);
    assert.ok(FACE_MORPH_GROUPS.some(({ id }) => id === groupId), `Unknown group ${groupId} for ${control.id}`);
    counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
  }

  assert.equal(faceControls.length, 93);
  assert.equal(new Set(faceControls.map(({ id }) => id)).size, 93);
  assert.ok(FACE_MORPH_GROUPS.every(({ id }) => (counts.get(id) ?? 0) > 0));
  assert.equal([...counts.values()].reduce((total, count) => total + count, 0), 93);
  assert.deepEqual(Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right))), {
    brows: 46,
    'face-shape': 39,
    'shape-presets': 8,
  });
});

test('all Face-category controls in the supported manifests remain accessible', () => {
  for (const { name, controls, expectedCount } of manifests) {
    const faceControls = controls.filter((control) => morphAreaForControl(control) === 'face');
    const ids = faceControls.map(({ id }) => id);

    assert.equal(faceControls.length, expectedCount, `${name} Face control count changed`);
    assert.equal(new Set(ids).size, ids.length, `${name} contains duplicate Face control identifiers`);
    for (const control of faceControls) {
      assert.ok(
        FACE_MORPH_GROUPS.some(({ id }) => id === faceMorphGroupForControl(control)),
        `${name} control ${control.id} has no Face group`,
      );
    }
  }
});

test('brow-specific controls and whole-face controls go to their matching groups', () => {
  const getGroup = (label: string, id: string) => faceMorphGroupForControl({ label, id });
  assert.equal(getGroup('Brow Inner Under Depth L', 'brow_inner_under_depth_l'), 'brows');
  assert.equal(getGroup('Protruding Brows_preset', 'brow_bone_depth'), 'brows');
  assert.equal(getGroup('Face Lower Width', 'face_lower_width'), 'face-shape');
  assert.equal(getGroup('Heart Face_preset', 'contour_heart'), 'shape-presets');
});
