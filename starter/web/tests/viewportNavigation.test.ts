import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const viewportSource = readFileSync(new URL('../src/CharacterViewportCanvas.tsx', import.meta.url), 'utf8');

test('viewport navigation uses Blender-style orbit, pan, and zoom gestures', () => {
  assert.match(viewportSource, /MIDDLE:\s*MOUSE\.ROTATE/);
  assert.match(appSource, /event\.button !== 1 \|\| !\(event\.ctrlKey \|\| event\.metaKey\)/);
  assert.match(appSource, /controls\.mouseButtons\.MIDDLE = 1/);
  assert.match(appSource, /controls\.mouseButtons\.MIDDLE = 0/);
  assert.match(appSource, /Shift\+MMB to pan · Ctrl\+MMB or scroll to zoom/);
});

test('holding the Pan toolbar button uses native pointer lock for continuous panning', () => {
  assert.match(appSource, /panButton\.addEventListener\('pointerdown', startPan, true\)/);
  assert.match(appSource, /panModeButtonRef/);
  assert.match(appSource, /event\.button !== 0/);
  assert.match(appSource, /canvas\.requestPointerLock\(\)/);
  assert.match(appSource, /request\.then\(\(\) =>/);
  assert.match(appSource, /document\.pointerLockElement !== canvas/);
  assert.match(appSource, /document\.addEventListener\('pointerlockchange', onPointerLockChange\)/);
  assert.match(appSource, /document\.addEventListener\('pointerlockerror', onPointerLockError\)/);
  assert.match(appSource, /document\.addEventListener\('visibilitychange', onVisibilityChange\)/);
  assert.match(appSource, /window\.addEventListener\('blur', onWindowBlur\)/);
  assert.match(appSource, /document\.addEventListener\('mousemove', panWithMovement, true\)/);
  assert.match(appSource, /event\.movementX/);
  assert.match(appSource, /event\.movementY/);
  assert.match(appSource, /camera\.position\.x \+= offsetX/);
  assert.match(appSource, /controls\.target\.x \+= offsetX/);
  assert.match(appSource, /document\.exitPointerLock\(\)/);
  const panHandler = appSource.slice(appSource.indexOf('const panWithMovement'), appSource.indexOf('const finishPan'));
  assert.doesNotMatch(panHandler, /clientX|clientY|screenX|screenY/);
  assert.doesNotMatch(panHandler, /setPointerCapture|panPointerAnchor|pan-pointer-anchor|lastPanPointerPosition/);
});

test('viewport navigation toolbar keeps its Blender-style left-drag tools', () => {
  assert.match(viewportSource, /LEFT: cameraMode === 'orbit' \? MOUSE\.ROTATE : cameraMode === 'pan' \? MOUSE\.PAN : MOUSE\.DOLLY/);
  assert.match(appSource, /aria-label="Orbit"/);
  assert.match(appSource, /aria-label="Pan"/);
  assert.match(appSource, /aria-label="Zoom"/);
  assert.doesNotMatch(viewportSource, /RIGHT:\s*MOUSE\.(?:PAN|ROTATE|DOLLY)/);
});

test('failed character previews can retry after clearing cached GLTF requests', () => {
  assert.match(viewportSource, /import \{ GLTFLoader \} from 'three\/addons\/loaders\/GLTFLoader\.js'/);
  assert.match(viewportSource, /useLoader\.clear\(GLTFLoader, url\)/);
  assert.match(viewportSource, /Retry preview/);
  assert.match(viewportSource, /retryUrls=\{\[previewUrl, previewProps\.morphPreviewUrl, previewProps\.eyePreviewUrl\]/);
  assert.match(viewportSource, /resetKey=\{\[previewUrl, previewProps\.morphPreviewUrl, previewProps\.eyePreviewUrl\]\.join\('\|'\)\}/);
});
