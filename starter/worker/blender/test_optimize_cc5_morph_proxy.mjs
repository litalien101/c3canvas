import assert from 'node:assert/strict';
import test from 'node:test';
import { MeshoptDecoder } from '../../web/node_modules/meshoptimizer/index.js';
import { optimizeGlb } from './optimize_cc5_morph_proxy.mjs';

function makeGlb() {
  const vertices = Buffer.alloc(36);
  for (let index = 0; index < 3; index += 1) {
    vertices.writeFloatLE(index, index * 12);
    vertices.writeFloatLE(index + 1, index * 12 + 4);
    vertices.writeFloatLE(index + 2, index * 12 + 8);
  }
  const indices = Buffer.from([0, 0, 1, 0, 2, 0]);
  const binary = Buffer.concat([vertices, indices]);
  const document = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: vertices.length, target: 34962 },
      { buffer: 0, byteOffset: vertices.length, byteLength: indices.length, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
  };
  const json = Buffer.from(JSON.stringify(document));
  const paddedJson = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const paddedBinary = Buffer.concat([binary, Buffer.alloc((4 - (binary.length % 4)) % 4)]);
  const content = Buffer.alloc(12 + 8 + paddedJson.length + 8 + paddedBinary.length);
  content.write('glTF', 0, 'ascii');
  content.writeUInt32LE(2, 4);
  content.writeUInt32LE(content.length, 8);
  content.writeUInt32LE(paddedJson.length, 12);
  content.writeUInt32LE(0x4e4f534a, 16);
  paddedJson.copy(content, 20);
  const binaryHeader = 20 + paddedJson.length;
  content.writeUInt32LE(paddedBinary.length, binaryHeader);
  content.writeUInt32LE(0x004e4942, binaryHeader + 4);
  paddedBinary.copy(content, binaryHeader + 8);
  return content;
}

function readGlb(content) {
  let offset = 12;
  let document;
  let binary;
  while (offset < content.length) {
    const length = content.readUInt32LE(offset);
    const type = content.readUInt32LE(offset + 4);
    offset += 8;
    const chunk = content.subarray(offset, offset + length);
    offset += length;
    if (type === 0x4e4f534a) document = JSON.parse(chunk.toString('utf8').replace(/[\0 ]+$/g, ''));
    if (type === 0x004e4942) binary = chunk;
  }
  return { document, binary };
}

test('CC5 preview meshopt compression preserves geometry and required extension metadata', async () => {
  const source = makeGlb();
  const sourceData = readGlb(source);
  const result = await optimizeGlb(source);
  const { document, binary } = readGlb(result.bytes);
  await MeshoptDecoder.ready;

  assert.equal(result.geometryBufferCount, 2);
  assert.ok(document.extensionsRequired.includes('EXT_meshopt_compression'));
  for (const [viewIndex, expected] of [
    [0, sourceData.binary.subarray(0, 36)],
    [1, sourceData.binary.subarray(36, 42)],
  ]) {
    const extension = document.bufferViews[viewIndex].extensions.EXT_meshopt_compression;
    const compressed = binary.subarray(extension.byteOffset, extension.byteOffset + extension.byteLength);
    const decoded = await MeshoptDecoder.decodeGltfBufferAsync(
      extension.count,
      extension.byteStride,
      compressed,
      extension.mode,
    );
    assert.ok(Buffer.from(decoded).equals(expected));
  }
});

test('CC5 preview meshopt optimization is idempotent', async () => {
  const first = await optimizeGlb(makeGlb());
  const second = await optimizeGlb(first.bytes);

  assert.equal(second.geometryBufferCount, 0);
  assert.ok(second.bytes.equals(first.bytes));
});
