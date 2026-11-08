import assert from 'node:assert/strict';
import test from 'node:test';
import { getMorphDeltaSteps } from '../src/morphDeltaSteps.ts';

test('changing a positive morph removes its positive delta', () => {
  const positive = { side: 'positive' };
  const negative = { side: 'negative' };
  const steps = getMorphDeltaSteps(0.5, 1, {
    positive: [positive],
    negative: [negative],
  });

  assert.deepEqual(steps, [
    { records: [positive], amount: -0.5 },
    { records: [positive], amount: 1 },
  ]);
});

test('crossing zero removes the previously active side before applying the new side', () => {
  const positive = { side: 'positive' };
  const negative = { side: 'negative' };
  const steps = getMorphDeltaSteps(-0.25, 0.75, {
    positive: [positive],
    negative: [negative],
  });

  assert.deepEqual(steps, [
    { records: [negative], amount: -0.25 },
    { records: [positive], amount: 0.75 },
  ]);
});

test('resetting a negative morph removes its negative delta', () => {
  const positive = { side: 'positive' };
  const negative = { side: 'negative' };
  const steps = getMorphDeltaSteps(-0.4, 0, {
    positive: [positive],
    negative: [negative],
  });

  assert.deepEqual(steps, [{ records: [negative], amount: -0.4 }]);
});
