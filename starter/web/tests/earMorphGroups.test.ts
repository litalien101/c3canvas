import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { EAR_MORPH_GROUPS, earMorphGroupForControl, isEarMorphControl } from '../src/earMorphGroups.ts';

const manifest = JSON.parse(
  readFileSync(new URL('../../shared/cc5_rlcc3plus_manifest.json', import.meta.url), 'utf8'),
) as {
  controls: Array<{ id: string; label: string; category: string }>;
};

test('all 224 CC5/CC3+ ear controls are assigned once without changing their identifiers', () => {
  const earControls = manifest.controls.filter(isEarMorphControl);
  const ids = earControls.map(({ id }) => id);
  const assignedIds = new Map<string, number>();
  const counts = new Map<string, number>();

  for (const control of earControls) {
    const group = earMorphGroupForControl(control);
    assignedIds.set(control.id, (assignedIds.get(control.id) ?? 0) + 1);
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }

  assert.equal(earControls.length, 224);
  assert.equal(new Set(ids).size, 224);
  assert.deepEqual([...assignedIds.keys()].sort(), [...ids].sort());
  assert.ok([...assignedIds.values()].every((count) => count === 1));
  assert.ok(EAR_MORPH_GROUPS.every(({ id }) => (counts.get(id) ?? 0) > 0));
  assert.equal([...counts.values()].reduce((total, count) => total + count, 0), 224);
  assert.deepEqual(Object.fromEntries(counts), {
    tip: 8,
    earlobe: 28,
    center: 6,
    rim: 43,
    'rim-details': 57,
    inner: 25,
    angle: 14,
    depth: 23,
    width: 4,
    height: 5,
    size: 4,
    shape: 4,
    other: 3,
  });
});

test('anatomical and function-specific controls are grouped by their manifest names', () => {
  const getGroup = (label: string, id: string) => earMorphGroupForControl({ label, id });
  assert.equal(getGroup('Ear Center Angle', 'ear_center_angle'), 'center');
  assert.equal(getGroup('Ear Top Angle', 'ear_top_angle'), 'angle');
  assert.equal(getGroup('Ear Edge Detail Width A L', 'ear_edge_detail_width_a_l'), 'rim-details');
  assert.equal(getGroup('Curvy Ear Folds_preset', 'ear_3'), 'inner');
  assert.equal(getGroup('Pointed Ears_preset', 'ear_pointed'), 'tip');
  assert.equal(getGroup('Skull Over Ear Width', 'skull_over_ear_width'), 'other');
});
