import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { WORKSHOP_ASSETS } from '../src/objectWorkshopAssets.ts';

test('bundled CC0 model bases contain every mapped component and embedded PBR materials', () => {
  for (const [presetId, asset] of Object.entries(WORKSHOP_ASSETS)) {
    assert.ok(asset);
    const bytes = readFileSync(new URL(`../public/assets/object-workshop/${asset.fileName}`, import.meta.url));
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${presetId} must be a binary glTF`);
    assert.equal(bytes.readUInt32LE(4), 2, `${presetId} must use glTF 2.0`);
    assert.equal(bytes.readUInt32LE(8), bytes.length, `${presetId} must have a valid GLB length`);

    const jsonLength = bytes.readUInt32LE(12);
    assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, `${presetId} must start with a JSON chunk`);
    const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength).trim()) as {
      nodes?: Array<{ name?: string }>;
      materials?: unknown[];
      images?: unknown[];
      meshes?: unknown[];
    };
    const nodeNames = new Set((gltf.nodes ?? []).map(({ name }) => name));
    for (const component of asset.components) {
      assert.ok(nodeNames.has(component.meshName), `${presetId} is missing ${component.meshName}`);
    }
    assert.ok((gltf.meshes?.length ?? 0) > 0, `${presetId} must include mesh geometry`);
    assert.ok((gltf.materials?.length ?? 0) > 0, `${presetId} must include source materials`);
    assert.ok((gltf.images?.length ?? 0) > 0, `${presetId} must include embedded texture images`);
    assert.ok(bytes.length <= 8 * 1024 * 1024, `${presetId} should remain suitable for a browser preview`);
    assert.equal(asset.license, 'CC0 1.0');
    assert.ok(asset.sourceUrl.startsWith('https://polyhaven.com/a/'));
  }
});
