import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLoader, useThree } from '@react-three/fiber';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as cloneRiggedModel } from 'three/addons/utils/SkeletonUtils.js';
import { CanvasTexture, Material, Matrix3, Matrix4, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, NoColorSpace, Object3D, SkinnedMesh, SRGBColorSpace, Texture, TextureLoader, Vector3 } from 'three';
import { getMorphDeltaSteps } from './morphDeltaSteps';

export type CC3MorphControl = string;
export type CC3MorphControlSpec = {
  id: CC3MorphControl;
  label: string;
  category: string;
  minimum: number;
  maximum: number;
  positive_shape_key: string | null;
  negative_shape_key: string | null;
  isPreset?: boolean;
};
export type ModelPartKey = 'body' | 'eyes' | 'teeth' | 'tongue';

const meshByPart: Record<ModelPartKey, string> = {
  body: 'CC_Base_Body',
  eyes: 'CC_Base_Eye',
  teeth: 'CC_Base_Teeth',
  tongue: 'CC_Base_Tongue',
};

const MAX_PREVIEW_TEXTURE_SIZE = 1024;
const ATTACHMENT_SAMPLE_COUNT = 32;
const BODY_VERTEX_NEIGHBOR_COUNT = 4;
const EYE_ASSET_TO_PROXY_SCALE = 0.01;
const PRESET_TRANSITION_DURATION_MS = 450;
const EYE_TRANSITION_DURATION_MS = 300;

function normalizeMeshName(name: string) {
  return name
    .replace(/\.\d+/g, '')
    .replace(/_\d+$/, '')
    .replace(/\d+$/, '');
}

type MorphAttachment = {
  mesh: Mesh;
  basePosition: Vector3;
  bodyVertexSamples: {
    mesh: SkinnedMesh;
    index: number;
    weight: number;
    bodyToParent: Matrix3;
  }[];
};
type MorphDeltaRecord = {
  meshIndex: number;
  primitiveIndex: number;
  vertexIndices: Uint32Array;
  deltas: Float32Array;
};
type MorphDeltaTarget = {
  positive: MorphDeltaRecord[];
  negative: MorphDeltaRecord[];
  byteLength: number;
};
type MorphProxyGeometry = {
  geometry: Mesh['geometry'];
  faceOffsetsByVertex: Uint32Array;
  faceCornersByVertex: Uint32Array;
};
type MorphPreviewStatus = 'idle' | 'updating' | 'error';

function modelPartForMesh(name: string): ModelPartKey | undefined {
  const normalizedName = normalizeMeshName(name);
  return (Object.keys(meshByPart) as ModelPartKey[])
    .find((part) => normalizedName === meshByPart[part] || normalizedName.startsWith(`${meshByPart[part]}_`));
}

function eyeAssetMeshIndex(name: string): number | undefined {
  const normalizedName = normalizeMeshName(name);
  if (normalizedName === 'CC_Base_Eye' || normalizedName === 'CC_Game_Eye') return 1;
  if (normalizedName === 'CC_Base_EyeOcclusion') return 2;
  if (normalizedName === 'CC_Base_TearLine') return 3;
  return undefined;
}

function configureGltfLoader(loader: GLTFLoader) {
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath('/draco/gltf/');
  loader.setDRACOLoader(dracoLoader);
  loader.setMeshoptDecoder(MeshoptDecoder);
}

function parseMorphDeltaTarget(buffer: ArrayBuffer): MorphDeltaTarget {
  const view = new DataView(buffer);
  if (
    buffer.byteLength < 9
    || view.getUint8(0) !== 67
    || view.getUint8(1) !== 77
    || view.getUint8(2) !== 77
    || view.getUint8(3) !== 68
    || view.getUint8(4) !== 1
  ) {
    throw new Error('The local CC5 morph proxy returned invalid deformation data.');
  }
  const positiveCount = view.getUint16(5, true);
  const negativeCount = view.getUint16(7, true);
  let offset = 9;
  const readRecords = (recordCount: number): MorphDeltaRecord[] => {
    const records: MorphDeltaRecord[] = [];
    for (let recordIndex = 0; recordIndex < recordCount; recordIndex += 1) {
      if (offset + 7 > buffer.byteLength) {
        throw new Error('The local CC5 morph proxy data is incomplete.');
      }
      const meshIndex = view.getUint8(offset);
      const primitiveIndex = view.getUint16(offset + 1, true);
      const vertexCount = view.getUint32(offset + 3, true);
      offset += 7;
      if (meshIndex >= 6 || vertexCount > 2_000_000 || offset + vertexCount * 16 > buffer.byteLength) {
        throw new Error('The local CC5 morph proxy data has invalid geometry references.');
      }
      const vertexIndices = new Uint32Array(vertexCount);
      const deltas = new Float32Array(vertexCount * 3);
      for (let vertex = 0; vertex < vertexCount; vertex += 1) {
        vertexIndices[vertex] = view.getUint32(offset, true);
        deltas[vertex * 3] = view.getFloat32(offset + 4, true);
        deltas[vertex * 3 + 1] = view.getFloat32(offset + 8, true);
        deltas[vertex * 3 + 2] = view.getFloat32(offset + 12, true);
        offset += 16;
      }
      records.push({ meshIndex, primitiveIndex, vertexIndices, deltas });
    }
    return records;
  };
  const positive = readRecords(positiveCount);
  const negative = readRecords(negativeCount);
  if (offset !== buffer.byteLength) {
    throw new Error('The local CC5 morph proxy data has unexpected trailing bytes.');
  }
  return { positive, negative, byteLength: buffer.byteLength };
}

function createPreviewTexture(texture: Texture): Texture {
  const image = texture.image;
  if (!(image instanceof HTMLImageElement
    || image instanceof HTMLCanvasElement
    || (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap))) {
    throw new Error('The browser could not read the eyelash opacity map.');
  }
  const largestDimension = Math.max(image.width, image.height);
  if (largestDimension <= MAX_PREVIEW_TEXTURE_SIZE) return texture;

  const scale = MAX_PREVIEW_TEXTURE_SIZE / largestDimension;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The browser could not prepare a lower-memory character preview.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const previewTexture = texture.clone();
  previewTexture.image = canvas;
  previewTexture.needsUpdate = true;
  return previewTexture;
}

function createEyelashOpacityTexture(texture: Texture): Texture {
  const image = texture.image;
  if (!(image instanceof HTMLImageElement
    || image instanceof HTMLCanvasElement
    || (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap))) return texture;

  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The browser could not prepare the eyelash opacity map.');
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const opacity = Math.min(255, pixels.data[index + 3] * 16);
    pixels.data[index] = opacity;
    pixels.data[index + 1] = opacity;
    pixels.data[index + 2] = opacity;
    pixels.data[index + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);

  const opacityTexture = new CanvasTexture(canvas);
  opacityTexture.mapping = texture.mapping;
  opacityTexture.channel = texture.channel;
  opacityTexture.wrapS = texture.wrapS;
  opacityTexture.wrapT = texture.wrapT;
  opacityTexture.magFilter = texture.magFilter;
  opacityTexture.minFilter = texture.minFilter;
  opacityTexture.anisotropy = texture.anisotropy;
  opacityTexture.offset.copy(texture.offset);
  opacityTexture.repeat.copy(texture.repeat);
  opacityTexture.center.copy(texture.center);
  opacityTexture.rotation = texture.rotation;
  opacityTexture.matrixAutoUpdate = texture.matrixAutoUpdate;
  if (!texture.matrixAutoUpdate) opacityTexture.matrix.copy(texture.matrix);
  opacityTexture.flipY = texture.flipY;
  opacityTexture.premultiplyAlpha = texture.premultiplyAlpha;
  opacityTexture.colorSpace = NoColorSpace;
  opacityTexture.needsUpdate = true;
  return opacityTexture;
}

function configurePreviewMaterial(material: Material, textures: Set<Texture>) {
  if (!(material instanceof MeshStandardMaterial)) return;

  if (material.name === 'Std_Eyelash' && material.map) {
    const opacityTexture = createEyelashOpacityTexture(material.map);
    if (opacityTexture !== material.map) textures.add(opacityTexture);
    material.map = null;
    material.alphaMap = opacityTexture;
    material.color.set('#302a28');
    material.opacity = 1;
    material.transparent = true;
    material.alphaTest = 0.005;
    material.depthWrite = false;
    material.needsUpdate = true;
    return;
  }

  if (/^Std_Eye_[RL]$/.test(material.name)) {
    material.color.set('#858585');
    material.roughness = 0.36;
    material.needsUpdate = true;
    return;
  }

  if (/^Std_Cornea_[RL]$/.test(material.name)) {
    material.color.set('#ffffff');
    material.roughness = 0.12;
    material.opacity = 0.28;
    material.transparent = true;
    material.depthWrite = false;
    if (material instanceof MeshPhysicalMaterial) {
      material.specularIntensity = 1;
      material.clearcoat = 1;
      material.clearcoatRoughness = 0.08;
    }
    material.needsUpdate = true;
  }
}

function isBaseEyeMesh(object: Object3D): object is Mesh {
  if (!(object instanceof Mesh)) return false;
  const normalizedName = normalizeMeshName(object.name);
  if (/^CC_Base_(?:Eye|EyeOcclusion|TearLine)(?:_\d+)?$/.test(normalizedName)) return true;

  const materials = Array.isArray(object.material) ? object.material : [object.material];
  return materials.some(({ name }) => (
    /^Std_(?:Eye|Cornea|Eye_Occlusion|Tearline)_[RL](?:\.\d+)?$/.test(name)
  ));
}

function clonePreviewModel(scene: Object3D, removeBaseEyes = false) {
  const model = cloneRiggedModel(scene);
  const textures = new Set<Texture>();
  const materials = new Set<Material>();
  if (removeBaseEyes) {
    const baseEyeMeshes: Mesh[] = [];
    model.traverse((object) => {
      if (isBaseEyeMesh(object)) baseEyeMeshes.push(object);
    });
    baseEyeMeshes.forEach((object) => object.parent?.remove(object));
  }
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
    const clonedMaterials = sourceMaterials.map((sourceMaterial) => {
      const material = sourceMaterial.clone();
      materials.add(material);
      for (const [key, value] of Object.entries(sourceMaterial)) {
        if (!(value instanceof Texture)) continue;
        const texture = createPreviewTexture(value);
        if (texture !== value) {
          Object.assign(material, { [key]: texture });
          textures.add(texture);
        }
      }
      configurePreviewMaterial(material, textures);
      return material;
    });
    object.material = Array.isArray(object.material) ? clonedMaterials : clonedMaterials[0];
  });
  return { model, textures, materials };
}

type SkinPreviewTextures = {
  materials: Record<string, { diffuse: string; normal: string }>;
};

function configureSkinPreviewTexture(
  texture: Texture,
  source: Texture | null,
  colorSpace: typeof SRGBColorSpace | typeof NoColorSpace,
) {
  if (source) {
    texture.mapping = source.mapping;
    texture.channel = source.channel;
    texture.wrapS = source.wrapS;
    texture.wrapT = source.wrapT;
    texture.offset.copy(source.offset);
    texture.repeat.copy(source.repeat);
    texture.center.copy(source.center);
    texture.rotation = source.rotation;
    texture.matrixAutoUpdate = source.matrixAutoUpdate;
    if (!source.matrixAutoUpdate) texture.matrix.copy(source.matrix);
  }
  texture.flipY = false;
  texture.colorSpace = colorSpace;
  texture.needsUpdate = true;
}

function SkinMaterialPreview({
  model,
  skinPreview,
  ownedTextures,
  onPreviewError,
}: {
  model: Object3D;
  skinPreview: SkinPreviewTextures;
  ownedTextures: Set<Texture>;
  onPreviewError: (message: string) => void;
}) {
  const entries = useMemo(() => Object.entries(skinPreview.materials), [skinPreview]);
  const textureUrls = useMemo(
    () => entries.flatMap(([, urls]) => [urls.diffuse, urls.normal]),
    [entries],
  );
  const loadedTextures = useLoader(TextureLoader, textureUrls);

  useEffect(() => {
    const replaced: {
      material: MeshStandardMaterial;
      map: Texture | null;
      normalMap: Texture | null;
      normalScale: MeshStandardMaterial['normalScale'];
      textures: Texture[];
    }[] = [];
    const matched = new Set<string>();
    model.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        const materialName = material.name.replace(/\.\d+$/, '');
        const entryIndex = entries.findIndex(([name]) => name === materialName);
        if (entryIndex < 0 || !(material instanceof MeshStandardMaterial)) continue;
        const diffuseSource = loadedTextures[entryIndex * 2];
        const normalSource = loadedTextures[entryIndex * 2 + 1];
        if (!diffuseSource || !normalSource) continue;
        const previewDiffuse = createPreviewTexture(diffuseSource);
        const previewNormal = createPreviewTexture(normalSource);
        const diffuse = previewDiffuse === diffuseSource ? diffuseSource.clone() : previewDiffuse;
        const normal = previewNormal === normalSource ? normalSource.clone() : previewNormal;
        configureSkinPreviewTexture(diffuse, material.map, SRGBColorSpace);
        configureSkinPreviewTexture(normal, material.normalMap, NoColorSpace);
        replaced.push({
          material,
          map: material.map,
          normalMap: material.normalMap,
          normalScale: material.normalScale.clone(),
          textures: [diffuse, normal],
        });
        material.map = diffuse;
        material.normalMap = normal;
        material.normalScale.multiplyScalar(0.35);
        material.needsUpdate = true;
        ownedTextures.add(diffuse);
        ownedTextures.add(normal);
        matched.add(materialName);
      }
    });
    onPreviewError(
      matched.size === entries.length
        ? ''
        : `The skin preview could not find all expected materials (${[...matched].join(', ') || 'none'}).`,
    );
    return () => {
      for (const { material, map, normalMap, normalScale, textures } of replaced) {
        material.map = map;
        material.normalMap = normalMap;
        material.normalScale.copy(normalScale);
        material.needsUpdate = true;
        for (const texture of textures) {
          ownedTextures.delete(texture);
          texture.dispose();
        }
      }
    };
  }, [entries, loadedTextures, model, onPreviewError, ownedTextures, textureUrls]);
  return null;
}

function buildFaceAdjacency(geometry: Mesh['geometry']): Pick<
  MorphProxyGeometry,
  'faceOffsetsByVertex' | 'faceCornersByVertex'
> {
  const index = geometry.getIndex();
  const vertexCount = geometry.getAttribute('position').count;
  const cornerCount = index?.count ?? vertexCount;
  if (cornerCount % 3 !== 0) {
    throw new Error('The local CC5 morph proxy contains incomplete triangles.');
  }

  const faceCounts = new Uint32Array(vertexCount);
  const vertexAt = (corner: number) => index ? index.getX(corner) : corner;
  for (let faceCorner = 0; faceCorner < cornerCount; faceCorner += 3) {
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = vertexAt(faceCorner + corner);
      if (vertex >= vertexCount) {
        throw new Error('The local CC5 morph proxy contains an invalid triangle index.');
      }
      faceCounts[vertex] += 1;
    }
  }

  const faceOffsetsByVertex = new Uint32Array(vertexCount + 1);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    faceOffsetsByVertex[vertex + 1] = faceOffsetsByVertex[vertex] + faceCounts[vertex];
  }
  const faceCornersByVertex = new Uint32Array(faceOffsetsByVertex[vertexCount]);
  const cursor = faceOffsetsByVertex.slice(0, vertexCount);
  for (let faceCorner = 0; faceCorner < cornerCount; faceCorner += 3) {
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = vertexAt(faceCorner + corner);
      faceCornersByVertex[cursor[vertex]] = faceCorner;
      cursor[vertex] += 1;
    }
  }
  return { faceOffsetsByVertex, faceCornersByVertex };
}

function updateAffectedNormals(proxy: MorphProxyGeometry, changedVertices: Set<number>) {
  const { geometry, faceOffsetsByVertex, faceCornersByVertex } = proxy;
  const index = geometry.getIndex();
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  if (!normal) return;
  const vertexAt = (corner: number) => index ? index.getX(corner) : corner;
  const affectedVertices = new Set(changedVertices);

  for (const vertex of changedVertices) {
    for (
      let face = faceOffsetsByVertex[vertex];
      face < faceOffsetsByVertex[vertex + 1];
      face += 1
    ) {
      const faceCorner = faceCornersByVertex[face];
      affectedVertices.add(vertexAt(faceCorner));
      affectedVertices.add(vertexAt(faceCorner + 1));
      affectedVertices.add(vertexAt(faceCorner + 2));
    }
  }

  for (const vertex of affectedVertices) {
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (
      let face = faceOffsetsByVertex[vertex];
      face < faceOffsetsByVertex[vertex + 1];
      face += 1
    ) {
      const faceCorner = faceCornersByVertex[face];
      const a = vertexAt(faceCorner) * 3;
      const b = vertexAt(faceCorner + 1) * 3;
      const c = vertexAt(faceCorner + 2) * 3;
      const abx = position.array[a] - position.array[b];
      const aby = position.array[a + 1] - position.array[b + 1];
      const abz = position.array[a + 2] - position.array[b + 2];
      const cbx = position.array[c] - position.array[b];
      const cby = position.array[c + 1] - position.array[b + 1];
      const cbz = position.array[c + 2] - position.array[b + 2];
      nx += cby * abz - cbz * aby;
      ny += cbz * abx - cbx * abz;
      nz += cbx * aby - cby * abx;
    }
    const length = Math.hypot(nx, ny, nz);
    normal.setXYZ(
      vertex,
      length > 0 ? nx / length : 0,
      length > 0 ? ny / length : 0,
      length > 0 ? nz / length : 0,
    );
  }
  normal.needsUpdate = true;
}

function cloneMorphProxyGeometries(model: Object3D): Map<string, MorphProxyGeometry> {
  const geometries = new Map<string, MorphProxyGeometry>();
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const meshIndex = object.geometry.userData.comodel_proxy_mesh_index;
    const primitiveIndex = object.geometry.userData.comodel_proxy_primitive_index;
    if (!Number.isInteger(meshIndex) || !Number.isInteger(primitiveIndex)) return;

    const geometry = object.geometry.clone();
    object.geometry = geometry;
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    if (!(position?.array instanceof Float32Array)) {
      throw new Error('The local CC5 morph proxy is missing its position data.');
    }
    if (normal && !(normal.array instanceof Float32Array)) {
      throw new Error('The local CC5 morph proxy has unsupported normal data.');
    }
    const key = `${meshIndex}:${primitiveIndex}`;
    if (geometries.has(key)) {
      throw new Error('The local CC5 morph proxy contains duplicate geometry identifiers.');
    }
    object.frustumCulled = false;
    geometries.set(key, {
      geometry,
      ...buildFaceAdjacency(geometry),
    });
  });
  if (geometries.size === 0) {
    throw new Error('The local CC5 morph proxy is missing its geometry map.');
  }
  return geometries;
}

function applyMorphProxyState(
  model: Object3D,
  visible: Record<ModelPartKey, boolean>,
  morphs: Record<CC3MorphControl, number>,
  changedControls: CC3MorphControlSpec[],
  targets: Map<CC3MorphControl, MorphDeltaTarget>,
  geometries: Map<string, MorphProxyGeometry>,
  previousMorphs: Map<CC3MorphControl, number>,
) {
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const part = modelPartForMesh(object.name);
    if (part) object.visible = visible[part];
  });

  const changedVerticesByGeometry = new Map<string, Set<number>>();
  for (const { id } of changedControls) {
    const previousValue = previousMorphs.get(id) ?? 0;
    const nextValue = morphs[id] ?? 0;
    if (previousValue === nextValue) continue;

    const target = targets.get(id);
    if (!target) {
      throw new Error('A changed CC5 morph is missing its cached deformation data.');
    }
    for (const { records, amount } of getMorphDeltaSteps(previousValue, nextValue, target)) {
      for (const record of records) {
        const key = `${record.meshIndex}:${record.primitiveIndex}`;
        const proxy = geometries.get(key);
        if (!proxy) throw new Error('A cached CC5 morph references missing proxy geometry.');
        const vertices = changedVerticesByGeometry.get(key) ?? new Set<number>();
        changedVerticesByGeometry.set(key, vertices);
        const positions = proxy.geometry.getAttribute('position').array;
        for (let vertex = 0; vertex < record.vertexIndices.length; vertex += 1) {
          const vertexIndex = record.vertexIndices[vertex];
          const index = vertexIndex * 3;
          if (index + 2 >= positions.length) {
            throw new Error('A cached CC5 morph references a vertex outside its proxy mesh.');
          }
          positions[index] += record.deltas[vertex * 3] * amount;
          positions[index + 1] += record.deltas[vertex * 3 + 1] * amount;
          positions[index + 2] += record.deltas[vertex * 3 + 2] * amount;
          vertices.add(vertexIndex);
        }
      }
    }
    if (nextValue === 0) previousMorphs.delete(id);
    else previousMorphs.set(id, nextValue);
  }

  for (const [key, vertices] of changedVerticesByGeometry) {
    const proxy = geometries.get(key);
    if (!proxy) throw new Error('A changed CC5 morph references missing proxy geometry.');
    proxy.geometry.getAttribute('position').needsUpdate = true;
    updateAffectedNormals(proxy, vertices);
  }
}

function createMorphAttachments(model: Object3D): MorphAttachment[] {
  const bodyMeshes: SkinnedMesh[] = [];
  model.traverse((object) => {
    if (object instanceof SkinnedMesh && modelPartForMesh(object.name) === 'body') bodyMeshes.push(object);
  });
  if (bodyMeshes.length === 0) return [];
  if (!bodyMeshes.some((mesh) => Object.keys(mesh.morphTargetDictionary ?? {}).length > 0)) return [];

  model.updateMatrixWorld(true);
  const attachments: MorphAttachment[] = [];
  model.traverse((object) => {
    const part = modelPartForMesh(object.name);
    if (!(object instanceof Mesh) || !part || part === 'body' || !object.parent) return;
    const positions = object.geometry.getAttribute('position');
    if (!positions?.count) return;

    const sampleCount = Math.min(ATTACHMENT_SAMPLE_COUNT, positions.count);
    const bodyVertexSamples: MorphAttachment['bodyVertexSamples'] = [];
    const bodyToParentMatrices = new Map<SkinnedMesh, Matrix3>();
    const parentWorldInverse = new Matrix4().copy(object.parent.matrixWorld).invert();
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      const vertexIndex = Math.round(sampleIndex * (positions.count - 1) / Math.max(1, sampleCount - 1));
      const samplePosition = new Vector3().fromBufferAttribute(positions, vertexIndex);
      object.localToWorld(samplePosition);

      const nearestVertices: { mesh: SkinnedMesh; index: number; distanceSquared: number }[] = [];
      for (const bodyMesh of bodyMeshes) {
        const bodyPositions = bodyMesh.geometry.getAttribute('position');
        const bodyPosition = samplePosition.clone();
        bodyMesh.worldToLocal(bodyPosition);
        for (let index = 0; index < bodyPositions.count; index += 1) {
          const dx = bodyPositions.getX(index) - bodyPosition.x;
          const dy = bodyPositions.getY(index) - bodyPosition.y;
          const dz = bodyPositions.getZ(index) - bodyPosition.z;
          const distanceSquared = dx * dx + dy * dy + dz * dz;
          if (nearestVertices.length === BODY_VERTEX_NEIGHBOR_COUNT
            && distanceSquared >= nearestVertices[nearestVertices.length - 1].distanceSquared) continue;

          nearestVertices.push({ mesh: bodyMesh, index, distanceSquared });
          nearestVertices.sort((left, right) => left.distanceSquared - right.distanceSquared);
          if (nearestVertices.length > BODY_VERTEX_NEIGHBOR_COUNT) nearestVertices.pop();
        }
      }

      if (nearestVertices.length === 0) continue;
      const exactMatches = nearestVertices.filter(({ distanceSquared }) => distanceSquared <= 1e-12);
      const neighbors = exactMatches.length > 0 ? exactMatches : nearestVertices;
      const totalWeight = neighbors.reduce(
        (total, { distanceSquared }) => total + (exactMatches.length > 0 ? 1 : 1 / Math.sqrt(distanceSquared)),
        0,
      );
      for (const { mesh, index, distanceSquared } of neighbors) {
        const neighborWeight = exactMatches.length > 0 ? 1 : 1 / Math.sqrt(distanceSquared);
        let bodyToParent = bodyToParentMatrices.get(mesh);
        if (!bodyToParent) {
          bodyToParent = new Matrix3().setFromMatrix4(
            parentWorldInverse.clone().multiply(mesh.matrixWorld),
          );
          bodyToParentMatrices.set(mesh, bodyToParent);
        }
        bodyVertexSamples.push({
          mesh,
          index,
          weight: neighborWeight / totalWeight / sampleCount,
          bodyToParent,
        });
      }
    }

    attachments.push({
      mesh: object,
      basePosition: object.position.clone(),
      bodyVertexSamples,
    });
  });
  return attachments;
}

export function CC3ModelPreview({
  previewUrl,
  eyePreviewUrl,
  skinPreview,
  morphPreviewUrl,
  morphDeltaBaseUrl,
  morphDeltaSha256,
  morphPresetDeltaBaseUrl,
  morphPresetDeltaSha256,
  visible,
  morphs,
  controls,
  onClientMorphPreviewState,
  onSkinPreviewError,
}: {
  previewUrl: string;
  eyePreviewUrl: string | null;
  skinPreview: SkinPreviewTextures | null;
  morphPreviewUrl: string | null;
  morphDeltaBaseUrl: string | null;
  morphDeltaSha256: string | null;
  morphPresetDeltaBaseUrl: string | null;
  morphPresetDeltaSha256: string | null;
  visible: Record<ModelPartKey, boolean>;
  morphs: Record<CC3MorphControl, number>;
  controls: CC3MorphControlSpec[];
  onClientMorphPreviewState: (status: MorphPreviewStatus, error: string) => void;
  onSkinPreviewError: (message: string) => void;
}) {
  const gltf = useLoader(GLTFLoader, previewUrl, configureGltfLoader);
  const invalidate = useThree((state) => state.invalidate);
  const [eyePreviewReady, setEyePreviewReady] = useState(false);
  const markEyePreviewReady = useCallback(() => setEyePreviewReady(true), []);
  const markEyePresetError = useCallback(
    (error: string) => onClientMorphPreviewState('error', error),
    [onClientMorphPreviewState],
  );
  const previewVisibility = useMemo(
    () => eyePreviewReady ? { ...visible, eyes: false } : visible,
    [eyePreviewReady, visible],
  );
  useEffect(() => {
    if (!eyePreviewUrl) setEyePreviewReady(false);
  }, [eyePreviewUrl]);
  const { model, textures, materials, attachments } = useMemo(() => {
    const preview = clonePreviewModel(gltf.scene, eyePreviewReady);
    return { ...preview, attachments: createMorphAttachments(preview.model) };
  }, [eyePreviewReady, gltf.scene]);
  const previousState = useRef<{
    model: Object3D;
    controls: CC3MorphControlSpec[];
    morphs: Record<CC3MorphControl, number>;
  } | null>(null);

  useEffect(() => {
    const previous = previousState.current;
    const changedControls = previous?.model === model && previous.controls === controls
      ? controls.filter(({ id }) => (previous.morphs[id] ?? 0) !== (morphs[id] ?? 0))
      : controls;
    applyPreviewState(model, previewVisibility, morphs, changedControls, attachments);
    previousState.current = { model, controls, morphs };
    invalidate();
  }, [attachments, controls, invalidate, model, morphs, previewVisibility]);

  useEffect(() => () => {
    materials.forEach((material) => material.dispose());
    textures.forEach((texture) => texture.dispose());
  }, [materials, model, textures]);

  useEffect(() => () => {
    if (previewUrl.startsWith('blob:')) useLoader.clear(GLTFLoader, previewUrl);
  }, [previewUrl]);

  const [loadedMorphPreviewUrl, setLoadedMorphPreviewUrl] = useState<string | null>(null);
  const markMorphPreviewLoaded = useCallback((url: string) => {
    setLoadedMorphPreviewUrl(url);
  }, []);

  return <>
    {morphPreviewUrl !== null && loadedMorphPreviewUrl === morphPreviewUrl
      ? null
      : <primitive object={model} />}
    {skinPreview && <Suspense fallback={null}>
      <SkinMaterialPreview
        model={model}
        skinPreview={skinPreview}
        ownedTextures={textures}
        onPreviewError={onSkinPreviewError}
      />
    </Suspense>}
    {morphPreviewUrl && <Suspense fallback={null}>
      <MorphableCC3Preview
        key={`${morphPreviewUrl}:${morphDeltaSha256 ?? ''}`}
        previewUrl={morphPreviewUrl}
        skinPreview={skinPreview}
        onSkinPreviewError={onSkinPreviewError}
        morphDeltaBaseUrl={morphDeltaBaseUrl}
        morphDeltaSha256={morphDeltaSha256}
        morphPresetDeltaBaseUrl={morphPresetDeltaBaseUrl}
        morphPresetDeltaSha256={morphPresetDeltaSha256}
        visible={previewVisibility}
        morphs={morphs}
        controls={controls}
        onLoaded={markMorphPreviewLoaded}
        onStatus={onClientMorphPreviewState}
      />
    </Suspense>}
    {eyePreviewUrl && visible.eyes && <Suspense fallback={null}>
      <EyeAssetPreview
        url={eyePreviewUrl}
        proxyUrl={morphPreviewUrl ?? previewUrl}
        morphs={morphs}
        controls={controls}
        morphDeltaBaseUrl={morphDeltaBaseUrl}
        morphDeltaSha256={morphDeltaSha256}
        presetDeltaBaseUrl={morphPresetDeltaBaseUrl}
        presetDeltaSha256={morphPresetDeltaSha256}
        onMorphError={markEyePresetError}
        onTransitionComplete={markEyePreviewReady}
      />
    </Suspense>}
  </>;
}

function EyeAssetPreview({
  url,
  proxyUrl,
  morphs,
  controls,
  morphDeltaBaseUrl,
  morphDeltaSha256,
  presetDeltaBaseUrl,
  presetDeltaSha256,
  onMorphError,
  onTransitionComplete,
}: {
  url: string;
  proxyUrl: string;
  morphs: Record<CC3MorphControl, number>;
  controls: CC3MorphControlSpec[];
  morphDeltaBaseUrl: string | null;
  morphDeltaSha256: string | null;
  presetDeltaBaseUrl: string | null;
  presetDeltaSha256: string | null;
  onMorphError: (error: string) => void;
  onTransitionComplete: () => void;
}) {
  const [displayed, setDisplayed] = useState<{ url: string; scene: Object3D } | null>(null);
  const [incoming, setIncoming] = useState<{ url: string; scene: Object3D } | null>(null);
  const [progress, setProgress] = useState(1);
  const [readyUrl, setReadyUrl] = useState<string | null>(null);
  const displayedUrl = useRef<string | null>(null);
  const requestedUrl = useRef(url);
  const incomingUrl = useRef<string | null>(null);
  displayedUrl.current = displayed?.url ?? null;
  requestedUrl.current = url;
  const markReady = useCallback((loadedUrl: string) => setReadyUrl(loadedUrl), []);
  const handleAssetLoaded = useCallback((scene: Object3D, loadedUrl: string) => {
    if (requestedUrl.current !== loadedUrl) return;
    if (displayedUrl.current === loadedUrl) return;
    if (incomingUrl.current === loadedUrl) return;
    incomingUrl.current = loadedUrl;
    setReadyUrl(null);
    setProgress(0);
    setIncoming({ url: loadedUrl, scene });
  }, []);

  useEffect(() => {
    if (!incoming || readyUrl !== incoming.url) return undefined;
    let frame = 0;
    const startedAt = performance.now();
    const animate = (timestamp: number) => {
      const nextProgress = Math.min(1, (timestamp - startedAt) / EYE_TRANSITION_DURATION_MS);
      setProgress(nextProgress);
      if (nextProgress < 1) {
        frame = requestAnimationFrame(animate);
        return;
      }
      displayedUrl.current = incoming.url;
      setDisplayed(incoming);
      incomingUrl.current = null;
      setIncoming(null);
      if (requestedUrl.current === incoming.url) onTransitionComplete();
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [incoming, onTransitionComplete, readyUrl]);

  return <>
    <Suspense fallback={null}>
      <EyeAssetLoader url={url} onLoaded={handleAssetLoaded} />
    </Suspense>
    {displayed && <EyeAssetLayer
      key={displayed.url}
      scene={displayed.scene}
      proxyUrl={proxyUrl}
      opacity={incoming ? (readyUrl === incoming.url ? 1 - progress : 1) : 1}
      morphs={morphs}
      controls={controls}
      morphDeltaBaseUrl={morphDeltaBaseUrl}
      morphDeltaSha256={morphDeltaSha256}
      presetDeltaBaseUrl={presetDeltaBaseUrl}
      presetDeltaSha256={presetDeltaSha256}
      onMorphError={onMorphError}
    />}
    {incoming && <EyeAssetLayer
      key={incoming.url}
      scene={incoming.scene}
      proxyUrl={proxyUrl}
      opacity={readyUrl === incoming.url ? progress : 0}
      readyUrl={incoming.url}
      onReady={markReady}
      morphs={morphs}
      controls={controls}
      morphDeltaBaseUrl={morphDeltaBaseUrl}
      morphDeltaSha256={morphDeltaSha256}
      presetDeltaBaseUrl={presetDeltaBaseUrl}
      presetDeltaSha256={presetDeltaSha256}
      onMorphError={onMorphError}
    />}
  </>;
}

function EyeAssetLoader({
  url,
  onLoaded,
}: {
  url: string;
  onLoaded: (scene: Object3D, url: string) => void;
}) {
  const gltf = useLoader(GLTFLoader, url, configureGltfLoader);
  useEffect(() => onLoaded(gltf.scene, url), [gltf.scene, onLoaded, url]);
  return null;
}

type EyeBodyBinding = {
  bodyPrimitive: number;
  bodyVertex: number;
  weight: number;
};
type EyeAccessoryBinding = {
  proxyGeometryKey: string;
  proxyVertex: number;
  weight: number;
};

function createEyeBodyBindings(
  proxyScene: Object3D,
  eyeGeometries: Map<string, Mesh['geometry']>,
): {
  bodyBindings: Map<string, EyeBodyBinding[][]>;
  accessoryBindings: Map<string, EyeAccessoryBinding[][]>;
  bodyGeometries: Map<number, Mesh['geometry']>;
  accessoryGeometries: Map<string, Mesh['geometry']>;
} {
  proxyScene.updateMatrixWorld(true);
  const bodyCells = new Map<string, { primitive: number; vertex: number; position: Vector3 }[]>();
  const accessoryCells = new Map<number, Map<string, { geometryKey: string; vertex: number; position: Vector3 }[]>>();
  const bodyGeometries = new Map<number, Mesh['geometry']>();
  const accessoryGeometries = new Map<string, Mesh['geometry']>();
  const cellSize = 0.025;
  const cellFor = (x: number, y: number, z: number) => (
    `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}:${Math.floor(z / cellSize)}`
  );
  proxyScene.traverse((object) => {
    if (!(object instanceof Mesh) || object.geometry.userData.comodel_proxy_mesh_index !== 0) return;
    const primitive = object.geometry.userData.comodel_proxy_primitive_index;
    if (!Number.isInteger(primitive)) return;
    bodyGeometries.set(primitive, object.geometry);
    const positions = object.geometry.getAttribute('position');
    for (let vertex = 0; vertex < positions.count; vertex += 1) {
      const position = new Vector3().fromBufferAttribute(positions, vertex);
      const cell = cellFor(position.x, position.y, position.z);
      const points = bodyCells.get(cell) ?? [];
      points.push({ primitive, vertex, position });
      bodyCells.set(cell, points);
    }
  });
  if (bodyCells.size === 0) throw new Error('The CC5 morph proxy is missing body surface geometry.');

  proxyScene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const meshIndex = object.geometry.userData.comodel_proxy_mesh_index;
    const primitive = object.geometry.userData.comodel_proxy_primitive_index;
    if (!Number.isInteger(meshIndex) || meshIndex < 1 || meshIndex > 3 || !Number.isInteger(primitive)) return;
    const geometryKey = `${meshIndex}:${primitive}`;
    accessoryGeometries.set(geometryKey, object.geometry);
    const positions = object.geometry.getAttribute('position');
    let cells = accessoryCells.get(meshIndex);
    if (!cells) {
      cells = new Map();
      accessoryCells.set(meshIndex, cells);
    }
    for (let vertex = 0; vertex < positions.count; vertex += 1) {
      const position = new Vector3().fromBufferAttribute(positions, vertex);
      const cell = cellFor(position.x, position.y, position.z);
      const points = cells.get(cell) ?? [];
      points.push({ geometryKey, vertex, position });
      cells.set(cell, points);
    }
  });

  const bodyBindings = new Map<string, EyeBodyBinding[][]>();
  const accessoryBindings = new Map<string, EyeAccessoryBinding[][]>();
  for (const [key, geometry] of eyeGeometries) {
    const meshIndex = Number(key.split(':', 1)[0]);
    const positions = geometry.getAttribute('position');
    const bodyVertexBindings: EyeBodyBinding[][] = [];
    const accessoryVertexBindings: EyeAccessoryBinding[][] = [];
    const proxyAccessoryCells = accessoryCells.get(meshIndex);
    for (let vertex = 0; vertex < positions.count; vertex += 1) {
      const eyePosition = new Vector3()
        .fromBufferAttribute(positions, vertex)
        .multiplyScalar(EYE_ASSET_TO_PROXY_SCALE);
      const cell = eyePosition.clone().divideScalar(cellSize).floor();
      const nearestBody: { point: { primitive: number; vertex: number; position: Vector3 }; distanceSquared: number }[] = [];
      for (let radius = 0; radius <= 2; radius += 1) {
        for (let x = -radius; x <= radius; x += 1) {
          for (let y = -radius; y <= radius; y += 1) {
            for (let z = -radius; z <= radius; z += 1) {
              if (radius > 0 && Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) !== radius) continue;
              const points = bodyCells.get(`${cell.x + x}:${cell.y + y}:${cell.z + z}`);
              if (!points) continue;
              for (const point of points) {
                const distanceSquared = point.position.distanceToSquared(eyePosition);
                let insertionIndex = nearestBody.findIndex((entry) => distanceSquared < entry.distanceSquared);
                if (insertionIndex < 0 && nearestBody.length < 4) insertionIndex = nearestBody.length;
                if (insertionIndex < 0) continue;
                nearestBody.splice(insertionIndex, 0, { point, distanceSquared });
                if (nearestBody.length > 4) nearestBody.pop();
              }
            }
          }
        }
        if (nearestBody.length === 4) break;
      }
      if (nearestBody.length === 0) throw new Error('Could not map selected eye geometry to the character surface.');
      const exact = nearestBody.find(({ distanceSquared }) => distanceSquared < 1e-12);
      const totalWeight = exact
        ? 1
        : nearestBody.reduce((sum, { distanceSquared }) => sum + 1 / Math.sqrt(distanceSquared), 0);
      bodyVertexBindings.push(nearestBody.map(({ point, distanceSquared }) => ({
        bodyPrimitive: point.primitive,
        bodyVertex: point.vertex,
        weight: exact
          ? Number(point === exact.point)
          : 1 / Math.sqrt(distanceSquared) / totalWeight,
      })));

      if (proxyAccessoryCells) {
        const nearestAccessory: {
          point: { geometryKey: string; vertex: number; position: Vector3 };
          distanceSquared: number;
        }[] = [];
        for (let radius = 0; radius <= 2; radius += 1) {
          for (let x = -radius; x <= radius; x += 1) {
            for (let y = -radius; y <= radius; y += 1) {
              for (let z = -radius; z <= radius; z += 1) {
                if (radius > 0 && Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) !== radius) continue;
                const points = proxyAccessoryCells.get(`${cell.x + x}:${cell.y + y}:${cell.z + z}`);
                if (!points) continue;
                for (const point of points) {
                  const distanceSquared = point.position.distanceToSquared(eyePosition);
                  let insertionIndex = nearestAccessory.findIndex((entry) => distanceSquared < entry.distanceSquared);
                  if (insertionIndex < 0 && nearestAccessory.length < 4) insertionIndex = nearestAccessory.length;
                  if (insertionIndex < 0) continue;
                  nearestAccessory.splice(insertionIndex, 0, { point, distanceSquared });
                  if (nearestAccessory.length > 4) nearestAccessory.pop();
                }
              }
            }
          }
          if (nearestAccessory.length === 4) break;
        }
        if (nearestAccessory.length === 0) {
          throw new Error('Could not map selected eye geometry to its CC5 eye surface.');
        }
        const exactAccessory = nearestAccessory.find(({ distanceSquared }) => distanceSquared < 1e-12);
        const accessoryWeightTotal = exactAccessory
          ? 1
          : nearestAccessory.reduce((sum, { distanceSquared }) => sum + 1 / Math.sqrt(distanceSquared), 0);
        accessoryVertexBindings.push(nearestAccessory.map(({ point, distanceSquared }) => ({
          proxyGeometryKey: point.geometryKey,
          proxyVertex: point.vertex,
          weight: exactAccessory
            ? Number(point === exactAccessory.point)
            : 1 / Math.sqrt(distanceSquared) / accessoryWeightTotal,
        })));
      }
    }
    bodyBindings.set(key, bodyVertexBindings);
    if (accessoryVertexBindings.length > 0) accessoryBindings.set(key, accessoryVertexBindings);
  }
  return { bodyBindings, accessoryBindings, bodyGeometries, accessoryGeometries };
}

function EyeAssetLayer({
  scene,
  proxyUrl,
  opacity,
  readyUrl,
  onReady,
  morphs,
  controls,
  morphDeltaBaseUrl,
  morphDeltaSha256,
  presetDeltaBaseUrl,
  presetDeltaSha256,
  onMorphError,
}: {
  scene: Object3D;
  proxyUrl: string;
  opacity: number;
  readyUrl?: string;
  onReady?: (url: string) => void;
  morphs: Record<CC3MorphControl, number>;
  controls: CC3MorphControlSpec[];
  morphDeltaBaseUrl: string | null;
  morphDeltaSha256: string | null;
  presetDeltaBaseUrl: string | null;
  presetDeltaSha256: string | null;
  onMorphError: (error: string) => void;
}) {
  const invalidate = useThree((state) => state.invalidate);
  const [morphInitialized, setMorphInitialized] = useState(!readyUrl);
  const markMorphInitialized = useCallback((loadedUrl: string) => {
    setMorphInitialized(true);
    onReady?.(loadedUrl);
  }, [onReady]);
  const model = useMemo(() => {
    const clone = cloneRiggedModel(scene);
    const materials = new Set<Material>();
    const baseOpacities = new Map<Material, number>();
    const eyeGeometries = new Map<string, Mesh['geometry']>();
    const nextPrimitiveByMesh = new Map<number, number>();
    clone.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const meshIndex = eyeAssetMeshIndex(object.name);
      if (meshIndex !== undefined) {
        const primitiveIndex = nextPrimitiveByMesh.get(meshIndex) ?? 0;
        nextPrimitiveByMesh.set(meshIndex, primitiveIndex + 1);
        const key = `${meshIndex}:${primitiveIndex}`;
        const geometry = object.geometry.clone();
        object.geometry = geometry;
        eyeGeometries.set(key, geometry);
      }
      const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
      const clonedMaterials = sourceMaterials.map((source) => {
        const material = source.clone();
        const baseOpacity = material.opacity;
        material.transparent = true;
        material.depthWrite = false;
        if (readyUrl) material.opacity = 0;
        materials.add(material);
        baseOpacities.set(material, baseOpacity);
        return material;
      });
      object.material = Array.isArray(object.material) ? clonedMaterials : clonedMaterials[0];
    });
    const basePositions = new Map<string, Float32Array>();
    for (const [key, geometry] of eyeGeometries) {
      const positions = geometry.getAttribute('position');
      if (!(positions?.array instanceof Float32Array)) {
        throw new Error('The selected eye asset is missing supported vertex positions.');
      }
      basePositions.set(key, positions.array.slice());
    }
    return { clone, materials, baseOpacities, eyeGeometries, basePositions };
  }, [scene]);
  useEffect(() => () => {
    model.materials.forEach((material) => material.dispose());
    model.eyeGeometries.forEach((geometry) => geometry.dispose());
  }, [model]);
  useEffect(() => {
    model.clone.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
      sourceMaterials.forEach((material) => {
        material.opacity = (model.baseOpacities.get(material) ?? 1) * opacity;
        material.needsUpdate = true;
      });
    });
    invalidate();
  }, [invalidate, model, opacity]);
  useEffect(() => {
    if (!morphDeltaBaseUrl && readyUrl) markMorphInitialized(readyUrl);
  }, [markMorphInitialized, morphDeltaBaseUrl, readyUrl]);
  return <>
    {morphDeltaBaseUrl && <EyeAssetMorphController
      proxyUrl={proxyUrl}
      eyeGeometries={model.eyeGeometries}
      basePositions={model.basePositions}
      morphs={morphs}
      controls={controls}
      morphDeltaBaseUrl={morphDeltaBaseUrl}
      morphDeltaSha256={morphDeltaSha256}
      presetDeltaBaseUrl={presetDeltaBaseUrl}
      presetDeltaSha256={presetDeltaSha256}
      readyUrl={readyUrl}
      onReady={markMorphInitialized}
      onMorphError={onMorphError}
    />}
    <group scale={0.01} visible={!readyUrl || morphInitialized}>
      <primitive object={model.clone} />
    </group>
  </>;
}

function EyeAssetMorphController({
  proxyUrl,
  eyeGeometries,
  basePositions,
  morphs,
  controls,
  morphDeltaBaseUrl,
  morphDeltaSha256,
  presetDeltaBaseUrl,
  presetDeltaSha256,
  readyUrl,
  onReady,
  onMorphError,
}: {
  proxyUrl: string;
  eyeGeometries: Map<string, Mesh['geometry']>;
  basePositions: Map<string, Float32Array>;
  morphs: Record<CC3MorphControl, number>;
  controls: CC3MorphControlSpec[];
  morphDeltaBaseUrl: string;
  morphDeltaSha256: string | null;
  presetDeltaBaseUrl: string | null;
  presetDeltaSha256: string | null;
  readyUrl?: string;
  onReady?: (url: string) => void;
  onMorphError: (error: string) => void;
}) {
  const gltf = useLoader(GLTFLoader, proxyUrl, configureGltfLoader);
  const invalidate = useThree((state) => state.invalidate);
  const surface = useMemo(
    () => createEyeBodyBindings(gltf.scene, eyeGeometries),
    [eyeGeometries, gltf.scene],
  );
  const currentDeltas = useRef(new Map<string, Float32Array>());
  const deltaCache = useRef(new Map<CC3MorphControl, MorphDeltaTarget>());
  const deltaCacheBytes = useRef(0);
  const pendingDeltas = useRef(new Map<CC3MorphControl, Promise<MorphDeltaTarget>>());
  const requestId = useRef(0);
  const initialMorphApplied = useRef(false);

  useEffect(() => {
    const currentRequestId = ++requestId.current;
    let frame = 0;
    const activeControls = controls.filter(({ id }) => (morphs[id] ?? 0) !== 0);
    const loadDelta = (control: CC3MorphControlSpec) => {
      const cached = deltaCache.current.get(control.id);
      if (cached) {
        deltaCache.current.delete(control.id);
        deltaCache.current.set(control.id, cached);
        return Promise.resolve(cached);
      }
      const pending = pendingDeltas.current.get(control.id);
      if (pending) return pending;
      const deltaBaseUrl = control.isPreset ? presetDeltaBaseUrl : morphDeltaBaseUrl;
      const deltaHash = control.isPreset ? presetDeltaSha256 : morphDeltaSha256;
      if (!deltaBaseUrl || !deltaHash) {
        return Promise.reject(new Error(`Deformation data for "${control.label}" is unavailable.`));
      }
      const deltaUrl = control.isPreset
        ? `${deltaBaseUrl}/${encodeURIComponent(control.id)}/delta`
        : `${deltaBaseUrl}${encodeURIComponent(control.id)}`;
      const request = fetch(`${deltaUrl}?delta_sha256=${encodeURIComponent(deltaHash)}`)
        .then(async (response) => {
          if (!response.ok) {
            const responseBody = await response.json().catch(() => null);
            const detail = responseBody && typeof responseBody === 'object' && 'detail' in responseBody
              ? responseBody.detail
              : null;
            const message = typeof detail === 'string'
              ? detail
              : detail && typeof detail === 'object' && 'message' in detail
                ? String(detail.message)
                : `Could not load deformation data for "${control.label}".`;
            throw new Error(message);
          }
          return parseMorphDeltaTarget(await response.arrayBuffer());
        })
        .then((target) => {
          deltaCache.current.set(control.id, target);
          deltaCacheBytes.current += target.byteLength;
          while (deltaCacheBytes.current > 64 * 1024 * 1024 && deltaCache.current.size > 1) {
            const oldestId = deltaCache.current.keys().next().value;
            if (!oldestId) break;
            const oldest = deltaCache.current.get(oldestId);
            if (oldest) deltaCacheBytes.current -= oldest.byteLength;
            deltaCache.current.delete(oldestId);
          }
          return target;
        })
        .finally(() => pendingDeltas.current.delete(control.id));
      pendingDeltas.current.set(control.id, request);
      return request;
    };

    void Promise.all(activeControls.map(async (control) => [
      control,
      await loadDelta(control),
    ] as const)).then((loadedTargets) => {
      if (currentRequestId !== requestId.current) return;
      const targetDeltas = new Map<string, Float32Array>();
      const bodyDeltas = new Map<number, Float32Array>();
      const accessoryDeltas = new Map<string, Float32Array>();
      const proxyToEyeLocalScale = 1 / EYE_ASSET_TO_PROXY_SCALE;
      const addRecords = (
        control: CC3MorphControlSpec,
        records: MorphDeltaRecord[],
        value: number,
      ) => {
        const amount = Math.abs(value);
        for (const record of records) {
          if (record.meshIndex === 0) {
            if (control.isPreset) continue;
            const bodyGeometry = surface.bodyGeometries.get(record.primitiveIndex);
            if (!bodyGeometry) throw new Error('The CC5 morph proxy is missing a body surface primitive.');
            const bodyDelta = bodyDeltas.get(record.primitiveIndex)
              ?? new Float32Array(bodyGeometry.getAttribute('position').count * 3);
            for (let vertex = 0; vertex < record.vertexIndices.length; vertex += 1) {
              const vertexIndex = record.vertexIndices[vertex];
              const index = vertexIndex * 3;
              if (index + 2 >= bodyDelta.length) {
                throw new Error('A character morph references a vertex outside the body proxy.');
              }
              bodyDelta[index] += record.deltas[vertex * 3] * amount;
              bodyDelta[index + 1] += record.deltas[vertex * 3 + 1] * amount;
              bodyDelta[index + 2] += record.deltas[vertex * 3 + 2] * amount;
            }
            bodyDeltas.set(record.primitiveIndex, bodyDelta);
            continue;
          }
          const key = `${record.meshIndex}:${record.primitiveIndex}`;
          const proxyGeometry = surface.accessoryGeometries.get(key);
          if (!proxyGeometry) continue;
          const delta = accessoryDeltas.get(key)
            ?? new Float32Array(proxyGeometry.getAttribute('position').count * 3);
          for (let vertex = 0; vertex < record.vertexIndices.length; vertex += 1) {
            const vertexIndex = record.vertexIndices[vertex];
            const index = vertexIndex * 3;
            if (index + 2 >= delta.length) {
              throw new Error('A character morph references a vertex outside the selected eye asset.');
            }
            delta[index] += record.deltas[vertex * 3] * amount;
            delta[index + 1] += record.deltas[vertex * 3 + 1] * amount;
            delta[index + 2] += record.deltas[vertex * 3 + 2] * amount;
          }
          accessoryDeltas.set(key, delta);
        }
      };

      for (const [control, target] of loadedTargets) {
        const value = morphs[control.id] ?? 0;
        addRecords(control, value < 0 ? target.negative : target.positive, value);
      }

      for (const [key, bodyVertexBindings] of surface.bodyBindings) {
        const base = basePositions.get(key);
        if (!base) throw new Error('The selected eye asset is missing a morph base geometry.');
        const delta = targetDeltas.get(key) ?? new Float32Array(base.length);
        // Proxy deltas are in meters; eye asset vertices use centimeter-like local coordinates.
        for (let eyeVertex = 0; eyeVertex < bodyVertexBindings.length; eyeVertex += 1) {
          const eyeOffset = eyeVertex * 3;
          for (const binding of bodyVertexBindings[eyeVertex]) {
            const bodyDelta = bodyDeltas.get(binding.bodyPrimitive);
            if (!bodyDelta) continue;
            const bodyOffset = binding.bodyVertex * 3;
            delta[eyeOffset] += bodyDelta[bodyOffset] * binding.weight * proxyToEyeLocalScale;
            delta[eyeOffset + 1] += bodyDelta[bodyOffset + 1] * binding.weight * proxyToEyeLocalScale;
            delta[eyeOffset + 2] += bodyDelta[bodyOffset + 2] * binding.weight * proxyToEyeLocalScale;
          }
        }
        const accessoryVertexBindings = surface.accessoryBindings.get(key);
        if (accessoryVertexBindings) {
          for (let eyeVertex = 0; eyeVertex < accessoryVertexBindings.length; eyeVertex += 1) {
            const eyeOffset = eyeVertex * 3;
            for (const binding of accessoryVertexBindings[eyeVertex]) {
              const accessoryDelta = accessoryDeltas.get(binding.proxyGeometryKey);
              if (!accessoryDelta) continue;
              const proxyOffset = binding.proxyVertex * 3;
              delta[eyeOffset] += accessoryDelta[proxyOffset] * binding.weight * proxyToEyeLocalScale;
              delta[eyeOffset + 1] += accessoryDelta[proxyOffset + 1] * binding.weight * proxyToEyeLocalScale;
              delta[eyeOffset + 2] += accessoryDelta[proxyOffset + 2] * binding.weight * proxyToEyeLocalScale;
            }
          }
        }
        targetDeltas.set(key, delta);
      }
      const startDeltas = currentDeltas.current;
      if (!initialMorphApplied.current) {
        for (const [key, geometry] of eyeGeometries) {
          const base = basePositions.get(key);
          if (!base) continue;
          const delta = targetDeltas.get(key) ?? new Float32Array(base.length);
          const positions = geometry.getAttribute('position');
          const values = positions.array;
          for (let index = 0; index < base.length; index += 1) {
            values[index] = base[index] + delta[index];
          }
          positions.needsUpdate = true;
          geometry.computeVertexNormals();
        }
        currentDeltas.current = targetDeltas;
        initialMorphApplied.current = true;
        invalidate();
        if (readyUrl) onReady?.(readyUrl);
        return;
      }
      const startedAt = performance.now();
      const animate = (timestamp: number) => {
        if (currentRequestId !== requestId.current) return;
        const progress = Math.min(1, (timestamp - startedAt) / PRESET_TRANSITION_DURATION_MS);
        const easedProgress = progress * progress * (3 - 2 * progress);
        const interpolatedDeltas = new Map<string, Float32Array>();
        for (const [key, geometry] of eyeGeometries) {
          const base = basePositions.get(key);
          if (!base) continue;
          const start = startDeltas.get(key);
          const end = targetDeltas.get(key);
          const current = new Float32Array(base.length);
          const positions = geometry.getAttribute('position');
          const values = positions.array;
          for (let index = 0; index < base.length; index += 1) {
            const delta = (start?.[index] ?? 0) * (1 - easedProgress)
              + (end?.[index] ?? 0) * easedProgress;
            current[index] = delta;
            values[index] = base[index] + delta;
          }
          interpolatedDeltas.set(key, current);
          positions.needsUpdate = true;
          geometry.computeVertexNormals();
        }
        currentDeltas.current = interpolatedDeltas;
        invalidate();
        if (progress < 1) frame = requestAnimationFrame(animate);
      };
      frame = requestAnimationFrame(animate);
    }).catch((error: unknown) => {
      if (currentRequestId !== requestId.current) return;
      onMorphError(error instanceof Error ? error.message : 'Could not apply morphs to the selected eyes.');
    });

    return () => {
      requestId.current += 1;
      cancelAnimationFrame(frame);
    };
  }, [
    basePositions,
    controls,
    eyeGeometries,
    invalidate,
    morphDeltaBaseUrl,
    morphDeltaSha256,
    morphs,
    onReady,
    onMorphError,
    presetDeltaBaseUrl,
    presetDeltaSha256,
    readyUrl,
    surface,
  ]);
  return null;
}

function applyPreviewState(
  model: ReturnType<typeof cloneRiggedModel>,
  visible: Record<ModelPartKey, boolean>,
  morphs: Record<CC3MorphControl, number>,
  controls: CC3MorphControlSpec[],
  attachments: MorphAttachment[],
) {
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const part = modelPartForMesh(object.name);
    if (part) object.visible = visible[part];

    const dictionary = object.morphTargetDictionary;
    const influences = object.morphTargetInfluences;
    if (!dictionary || !influences) return;
    for (const { id, positive_shape_key, negative_shape_key } of controls) {
      const value = morphs[id] ?? 0;
      const positiveIndex = positive_shape_key ? dictionary[positive_shape_key] : undefined;
      const negativeIndex = negative_shape_key ? dictionary[negative_shape_key] : undefined;
      if (positiveIndex !== undefined) influences[positiveIndex] = Math.max(value, 0);
      if (negativeIndex !== undefined) influences[negativeIndex] = Math.max(-value, 0);
    }
  });

  if (controls.length === 0) return;

  const basePosition = new Vector3();
  const deformedPosition = new Vector3();
  const baseSkinnedPosition = new Vector3();
  for (const attachment of attachments) {
    const offset = new Vector3();
    let sampleWeight = 0;
    for (const { mesh, index, weight, bodyToParent } of attachment.bodyVertexSamples) {
      const base = mesh.geometry.getAttribute('position');
      basePosition.fromBufferAttribute(base, index);
      mesh.getVertexPosition(index, deformedPosition);
      baseSkinnedPosition.copy(basePosition);
      mesh.applyBoneTransform(index, baseSkinnedPosition);
      deformedPosition.sub(baseSkinnedPosition).applyMatrix3(bodyToParent);
      offset.addScaledVector(deformedPosition, weight);
      sampleWeight += weight;
    }

    if (sampleWeight > 0) offset.multiplyScalar(1 / sampleWeight);
    attachment.mesh.position.copy(attachment.basePosition).add(offset);
  }
}

function MorphableCC3Preview({
  previewUrl,
  skinPreview,
  onSkinPreviewError,
  morphDeltaBaseUrl,
  morphDeltaSha256,
  morphPresetDeltaBaseUrl,
  morphPresetDeltaSha256,
  visible,
  morphs,
  controls,
  onLoaded,
  onStatus,
}: {
  previewUrl: string;
  skinPreview: SkinPreviewTextures | null;
  onSkinPreviewError: (message: string) => void;
  morphDeltaBaseUrl: string | null;
  morphDeltaSha256: string | null;
  morphPresetDeltaBaseUrl: string | null;
  morphPresetDeltaSha256: string | null;
  visible: Record<ModelPartKey, boolean>;
  morphs: Record<CC3MorphControl, number>;
  controls: CC3MorphControlSpec[];
  onLoaded: (url: string) => void;
  onStatus: (status: MorphPreviewStatus, error: string) => void;
}) {
  const gltf = useLoader(GLTFLoader, previewUrl, configureGltfLoader);
  const invalidate = useThree((state) => state.invalidate);
  const { model, textures, materials, attachments, proxyGeometries } = useMemo(() => {
    const { model: clonedModel, textures: clonedTextures, materials: clonedMaterials } = clonePreviewModel(
      gltf.scene,
    );
    const proxyGeometries = morphDeltaBaseUrl
      ? cloneMorphProxyGeometries(clonedModel)
      : new Map<string, MorphProxyGeometry>();
    return {
      model: clonedModel,
      textures: clonedTextures,
      materials: clonedMaterials,
      attachments: createMorphAttachments(clonedModel),
      proxyGeometries,
    };
  }, [gltf.scene, morphDeltaBaseUrl]);
  const previousState = useRef<{
    model: Object3D;
    controls: CC3MorphControlSpec[];
    morphs: Record<CC3MorphControl, number>;
  } | null>(null);
  const morphDeltaCache = useRef(new Map<CC3MorphControl, MorphDeltaTarget>());
  const pendingMorphDeltas = useRef(new Map<CC3MorphControl, Promise<MorphDeltaTarget>>());
  const morphDeltaCacheBytes = useRef(0);
  const requestSequence = useRef(0);
  const animationFrame = useRef<number | null>(null);
  const appliedProxyMorphs = useRef<{
    model: Object3D;
    values: Map<CC3MorphControl, number>;
  } | null>(null);

  useEffect(() => {
    if (morphDeltaBaseUrl) {
      const requestId = ++requestSequence.current;
      const appliedState = appliedProxyMorphs.current?.model === model
        ? appliedProxyMorphs.current
        : { model, values: new Map<CC3MorphControl, number>() };
      const changedControls = controls.filter(
        ({ id }) => (appliedState.values.get(id) ?? 0) !== (morphs[id] ?? 0),
      );
      const presetIds = new Set(
        controls.filter(({ isPreset }) => isPreset).map(({ id }) => id),
      );
      const loadControl = (id: CC3MorphControl): Promise<MorphDeltaTarget> => {
        const cached = morphDeltaCache.current.get(id);
        if (cached) {
          morphDeltaCache.current.delete(id);
          morphDeltaCache.current.set(id, cached);
          return Promise.resolve(cached);
        }
        const pending = pendingMorphDeltas.current.get(id);
        if (pending) return pending;

        const presetDelta = presetIds.has(id);
        const deltaUrl = presetDelta
          ? `${morphPresetDeltaBaseUrl}/${encodeURIComponent(id)}/delta`
          : `${morphDeltaBaseUrl}${encodeURIComponent(id)}`;
        const deltaHash = presetDelta ? morphPresetDeltaSha256 : morphDeltaSha256;
        if (!deltaUrl || !deltaHash) {
          return Promise.reject(new Error('The selected CC5 character preset data is unavailable.'));
        }
        const request = fetch(
          `${deltaUrl}?delta_sha256=${encodeURIComponent(deltaHash)}`,
        )
          .then(async (response) => {
            if (!response.ok) {
              const responseBody = await response.json().catch(() => null);
              const detail = responseBody && typeof responseBody === 'object' && 'detail' in responseBody
                ? responseBody.detail
                : null;
              const message = typeof detail === 'string'
                ? detail
                : detail && typeof detail === 'object' && 'message' in detail
                  ? String(detail.message)
                  : 'Could not load the cached CC5 morph detail.';
              throw new Error(message);
            }
            return parseMorphDeltaTarget(await response.arrayBuffer());
          })
          .then((target) => {
            morphDeltaCache.current.set(id, target);
            morphDeltaCacheBytes.current += target.byteLength;
            while (morphDeltaCacheBytes.current > 64 * 1024 * 1024 && morphDeltaCache.current.size > 1) {
              const oldestId = morphDeltaCache.current.keys().next().value;
              if (!oldestId) break;
              const oldest = morphDeltaCache.current.get(oldestId);
              if (oldest) morphDeltaCacheBytes.current -= oldest.byteLength;
              morphDeltaCache.current.delete(oldestId);
            }
            return target;
          })
          .finally(() => pendingMorphDeltas.current.delete(id));
        pendingMorphDeltas.current.set(id, request);
        return request;
      };

      const needsNetworkLoad = changedControls.some(({ id }) => !morphDeltaCache.current.has(id));
      if (needsNetworkLoad) onStatus('updating', '');
      else if (changedControls.length === 0) onStatus('idle', '');
      void Promise.all(changedControls.map(async ({ id }) => [id, await loadControl(id)] as const))
        .then((loadedTargets) => {
          if (requestId !== requestSequence.current) return;
          const targets = new Map(loadedTargets);
          if (changedControls.some(({ isPreset }) => isPreset)) {
            const startValues = new Map(
              changedControls.map(({ id }) => [id, appliedState.values.get(id) ?? 0]),
            );
            const startedAt = performance.now();
            onLoaded(previewUrl);
            const animatePreset = (timestamp: number) => {
              if (requestId !== requestSequence.current) return;
              const progress = Math.min(1, (timestamp - startedAt) / PRESET_TRANSITION_DURATION_MS);
              const easedProgress = progress * progress * (3 - 2 * progress);
              const frameMorphs = { ...morphs };
              for (const { id } of changedControls) {
                const start = startValues.get(id) ?? 0;
                const end = morphs[id] ?? 0;
                frameMorphs[id] = start + (end - start) * easedProgress;
              }
              applyMorphProxyState(
                model,
                visible,
                frameMorphs,
                changedControls,
                targets,
                proxyGeometries,
                appliedState.values,
              );
              appliedProxyMorphs.current = appliedState;
              invalidate();
              if (progress < 1) {
                animationFrame.current = requestAnimationFrame(animatePreset);
              } else {
                animationFrame.current = null;
                onStatus('idle', '');
              }
            };
            animationFrame.current = requestAnimationFrame(animatePreset);
          } else {
            applyMorphProxyState(
              model,
              visible,
              morphs,
              changedControls,
              targets,
              proxyGeometries,
              appliedState.values,
            );
            appliedProxyMorphs.current = appliedState;
            invalidate();
            onStatus('idle', '');
            onLoaded(previewUrl);
          }
        })
        .catch((error: unknown) => {
          if (requestId !== requestSequence.current) return;
          onStatus('error', error instanceof Error ? error.message : 'Could not update the CC5 morph proxy.');
        });
      return () => {
        requestSequence.current += 1;
        if (animationFrame.current !== null) {
          cancelAnimationFrame(animationFrame.current);
          animationFrame.current = null;
        }
      };
    }

    const previous = previousState.current;
    const changedControls = previous?.model === model && previous.controls === controls
      ? controls.filter(({ id }) => (previous.morphs[id] ?? 0) !== (morphs[id] ?? 0))
      : controls;
    applyPreviewState(model, visible, morphs, changedControls, attachments);
    previousState.current = { model, controls, morphs };
    invalidate();
    onLoaded(previewUrl);
  }, [
    attachments,
    controls,
    invalidate,
    model,
    morphDeltaSha256,
    morphDeltaBaseUrl,
    morphPresetDeltaSha256,
    morphPresetDeltaBaseUrl,
    morphs,
    onLoaded,
    onStatus,
    previewUrl,
    proxyGeometries,
    visible.body,
    visible.eyes,
    visible.teeth,
    visible.tongue,
  ]);

  useEffect(() => () => {
    materials.forEach((material) => material.dispose());
    textures.forEach((texture) => texture.dispose());
  }, [materials, model, textures]);

  return <>
    <primitive object={model} />
    {skinPreview && <Suspense fallback={null}>
      <SkinMaterialPreview
        model={model}
        skinPreview={skinPreview}
        ownedTextures={textures}
        onPreviewError={onSkinPreviewError}
      />
    </Suspense>}
  </>;
}
