import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('project workflow clearly lists references as stored but unanalyzed', () => {
  assert.match(appSource, /aria-label="Reference images"/);
  assert.match(appSource, /Stored with this project; images are not visually analyzed/);
  assert.match(appSource, /reference\.width\} × \{reference\.height/);
});

test('references can be added and removed with visible in-progress states', () => {
  assert.match(appSource, /Uploading image…/);
  assert.match(appSource, /Uploading and validating reference image…/);
  assert.match(appSource, /Removing reference image…/);
  assert.match(appSource, /Remove reference \$\{reference\.display_name\}/);
  assert.match(appSource, /method: 'DELETE'/);
  assert.match(appSource, /setProject\(\(current\) => current\?\.id === project\.id/);
  assert.match(appSource, /referenceActionError && <p className="workflow-reference-error" role="alert">/);
  assert.match(appSource, /Reference upload failed: \$\{message\}/);
  assert.match(appSource, /Reference removal failed: \$\{message\}/);
  assert.match(stylesSource, /\.workflow-references/);
});
