import assert from 'node:assert/strict';
import test from 'node:test';
import { getMorphHistoryShortcut } from '../src/morphHistoryShortcut.ts';

const shortcut = (overrides: Partial<Parameters<typeof getMorphHistoryShortcut>[0]> = {}) => ({
  key: 'z',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...overrides,
});

test('morph history supports common undo and redo shortcuts', () => {
  assert.equal(getMorphHistoryShortcut(shortcut({ ctrlKey: true }), false), 'undo');
  assert.equal(getMorphHistoryShortcut(shortcut({ metaKey: true }), false), 'undo');
  assert.equal(getMorphHistoryShortcut(shortcut({ ctrlKey: true, shiftKey: true }), false), 'redo');
  assert.equal(getMorphHistoryShortcut(shortcut({ metaKey: true, shiftKey: true }), false), 'redo');
  assert.equal(getMorphHistoryShortcut(shortcut({ key: 'y', ctrlKey: true }), false), 'redo');
});

test('morph history shortcuts leave editable controls and unrelated shortcuts alone', () => {
  assert.equal(getMorphHistoryShortcut(shortcut({ ctrlKey: true }), true), null);
  assert.equal(getMorphHistoryShortcut(shortcut({ key: 'y', metaKey: true }), false), null);
  assert.equal(getMorphHistoryShortcut(shortcut({ ctrlKey: true, altKey: true }), false), null);
  assert.equal(getMorphHistoryShortcut(shortcut(), false), null);
});
