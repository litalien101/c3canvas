import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('homepage defers the 3D viewport and Object Workshop bundles', () => {
  assert.match(appSource, /lazy\(\(\) => import\('\.\/CharacterViewportCanvas'\)\)/);
  assert.match(appSource, /lazy\(\(\) => import\('\.\/ObjectWorkshop'\)/);
  assert.doesNotMatch(appSource, /from ['"]@react-three\//);
  assert.doesNotMatch(appSource, /from ['"]three['"]/);
  assert.doesNotMatch(appSource, /import \{[^}]*CC3ModelPreview[^}]*\} from ['"]\.\/CC3ModelPreview['"]/);
});

test('homepage uses the optimized overlay asset', () => {
  assert.match(stylesSource, /url\('\/c3canvas_overlay_1\.webp'\)/);
  assert.ok(existsSync(new URL('../public/c3canvas_overlay_1.webp', import.meta.url)));
});
