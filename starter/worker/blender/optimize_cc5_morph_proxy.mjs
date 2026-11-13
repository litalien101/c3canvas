import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeshoptDecoder, MeshoptEncoder } from '../../web/node_modules/meshoptimizer/index.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const assetDirectory = join(scriptDirectory, 'assets');
const proxyFilename = 'CC5_RL_CC3_Plus_Morph_Proxy.glb';
const buildManifestFilename = 'CC5_RL_CC3_Plus_Morph_Proxy.json';
const GLB_HEADER_SIZE = 12;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const MESHOPT_EXTENSION = 'EXT_meshopt_compression';

const COMPONENT_BYTES = new Map([
  [5120, 1],
  [5121, 1],
  [5122, 2],
  [5123, 2],
  [5124, 4],
  [5125, 4],
  [5126, 4],
]);
const COMPONENT_COUNTS = new Map([
  ['SCALAR', 1],
  ['VEC2', 2],
  ['VEC3', 3],
  ['VEC4', 4],
  ['MAT2', 4],
  ['MAT3', 9],
  ['MAT4', 16],
]);

function parseGlb(content) {
  if (content.length < GLB_HEADER_SIZE || content.toString('ascii', 0, 4) !== 'glTF') {
    throw new Error('The CC5 morph proxy is not a valid GLB.');
  }
  if (content.readUInt32LE(4) !== 2 || content.readUInt32LE(8) !== content.length) {
    throw new Error('The CC5 morph proxy must be a complete GLB 2.0 file.');
  }
  let document;
  let binary;
  let offset = GLB_HEADER_SIZE;
  while (offset < content.length) {
    if (offset + 8 > content.length) throw new Error('The CC5 morph proxy has a truncated chunk header.');
    const length = content.readUInt32LE(offset);
    const type = content.readUInt32LE(offset + 4);
    offset += 8;
    if (offset + length > content.length) throw new Error('The CC5 morph proxy has a truncated chunk.');
    const chunk = content.subarray(offset, offset + length);
    offset += length;
    if (type === JSON_CHUNK) document = JSON.parse(chunk.toString('utf8').replace(/[\0 ]+$/g, ''));
    if (type === BIN_CHUNK) binary = chunk;
  }
  if (!document || !binary || document.buffers?.[0]?.uri) {
    throw new Error('The CC5 morph proxy must contain one embedded JSON and binary buffer.');
  }
  return { document, binary };
}

function encodeGlb(document, binary) {
  document.buffers[0].byteLength = binary.length;
  const json = Buffer.from(JSON.stringify(document));
  const paddedJson = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const paddedBinary = Buffer.concat([binary, Buffer.alloc((4 - (binary.length % 4)) % 4)]);
  const content = Buffer.alloc(GLB_HEADER_SIZE + 8 + paddedJson.length + 8 + paddedBinary.length);
  content.write('glTF', 0, 'ascii');
  content.writeUInt32LE(2, 4);
  content.writeUInt32LE(content.length, 8);
  let offset = GLB_HEADER_SIZE;
  content.writeUInt32LE(paddedJson.length, offset);
  content.writeUInt32LE(JSON_CHUNK, offset + 4);
  offset += 8;
  paddedJson.copy(content, offset);
  offset += paddedJson.length;
  content.writeUInt32LE(paddedBinary.length, offset);
  content.writeUInt32LE(BIN_CHUNK, offset + 4);
  paddedBinary.copy(content, offset + 8);
  return content;
}

function getCompressibleViews(document) {
  const accessorsByView = new Map();
  for (const accessor of document.accessors ?? []) {
    if (!Number.isInteger(accessor.bufferView)) continue;
    const accessors = accessorsByView.get(accessor.bufferView) ?? [];
    accessors.push(accessor);
    accessorsByView.set(accessor.bufferView, accessors);
  }

  const candidates = new Map();
  for (let viewIndex = 0; viewIndex < document.bufferViews.length; viewIndex += 1) {
    const view = document.bufferViews[viewIndex];
    if (view.extensions?.[MESHOPT_EXTENSION]) continue;
    if (view.target !== 34962 && view.target !== 34963) continue;
    const accessors = accessorsByView.get(viewIndex) ?? [];
    if (accessors.length === 0) continue;
    const first = accessors[0];
    const componentBytes = COMPONENT_BYTES.get(first.componentType);
    const componentCount = COMPONENT_COUNTS.get(first.type);
    if (!componentBytes || !componentCount) {
      throw new Error(`Unsupported accessor type for CC5 proxy buffer view ${viewIndex}.`);
    }

    if (view.target === 34963) {
      if (accessors.length !== 1 || ![5123, 5125].includes(first.componentType)) {
        throw new Error(`Unsupported index buffer layout in CC5 proxy buffer view ${viewIndex}.`);
      }
      candidates.set(viewIndex, {
        mode: 'INDICES',
        stride: componentBytes,
        count: first.count,
      });
      continue;
    }

    const stride = view.byteStride ?? componentBytes * componentCount;
    if (
      stride > 256
      || stride % 4 !== 0
      || accessors.some((accessor) => {
        const bytes = COMPONENT_BYTES.get(accessor.componentType);
        const components = COMPONENT_COUNTS.get(accessor.type);
        return !bytes || !components || bytes * components > stride;
      })
      || view.byteLength % stride !== 0
    ) {
      throw new Error(`Unsupported vertex buffer layout in CC5 proxy buffer view ${viewIndex}.`);
    }
    candidates.set(viewIndex, {
      mode: 'ATTRIBUTES',
      stride,
      count: view.byteLength / stride,
    });
  }
  return candidates;
}

export async function optimizeGlb(sourceBytes) {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const { document, binary: sourceBinary } = parseGlb(sourceBytes);
  const candidates = getCompressibleViews(document);
  if (candidates.size === 0) {
    if (document.extensionsRequired?.includes(MESHOPT_EXTENSION)) {
      return { bytes: Buffer.from(sourceBytes), geometryBufferCount: 0, geometryBytes: 0 };
    }
    throw new Error('The CC5 proxy has no uncompressed geometry buffers.');
  }

  const newBinary = [];
  const compressedRanges = new Map();
  let totalCompressedBytes = 0;
  for (let viewIndex = 0; viewIndex < document.bufferViews.length; viewIndex += 1) {
    const view = document.bufferViews[viewIndex];
    const sourceOffset = view.byteOffset ?? 0;
    const sourceRange = sourceBinary.subarray(sourceOffset, sourceOffset + view.byteLength);
    if (sourceRange.length !== view.byteLength) {
      throw new Error(`CC5 proxy buffer view ${viewIndex} is outside the source binary.`);
    }
    const candidate = candidates.get(viewIndex);
    if (candidate) {
      const encoded = MeshoptEncoder.encodeGltfBuffer(
        sourceRange,
        candidate.count,
        candidate.stride,
        candidate.mode,
      );
      const decoded = await MeshoptDecoder.decodeGltfBufferAsync(
        candidate.count,
        candidate.stride,
        encoded,
        candidate.mode,
      );
      if (Buffer.compare(Buffer.from(decoded), Buffer.from(sourceRange)) !== 0) {
        throw new Error(`Meshopt round-trip changed CC5 proxy geometry in buffer view ${viewIndex}.`);
      }
      const padding = (4 - (newBinary.reduce((size, chunk) => size + chunk.length, 0) % 4)) % 4;
      if (padding) newBinary.push(Buffer.alloc(padding));
      const byteOffset = newBinary.reduce((size, chunk) => size + chunk.length, 0);
      newBinary.push(Buffer.from(encoded));
      compressedRanges.set(viewIndex, { ...candidate, byteOffset, byteLength: encoded.length });
      totalCompressedBytes += encoded.length;
      continue;
    }

    const padding = (4 - (newBinary.reduce((size, chunk) => size + chunk.length, 0) % 4)) % 4;
    if (padding) newBinary.push(Buffer.alloc(padding));
    view.byteOffset = newBinary.reduce((size, chunk) => size + chunk.length, 0);
    newBinary.push(Buffer.from(sourceRange));
  }

  const contentLength = newBinary.reduce((size, chunk) => size + chunk.length, 0);
  const fallbackPadding = (4 - (contentLength % 4)) % 4;
  if (fallbackPadding) newBinary.push(Buffer.alloc(fallbackPadding));
  const fallbackOffset = newBinary.reduce((size, chunk) => size + chunk.length, 0);
  const fallbackLength = Math.max(...[...compressedRanges.keys()].map((index) => document.bufferViews[index].byteLength));
  newBinary.push(Buffer.alloc(fallbackLength));

  for (const [viewIndex, compressed] of compressedRanges) {
    const view = document.bufferViews[viewIndex];
    view.byteOffset = fallbackOffset;
    view.extensions = {
      ...view.extensions,
      [MESHOPT_EXTENSION]: {
        buffer: 0,
        byteOffset: compressed.byteOffset,
        byteLength: compressed.byteLength,
        byteStride: compressed.stride,
        count: compressed.count,
        mode: compressed.mode,
      },
    };
  }

  document.extensionsUsed = [...new Set([...(document.extensionsUsed ?? []), MESHOPT_EXTENSION])];
  document.extensionsRequired = [...new Set([...(document.extensionsRequired ?? []), MESHOPT_EXTENSION])];
  const optimizedBytes = encodeGlb(document, Buffer.concat(newBinary));
  return {
    bytes: optimizedBytes,
    geometryBufferCount: compressedRanges.size,
    geometryBytes: totalCompressedBytes,
  };
}

async function main() {
  const sourcePath = resolve(process.argv[2] ?? join(assetDirectory, 'CC5_RL_CC3_Plus_Morph_Proxy.glb'));
  const outputPath = resolve(process.argv[3] ?? join(assetDirectory, proxyFilename));
  const manifestPath = join(assetDirectory, buildManifestFilename);
  const sourceBytes = await readFile(sourcePath);
  const { bytes, geometryBufferCount, geometryBytes } = await optimizeGlb(sourceBytes);
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, bytes, { flag: 'wx' });
  await rename(temporaryPath, outputPath);

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.proxy_glb_filename = proxyFilename;
  manifest.proxy_glb_sha256 = createHash('sha256').update(bytes).digest('hex');
  manifest.proxy_glb_bytes = bytes.length;
  manifest.meshopt_compression = true;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({
    source_bytes: sourceBytes.length,
    optimized_bytes: bytes.length,
    geometry_buffers: geometryBufferCount,
    compressed_geometry_bytes: geometryBytes,
    reduction_percent: Math.round((1 - bytes.length / sourceBytes.length) * 100),
    sha256: manifest.proxy_glb_sha256,
  }, null, 2));
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await main();
}
