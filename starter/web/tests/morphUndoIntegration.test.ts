import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('editor exposes scoped morph undo and redo actions', () => {
  assert.match(appSource, /aria-label="Undo morph edit"/);
  assert.match(appSource, /aria-label="Redo morph edit"/);
  assert.match(appSource, /onClick=\{undoMorphEdit\}/);
  assert.match(appSource, /onClick=\{redoMorphEdit\}/);
  assert.doesNotMatch(appSource, /Undo coming soon|Redo coming soon/);
});

test('slider gestures are grouped and project changes reset morph history', () => {
  assert.match(appSource, /morphGestureHistoryCaptured\.current/);
  assert.match(appSource, /onPointerDown=\{beginMorphInteraction\}/);
  assert.match(appSource, /\}, \[project\?\.id\]\);/);
  assert.match(appSource, /setMorphs\(result\.values\)/);
});

test('history keyboard shortcuts preserve native editing in form controls', () => {
  assert.match(appSource, /target\.closest\('input, textarea, select, \[role="textbox"\]'\)/);
  assert.match(appSource, /event\.preventDefault\(\);[\s\S]*undoMorphEdit\(\)/);
  assert.match(appSource, /window\.addEventListener\('keydown', handleHistoryShortcut\)/);
});
