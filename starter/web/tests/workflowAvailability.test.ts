import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('unavailable Blender is explained without implying draft data is lost', () => {
  assert.match(appSource, /Blender is unavailable, so compilation is disabled\. Your browser draft and saved choices remain available\./);
  assert.match(appSource, /!hasCharacter && !blenderAvailable && <p className="workflow-footnote" role="status">/);
  assert.match(appSource, /Blender is unavailable\. \$\{blenderError \|\| 'Compilation is disabled\.'\}/);
});

test('API connection errors direct users to the API rather than Blender', () => {
  assert.equal((appSource.match(/Check that the local API is running\./g) ?? []).length, 2);
  assert.doesNotMatch(appSource, /Configure Blender and restart the API|Restart the local API and try again/);
});

test('compile guidance explains the approval and draft-save gates', () => {
  assert.match(appSource, /Approve the plan before compiling\./);
  assert.match(appSource, /Wait for draft changes to finish saving before compiling\./);
});

test('initial API, project, and model catalog failures can be retried in place', () => {
  assert.match(appSource, /\}, \[account\?\.id, authLoading, initialDataRetry\]\);/);
  assert.match(appSource, /remainingRequests = 3/);
  assert.match(appSource, /Retry connection/);
  assert.match(appSource, /Retry projects/);
  assert.match(appSource, /Retry model catalog/);
  assert.match(appSource, /Retrying…/);
  assert.match(appSource, /className="initial-data-retry"/);
});

test('eye and skin catalog failures can be retried without changing project drafts', () => {
  assert.match(appSource, /\}, \[eyeAssetsRetry, project\?\.id\]\);/);
  assert.match(appSource, /\}, \[project\?\.id, skinAssetsRetry\]\);/);
  assert.match(appSource, /Retry eye assets/);
  assert.match(appSource, /Retry skin assets/);
  assert.match(appSource, /setEyeAssetsRetry\(\(retry\) => retry \+ 1\)/);
  assert.match(appSource, /setSkinAssetsRetry\(\(retry\) => retry \+ 1\)/);
  assert.match(appSource, /className="asset-catalog-error" role="alert"/);
});

test('manifest-backed morph controls expose a retry and reject empty catalogs', () => {
  assert.match(appSource, /\}, \[availableBaseModels,[\s\S]*morphControlsRetry, selectedBaseModel\]\);/);
  assert.match(appSource, /setMorphControlsRetry\(\(retry\) => retry \+ 1\)/);
  assert.match(appSource, /Retry character controls/);
  assert.match(appSource, /No manifest-backed character controls were returned for this model\./);
  assert.match(appSource, /className="morph-controls-status is-error" role="alert"/);
});
