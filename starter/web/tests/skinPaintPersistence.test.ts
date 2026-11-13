import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Texture, Vector2 } from 'three';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const viewportSource = readFileSync(new URL('../src/CharacterViewportCanvas.tsx', import.meta.url), 'utf8');
const previewSource = readFileSync(new URL('../src/CC3ModelPreview.tsx', import.meta.url), 'utf8');

test('skin paint converts segmented CC3+ material UV tiles to local texture coordinates', async () => {
  const { applySkinMaterialUvOffset, skinMaterialUvOffset, skinPaintPoint } = await import('../src/skinPaint.ts');
  assert.equal(skinMaterialUvOffset('Std_Skin_Head'), 0);
  assert.equal(skinMaterialUvOffset('Std_Skin_Body'), 1);
  assert.equal(skinMaterialUvOffset('Std_Skin_Arm'), 2);
  assert.equal(skinMaterialUvOffset('Std_Skin_Leg'), 3);
  assert.equal(skinPaintPoint(1.25, 0.4, 'mouse', 0, 'Std_Skin_Body').u, 0.25);
  assert.ok(Math.abs(skinPaintPoint(2.6, 0.4, 'mouse', 0, 'Std_Skin_Arm').u - 0.6) < 1e-12);
  assert.equal(skinPaintPoint(3.75, 0.4, 'mouse', 0, 'Std_Skin_Leg').u, 0.75);
  assert.equal(skinPaintPoint(0.35, 0.4, 'mouse', 0, 'Std_Skin_Head').u, 0.35);

  const texture = new Texture();
  applySkinMaterialUvOffset(texture, 'Std_Skin_Body');
  const bodyUv = new Vector2(1.25, 0.4).applyMatrix3(texture.matrix);
  assert.equal(bodyUv.x, 0.25);
  assert.equal(bodyUv.y, 0.4);

  texture.matrixAutoUpdate = false;
  texture.matrix.identity();
  applySkinMaterialUvOffset(texture, 'Std_Skin_Leg');
  const legUv = new Vector2(3.75, 0.4).applyMatrix3(texture.matrix);
  assert.equal(legUv.x, 0.75);
  assert.equal(legUv.y, 0.4);
});

test('skin paint opacity reaches 1 percent', () => {
  assert.match(appSource, /aria-label="Brush opacity"[\s\S]*min="1"[\s\S]*max="100"[\s\S]*step="1"/);
});

test('skin paint leaves viewport controls enabled', () => {
  assert.doesNotMatch(viewportSource, /<OrbitControls[\s\S]*enabled=\{!skinPaintEnabled\}/);
  assert.match(viewportSource, /<OrbitControls[\s\S]*enabled\s*\n?[\s\S]*enableRotate/);
});

test('skin paint disables viewport navigation while the pointer is on the model', () => {
  assert.match(viewportSource, /enabled=\{!skinPaintEnabled \|\| !skinPaintPointerOnModel\}/);
  assert.match(appSource, /onSkinPaintPointerOnModel=\{setSkinPaintPointerOnModel\}/);
  assert.match(previewSource, /onSkinPaintPointerOnModel\?\.\(Boolean\(material\)\)/);
  assert.match(previewSource, /onSkinPaintPointerOnModel\?\.\(false\)/);
});

test('skin paint saves append and replace operations serially', () => {
  assert.match(appSource, /const skinPaintSaveQueueRef = useRef<Promise<void>>\(Promise\.resolve\(\)\)/);
  assert.match(appSource, /skinPaintSaveQueueRef\.current\.catch\(\(\) => undefined\)/);
});

test('modifier camera gestures do not become paint strokes', () => {
  assert.match(previewSource, /event\.nativeEvent\.shiftKey[\s\S]*event\.nativeEvent\.ctrlKey[\s\S]*event\.nativeEvent\.metaKey[\s\S]*event\.nativeEvent\.altKey/);
});

test('paint mode keeps the native cursor outside the model and hides it on the brush surface', () => {
  assert.match(appSource, /is-skin-painting-on-model/);
  assert.match(appSource, /is-skin-painting/);
  const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.canvas-wrap\.is-skin-painting canvas\s*\{\s*cursor: crosshair;/);
  assert.match(styles, /\.canvas-wrap\.is-skin-painting-on-model canvas\s*\{\s*cursor: none;/);
  assert.match(previewSource, /onSkinPaintPointerOnModel\?\.\(Boolean\(material\)\)/);
  assert.match(previewSource, /meshBasicMaterial color="#111111"/);
  assert.match(appSource, /canvas\.style\.cursor = skinPaintEnabled[\s\S]*crosshair/);
});

test('full-body skin hit mapping recognizes canonical and imported material variants', async () => {
  const { normalizeSkinPaintMaterialName } = await import('../src/skinPaint.ts');
  assert.equal(normalizeSkinPaintMaterialName('Std_Skin_Head'), 'Std_Skin_Head');
  assert.equal(normalizeSkinPaintMaterialName('Std_Skin_Head.001'), 'Std_Skin_Head');
  assert.equal(normalizeSkinPaintMaterialName('Std_Skin_Body'), 'Std_Skin_Body');
  assert.equal(normalizeSkinPaintMaterialName('Std_Skin_Arm.002'), 'Std_Skin_Arm');
  assert.equal(normalizeSkinPaintMaterialName('CC_Skin_Leg'), 'Std_Skin_Leg');
  assert.equal(normalizeSkinPaintMaterialName('Std_Eye_R'), null);
});

test('full-body geometry groups resolve the actual painted body region', async () => {
  const { resolveSkinPaintMaterialFromGeometry } = await import('../src/skinPaint.ts');
  const names = [
    'Std_Eyelash',
    'Std_Nails',
    'Std_Skin_Arm',
    'Std_Skin_Body',
    'Std_Skin_Head',
    'Std_Skin_Leg',
  ];
  const groups = [
    { start: 0, count: 300, materialIndex: 0 },
    { start: 300, count: 300, materialIndex: 1 },
    { start: 600, count: 300, materialIndex: 2 },
    { start: 900, count: 300, materialIndex: 3 },
    { start: 1200, count: 300, materialIndex: 4 },
    { start: 1500, count: 300, materialIndex: 5 },
  ];
  assert.equal(resolveSkinPaintMaterialFromGeometry(names, 100, groups, true), null);
  assert.equal(resolveSkinPaintMaterialFromGeometry(names, 225, groups, true), 'Std_Skin_Arm');
  assert.equal(resolveSkinPaintMaterialFromGeometry(names, 325, groups, true), 'Std_Skin_Body');
  assert.equal(resolveSkinPaintMaterialFromGeometry(names, 425, groups, true), 'Std_Skin_Head');
  assert.equal(resolveSkinPaintMaterialFromGeometry(names, 525, groups, true), 'Std_Skin_Leg');
  assert.equal(resolveSkinPaintMaterialFromGeometry(['Std_Skin_Body'], 12, [], true), 'Std_Skin_Body');
  assert.equal(resolveSkinPaintMaterialFromGeometry(['Std_Skin_Arm'], 4, [], true), 'Std_Skin_Arm');
  assert.equal(resolveSkinPaintMaterialFromGeometry(['Std_Nails'], 2, [], true), null);
});
