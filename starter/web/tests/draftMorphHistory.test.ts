import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMorphDraftHistory,
  pushMorphDraftHistory,
  redoMorphDraftHistory,
  undoMorphDraftHistory,
} from '../src/draftMorphHistory.ts';

test('morph draft history undoes and redoes without mutating snapshots', () => {
  const initial = { nose: 0, jaw: 0 };
  const edited = { nose: 0.4, jaw: 0 };
  const changedAgain = { nose: 0.4, jaw: -0.2 };
  const history = pushMorphDraftHistory(createMorphDraftHistory<typeof initial>(), initial);
  const afterSecondEdit = pushMorphDraftHistory(history, edited);

  const undone = undoMorphDraftHistory(afterSecondEdit, changedAgain);
  assert.deepEqual(undone?.values, edited);
  assert.deepEqual(undone?.history.future, [changedAgain]);

  const redone = undone && redoMorphDraftHistory(undone.history, undone.values);
  assert.deepEqual(redone?.values, changedAgain);
  assert.deepEqual(redone?.history.past, [initial, edited]);
  assert.deepEqual(initial, { nose: 0, jaw: 0 });
});

test('a new morph edit clears redo history and history stays bounded', () => {
  let history = createMorphDraftHistory<{ value: number }>();
  for (let value = 0; value < 60; value += 1) {
    history = pushMorphDraftHistory(history, { value });
  }
  assert.equal(history.past.length, 50);

  const undone = undoMorphDraftHistory(history, { value: 60 });
  assert.ok(undone);
  const afterNewEdit = pushMorphDraftHistory(undone.history, { value: 59 });
  assert.deepEqual(afterNewEdit.future, []);
});

test('undo and redo report unavailable transitions without changing state', () => {
  const history = createMorphDraftHistory<{ value: number }>();
  assert.equal(undoMorphDraftHistory(history, { value: 0 }), null);
  assert.equal(redoMorphDraftHistory(history, { value: 0 }), null);
  assert.deepEqual(history, { past: [], future: [] });
});
