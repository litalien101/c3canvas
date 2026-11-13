import { getWorkshopAsset } from './objectWorkshopAssets.ts';

export type WorkshopVec3 = [number, number, number];
export type WorkshopPresetId = 'chair' | 'stool' | 'table' | 'wall' | 'masonry' | 'shield' | 'cube';
export type WorkshopCategory = 'Furniture' | 'Architecture' | 'Armor' | 'Props' | 'Shapes';
export type MasonryConfig = {
  kind: 'wall' | 'road';
  bond: 'running' | 'stack';
  jointFill: 'mortar' | 'sand';
  cornerReturns: boolean;
  returnLength: number;
  width: number;
  height: number;
  depth: number;
  unitLength: number;
  unitHeight: number;
  unitDepth: number;
  jointWidth: number;
};

export type WorkshopParameterDefinition = {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
};

export type WorkshopComponent = {
  id: string;
  name: string;
  semanticType: string;
  assetMeshName?: string;
  geometrySize?: WorkshopVec3;
  sourceBackup?: boolean;
  parentId: string | null;
  offset: WorkshopVec3;
  rotation: WorkshopVec3;
  scale: WorkshopVec3;
  visible: boolean;
  locked: boolean;
  materialId: string;
  creationPhase: 'draft';
  validationStatus: 'unvalidated' | 'valid' | 'warning' | 'invalid';
};

export type WorkshopObject = {
  id: string;
  name: string;
  presetId: WorkshopPresetId;
  position: WorkshopVec3;
  rotation: WorkshopVec3;
  scale: WorkshopVec3;
  bevel: number;
  parameters: Record<string, number>;
  components: WorkshopComponent[];
  cageOffsets: Record<string, Record<string, WorkshopVec3>>;
  materialId: string;
  assemblyLocked: boolean;
  masonry?: MasonryConfig;
};

export type WorkshopScene = {
  version: 1;
  formatRevision: 8;
  objects: WorkshopObject[];
  selectedObjectId: string;
  selectedComponentId: string;
  mode: 'object' | 'component' | 'cage';
  tool: 'select' | 'move' | 'rotate' | 'scale';
  axis: 'free' | 'x' | 'y' | 'z';
  cageResolution: number;
  cageInfluence: number;
  cageSymmetry: boolean;
  gridVisible: boolean;
  wireframe: boolean;
};

export type WorkshopPresetDefinition = {
  id: WorkshopPresetId;
  name: string;
  category: WorkshopCategory;
  parameters: WorkshopParameterDefinition[];
  defaults: Record<string, number>;
  components: Array<{ name: string; semanticType: string; parent: string | null; assetMeshName?: string }>;
  materialId: string;
};

const LEGACY_PRESET_COMPONENTS: Partial<Record<WorkshopPresetId, ReadonlySet<string>>> = {
  chair: new Set([
    'seat', 'cushion', 'backrest', 'backrest-supports', 'backrest-support-left', 'backrest-support-right',
    'leg-front-left', 'leg-front-right', 'leg-rear-left', 'leg-rear-right', 'apron-front', 'apron-back',
    'apron-left', 'apron-right', 'armrest-left', 'armrest-right', 'armrest-support-left-front',
    'armrest-support-left-rear', 'armrest-support-right-front', 'armrest-support-right-rear',
  ]),
  stool: new Set(['seat', 'leg-front-left', 'leg-front-right', 'leg-rear-left', 'leg-rear-right', 'crossbars']),
  table: new Set(['tabletop', 'leg-front-left', 'leg-front-right', 'leg-rear-left', 'leg-rear-right']),
  wall: new Set(['wall']),
  masonry: new Set(),
  shield: new Set(['shield-body', 'shield-handle']),
};

export const WORKSHOP_PRESETS: WorkshopPresetDefinition[] = [
  {
    id: 'chair',
    name: 'Chair',
    category: 'Furniture',
    parameters: [
      { id: 'width', label: 'Seat width', min: 0.7, max: 2.4, step: 0.01, unit: 'm' },
      { id: 'depth', label: 'Seat depth', min: 0.65, max: 2, step: 0.01, unit: 'm' },
      { id: 'legHeight', label: 'Leg height', min: 0.3, max: 1.2, step: 0.01, unit: 'm' },
      { id: 'backrestHeight', label: 'Backrest height', min: 0.45, max: 1.7, step: 0.01, unit: 'm' },
    ],
    defaults: { width: 0.72, depth: 0.72, legHeight: 0.45, backrestHeight: 0.72 },
    materialId: 'oak',
    components: getWorkshopAsset('chair')!.components.map(({ name, semanticType, parent, meshName }) => ({
      name, semanticType, parent, assetMeshName: meshName,
    })),
  },
  {
    id: 'stool',
    name: 'Stool',
    category: 'Furniture',
    parameters: [
      { id: 'width', label: 'Seat width', min: 0.55, max: 1.8, step: 0.01, unit: 'm' },
      { id: 'depth', label: 'Seat depth', min: 0.55, max: 1.8, step: 0.01, unit: 'm' },
      { id: 'legHeight', label: 'Leg height', min: 0.3, max: 1.25, step: 0.01, unit: 'm' },
    ],
    defaults: { width: 1.12, depth: 1.12, legHeight: 0.78 },
    materialId: 'oak',
    components: getWorkshopAsset('stool')!.components.map(({ name, semanticType, parent, meshName }) => ({
      name, semanticType, parent, assetMeshName: meshName,
    })),
  },
  {
    id: 'table',
    name: 'Table',
    category: 'Furniture',
    parameters: [
      { id: 'width', label: 'Width', min: 0.7, max: 3, step: 0.01, unit: 'm' },
      { id: 'depth', label: 'Depth', min: 0.6, max: 2.5, step: 0.01, unit: 'm' },
      { id: 'height', label: 'Height', min: 0.55, max: 1.5, step: 0.01, unit: 'm' },
    ],
    defaults: { width: 1.8, depth: 1.25, height: 0.78 },
    materialId: 'oak',
    components: getWorkshopAsset('table')!.components.map(({ name, semanticType, parent, meshName }) => ({
      name, semanticType, parent, assetMeshName: meshName,
    })),
  },
  {
    id: 'wall',
    name: 'Wall',
    category: 'Architecture',
    parameters: [
      { id: 'width', label: 'Width', min: 0.5, max: 8, step: 0.01, unit: 'm' },
      { id: 'height', label: 'Height', min: 0.5, max: 6, step: 0.01, unit: 'm' },
      { id: 'depth', label: 'Thickness', min: 0.08, max: 1, step: 0.01, unit: 'm' },
    ],
    defaults: { width: 3, height: 2.4, depth: 0.24 },
    materialId: 'stone',
    components: getWorkshopAsset('wall')!.components.map(({ name, semanticType, parent, meshName }) => ({
      name, semanticType, parent, assetMeshName: meshName,
    })),
  },
  {
    id: 'masonry',
    name: 'Masonry',
    category: 'Architecture',
    parameters: [],
    defaults: {},
    materialId: 'brick',
    components: [],
  },
  {
    id: 'shield',
    name: 'Shield',
    category: 'Armor',
    parameters: [
      { id: 'width', label: 'Width', min: 0.45, max: 1.8, step: 0.01, unit: 'm' },
      { id: 'height', label: 'Height', min: 0.7, max: 2.4, step: 0.01, unit: 'm' },
      { id: 'depth', label: 'Thickness', min: 0.08, max: 0.5, step: 0.01, unit: 'm' },
    ],
    defaults: { width: 1.1, height: 1.55, depth: 0.18 },
    materialId: 'steel',
    components: getWorkshopAsset('shield')!.components.map(({ name, semanticType, parent, meshName }) => ({
      name, semanticType, parent, assetMeshName: meshName,
    })),
  },
  {
    id: 'cube',
    name: 'Cube',
    category: 'Shapes',
    parameters: [
      { id: 'width', label: 'Width', min: 0.2, max: 4, step: 0.01, unit: 'm' },
      { id: 'height', label: 'Height', min: 0.2, max: 4, step: 0.01, unit: 'm' },
      { id: 'depth', label: 'Depth', min: 0.2, max: 4, step: 0.01, unit: 'm' },
    ],
    defaults: { width: 1.35, height: 1.35, depth: 1.35 },
    materialId: 'blue',
    components: [{ name: 'Cube', semanticType: 'primitive', parent: null }],
  },
];

export const WORKSHOP_MATERIALS: Record<string, { name: string; color: string; roughness: number; metalness: number }> = {
  original: { name: 'Original asset', color: '#ffffff', roughness: 1, metalness: 0 },
  brick: { name: 'Terracotta brick', color: '#a65b43', roughness: 0.94, metalness: 0 },
  'brick-light': { name: 'Warm brick', color: '#b76a4d', roughness: 0.92, metalness: 0 },
  'brick-dark': { name: 'Deep brick', color: '#8e4937', roughness: 0.96, metalness: 0 },
  mortar: { name: 'Lime mortar', color: '#b7ac99', roughness: 0.98, metalness: 0 },
  sand: { name: 'Joint sand', color: '#a58a65', roughness: 0.98, metalness: 0 },
  paver: { name: 'Stone paver', color: '#777a78', roughness: 0.9, metalness: 0 },
  'paver-light': { name: 'Light stone', color: '#92918a', roughness: 0.92, metalness: 0 },
  'paver-dark': { name: 'Dark stone', color: '#626765', roughness: 0.94, metalness: 0 },
  oak: { name: 'Warm oak', color: '#93633f', roughness: 0.62, metalness: 0 },
  walnut: { name: 'Walnut', color: '#543624', roughness: 0.58, metalness: 0 },
  steel: { name: 'Brushed steel', color: '#8896a5', roughness: 0.34, metalness: 0.78 },
  stone: { name: 'Slate', color: '#737d89', roughness: 0.86, metalness: 0 },
  fabric: { name: 'Fabric', color: '#a99c87', roughness: 0.94, metalness: 0 },
  blue: { name: 'Studio blue', color: '#3d84ad', roughness: 0.42, metalness: 0.12 },
};

export function createWorkshopObject(presetId: WorkshopPresetId, name?: string, id = createWorkshopId()): WorkshopObject {
  const preset = getPreset(presetId);
  const masonry = presetId === 'masonry' ? createDefaultMasonryConfig() : undefined;
  const componentIds = new Map(preset.components.map((component) => [component.name, createWorkshopId()]));
  const object: WorkshopObject = {
    id,
    name: name ?? preset.name,
    presetId,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    bevel: presetId === 'masonry' ? 0.006 : 0.035,
    parameters: { ...preset.defaults },
    components: preset.components.map((component) => ({
      id: componentIds.get(component.name)!,
      name: component.name,
      semanticType: component.semanticType,
      ...(component.assetMeshName ? { assetMeshName: component.assetMeshName } : {}),
      parentId: component.parent ? componentIds.get(component.parent) ?? null : null,
      offset: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      visible: true,
      locked: false,
      materialId: component.assetMeshName
        ? 'original'
        : component.semanticType === 'cushion' || component.semanticType === 'backrest'
        ? 'fabric'
        : preset.materialId,
      creationPhase: 'draft',
      validationStatus: 'unvalidated',
    })),
    cageOffsets: {},
    materialId: preset.materialId,
    assemblyLocked: false,
    ...(masonry ? { masonry } : {}),
  };
  if (masonry) object.components = createMasonryComponents(masonry);
  return object;
}

export function createDefaultMasonryConfig(kind: MasonryConfig['kind'] = 'wall'): MasonryConfig {
  return kind === 'wall'
    ? {
      kind, bond: 'running', jointFill: 'mortar', cornerReturns: false, returnLength: 0.42,
      width: 2.4, height: 1.2, depth: 0.24, unitLength: 0.21, unitHeight: 0.065, unitDepth: 0.24, jointWidth: 0.009,
    }
    : {
      kind, bond: 'running', jointFill: 'sand', cornerReturns: false, returnLength: 0.42,
      width: 2.4, height: 0.045, depth: 1.8, unitLength: 0.2, unitHeight: 0.1, unitDepth: 0.08, jointWidth: 0.008,
    };
}

export function createMasonryComponents(config: MasonryConfig): WorkshopComponent[] {
  if (!isMasonryConfig(config)) throw new Error('Masonry dimensions or layout settings are outside supported limits.');
  const isWall = config.kind === 'wall';
  const baseId = createWorkshopId();
  const components: WorkshopComponent[] = [{
    id: baseId,
    name: isWall ? (config.jointFill === 'mortar' ? 'Mortar bed' : 'Sand bed') : 'Compacted joint bed',
    semanticType: 'masonry-base',
    parentId: null,
    offset: [0, isWall ? config.height / 2 : config.height / 2, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    geometrySize: [config.width, config.height, config.depth],
    visible: true,
    locked: false,
    materialId: config.jointFill,
    creationPhase: 'draft',
    validationStatus: 'valid',
  }];
  if (isWall && config.cornerReturns) {
    for (const side of [-1, 1]) {
      components.push({
        id: createWorkshopId(),
        name: side < 0 ? 'Left return bed' : 'Right return bed',
        semanticType: 'masonry-return-bed',
        parentId: baseId,
        offset: [side * (config.width / 2 - config.depth / 2), config.height / 2, -config.depth / 2 - config.returnLength / 2],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        geometrySize: [config.depth, config.height, config.returnLength],
        visible: true,
        locked: false,
        materialId: config.jointFill,
        creationPhase: 'draft',
        validationStatus: 'valid',
      });
    }
  }
  const unitPitch = config.unitLength + config.jointWidth;
  const courseExtent = isWall ? config.height : config.depth;
  const unitCount = Math.max(1, Math.floor((courseExtent + config.jointWidth)
    / (config.unitHeight + config.jointWidth)));
  const verticalPitch = courseExtent / unitCount;
  const courseHeight = verticalPitch - config.jointWidth;
  let pieceNumber = 0;

  for (let row = 0; row < unitCount; row += 1) {
    const rowStart = isWall ? row * verticalPitch : -config.depth / 2 + row * verticalPitch;
    const rowSize = courseHeight;
    const pieceHeight = rowSize;
    if (rowSize <= config.jointWidth * 1.2) continue;
    const rowOffset = config.bond === 'running' && row % 2 === 1 ? unitPitch / 2 : 0;
    const firstX = -config.width / 2 + config.unitLength / 2 - rowOffset;
    const columnStart = Math.floor((-config.width / 2 - firstX) / unitPitch);
    const columnEnd = Math.ceil((config.width / 2 - firstX) / unitPitch);

    for (let column = columnStart; column <= columnEnd; column += 1) {
      const nominalX = firstX + column * unitPitch;
      const left = Math.max(-config.width / 2, nominalX - config.unitLength / 2);
      const right = Math.min(config.width / 2, nominalX + config.unitLength / 2);
      const cutWidth = right - left;
      if (cutWidth < Math.min(config.unitLength * 0.22, config.jointWidth * 1.5)
        || pieceHeight < Math.min(config.unitHeight * 0.35, config.jointWidth * 1.5)) continue;

      pieceNumber += 1;
      if (pieceNumber > 350) {
        throw new Error('This layout would create more than 350 masonry pieces. Reduce its size or increase the unit dimensions.');
      }
      const variation = masonryVariation(row, column);
      const nominalWidth = cutWidth * variation;
      const nominalHeight = pieceHeight * variation;
      const x = (left + right) / 2;
      const y = isWall
        ? rowStart + rowSize / 2
        : config.height + config.unitDepth / 2 - 0.002;
      const z = isWall ? 0 : rowStart + rowSize / 2;
      const materialId = masonryPieceMaterial(pieceNumber, isWall);
      components.push({
        id: createWorkshopId(),
        name: `${isWall ? 'Brick' : 'Paver'} ${String(pieceNumber).padStart(3, '0')}`,
        semanticType: isWall ? 'masonry-brick' : 'masonry-paver',
        parentId: baseId,
        offset: [x, y, z],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        geometrySize: isWall
          ? [nominalWidth, nominalHeight, config.unitDepth * variation]
          : [nominalWidth, config.unitDepth * variation, nominalHeight],
        visible: true,
        locked: false,
        materialId,
        creationPhase: 'draft',
        validationStatus: 'valid',
      });
    }
    if (isWall && config.cornerReturns) {
      for (const side of [-1, 1]) {
        pieceNumber += 1;
        if (pieceNumber > 350) {
          throw new Error('This layout would create more than 350 masonry pieces. Reduce its size or increase the unit dimensions.');
        }
        const returnVariation = masonryVariation(row, side * 97);
        const returnHeight = pieceHeight * returnVariation;
        components.push({
          id: createWorkshopId(),
          name: `${side < 0 ? 'Left' : 'Right'} corner brick ${String(row + 1).padStart(2, '0')}`,
          semanticType: 'masonry-brick',
          parentId: baseId,
          offset: [
            side * (config.width / 2 - config.depth / 2),
            rowStart + rowSize / 2,
            -config.depth / 2 - config.returnLength / 2,
          ],
          rotation: [0, Math.PI / 2, 0],
          scale: [1, 1, 1],
          geometrySize: [config.returnLength - config.jointWidth, returnHeight, config.unitDepth * returnVariation],
          visible: true,
          locked: false,
          materialId: masonryPieceMaterial(pieceNumber, true),
          creationPhase: 'draft',
          validationStatus: 'valid',
        });
      }
    }
  }
  return components;
}

export function snapMasonryOffset(offset: WorkshopVec3, config: MasonryConfig): WorkshopVec3 {
  return snapMasonryOffsetFromAnchor(offset, config, [0, 0, 0]);
}

export function snapMasonryOffsetFromAnchor(
  offset: WorkshopVec3,
  config: MasonryConfig,
  anchor: WorkshopVec3,
): WorkshopVec3 {
  const steps: WorkshopVec3 = config.kind === 'wall'
    ? [config.unitLength + config.jointWidth, config.unitHeight + config.jointWidth, config.unitDepth + config.jointWidth]
    : [config.unitLength + config.jointWidth, config.unitDepth + config.jointWidth, config.unitHeight + config.jointWidth];
  return offset.map((coordinate, index) =>
    anchor[index] + Math.round((coordinate - anchor[index]) / steps[index]) * steps[index]) as WorkshopVec3;
}

function isMasonryConfig(value: unknown): value is MasonryConfig {
  if (!isRecord(value)) return false;
  return Object.keys(value).length === 12
    && (value.kind === 'wall' || value.kind === 'road')
    && (value.bond === 'running' || value.bond === 'stack')
    && (value.jointFill === 'mortar' || value.jointFill === 'sand')
    && typeof value.cornerReturns === 'boolean'
    && isFiniteInRange(value.returnLength, 0.1, 3)
    && isFiniteInRange(value.width, 0.3, 10)
    && isFiniteInRange(value.height, 0.03, 6)
    && isFiniteInRange(value.depth, value.kind === 'wall' ? 0.08 : 0.3, value.kind === 'wall' ? 1 : 10)
    && isFiniteInRange(value.unitLength, 0.06, 1)
    && isFiniteInRange(value.unitHeight, 0.03, 1)
    && isFiniteInRange(value.unitDepth, 0.03, 1)
    && isFiniteInRange(value.jointWidth, 0.003, 0.04)
    && (value.kind !== 'wall' || value.height >= value.unitHeight)
    && (value.kind !== 'wall' || value.unitDepth <= value.depth)
    && (value.kind !== 'road' || !value.cornerReturns)
    && (value.kind !== 'road' || value.depth >= value.unitHeight);
}

function masonryVariation(row: number, column: number) {
  const seed = Math.abs(Math.sin((row + 1) * 127.1 + (column + 1) * 311.7) * 43758.5453) % 1;
  return 0.988 + seed * 0.024;
}

function masonryPieceMaterial(index: number, isWall: boolean) {
  const palette = isWall ? ['brick', 'brick-light', 'brick-dark'] : ['paver', 'paver-light', 'paver-dark'];
  return palette[index % palette.length];
}

function migrateChairParameters(value: unknown) {
  if (!isRecord(value)) return value;
  const oldDefaults: Record<string, number> = { width: 1.55, depth: 1.28, legHeight: 0.8, backrestHeight: 1.18 };
  const nextDefaults = getPreset('chair').defaults;
  return Object.fromEntries(Object.entries(value).map(([id, amount]) => [
    id,
    amount === oldDefaults[id] ? nextDefaults[id] : amount,
  ]));
}

export function createWorkshopScene(): WorkshopScene {
  const chair = createWorkshopObject('chair', 'Chair — Custom');
  return {
    version: 1,
    formatRevision: 8,
    objects: [chair],
    selectedObjectId: chair.id,
    selectedComponentId: chair.components[1].id,
    mode: 'cage',
    tool: 'select',
    axis: 'free',
    cageResolution: 2,
    cageInfluence: 0.78,
    cageSymmetry: false,
    gridVisible: true,
    wireframe: false,
  };
}

export function getPreset(id: WorkshopPresetId): WorkshopPresetDefinition {
  const preset = WORKSHOP_PRESETS.find((item) => item.id === id);
  if (!preset) throw new Error(`Unknown object preset: ${id}`);
  return preset;
}

export function getComponentGeometry(object: WorkshopObject, component: WorkshopComponent): {
  size: WorkshopVec3;
  position: WorkshopVec3;
  rotation: WorkshopVec3;
  shape: 'box' | 'shield';
} {
  const p = object.parameters;
  if (component.geometrySize) {
    return {
      size: component.geometrySize.map((value, index) => value * component.scale[index]) as WorkshopVec3,
      position: [...component.offset],
      rotation: [...component.rotation],
      shape: 'box',
    };
  }
  if (component.assetMeshName) {
    const height = object.presetId === 'chair'
      ? (p.legHeight ?? 0) + (p.backrestHeight ?? 0) + 0.12
      : object.presetId === 'stool'
        ? (p.legHeight ?? 0) + 0.12
        : p.height ?? 1;
    return {
      size: [
        (p.width ?? 1) * component.scale[0],
        height * component.scale[1],
        (p.depth ?? 1) * component.scale[2],
      ],
      position: [component.offset[0], height / 2 + component.offset[1], component.offset[2]],
      rotation: [...component.rotation],
      shape: 'box',
    };
  }
  const width = p.width ?? 1;
  const depth = p.depth ?? 1;
  const height = p.height ?? 1;
  const legHeight = p.legHeight ?? height;
  const seatY = legHeight + 0.06;
  let size: WorkshopVec3 = [width, 0.12, depth];
  let position: WorkshopVec3 = [0, 0, 0];
  let rotation: WorkshopVec3 = [0, 0, 0];
  let shape: 'box' | 'shield' = 'box';

  if (object.presetId === 'chair' || object.presetId === 'stool') {
    const chair = object.presetId === 'chair';
    const legWidth = chair ? 0.08 : 0.12;
    switch (component.semanticType) {
      case 'seat':
        position = [0, seatY, 0];
        break;
      case 'cushion':
        size = [width * 0.91, 0.12, depth * 0.9];
        position = [0, seatY + 0.12, 0];
        break;
      case 'backrest':
        size = [width * 0.82, p.backrestHeight ?? 1, 0.14];
        position = [0, seatY + size[1] / 2, -depth * 0.43];
        rotation = [p.backrestAngle ?? -0.08, 0, 0];
        break;
      case 'backrest-support-left':
      case 'backrest-support-right': {
        const left = component.semanticType.endsWith('left');
        size = [legWidth, (p.backrestHeight ?? 1) + 0.12, 0.14];
        position = [(left ? -1 : 1) * width * 0.37, legHeight + size[1] / 2, -depth * 0.42];
        break;
      }
      case 'backrest-supports':
        size = [legWidth, (p.backrestHeight ?? 1) + 0.12, 0.14];
        position = [width * 0.37, legHeight + size[1] / 2, -depth * 0.42];
        break;
      case 'leg-front-left':
      case 'leg-front-right':
      case 'leg-rear-left':
      case 'leg-rear-right': {
        const left = component.semanticType.endsWith('left');
        const rear = component.semanticType.includes('rear');
        size = [legWidth, legHeight, legWidth];
        position = [(left ? -1 : 1) * width * 0.4, legHeight / 2, (rear ? -1 : 1) * depth * 0.39];
        if (rear && chair) rotation[0] = -0.08;
        break;
      }
      case 'apron-front':
      case 'apron-back': {
        const front = component.semanticType === 'apron-front';
        size = [width * 0.78, 0.14, 0.06];
        position = [0, legHeight - 0.07, (front ? 1 : -1) * depth * 0.31];
        break;
      }
      case 'apron-left':
      case 'apron-right': {
        const left = component.semanticType === 'apron-left';
        size = [0.06, 0.14, depth * 0.62];
        position = [(left ? -1 : 1) * width * 0.31, legHeight - 0.07, 0];
        break;
      }
      case 'armrest-left':
      case 'armrest-right': {
        const left = component.semanticType.endsWith('left');
        size = [0.14, 0.14, depth * 0.7];
        position = [(left ? -1 : 1) * width * 0.44, seatY + 0.27, 0.04];
        break;
      }
      case 'armrest-support-left-front':
      case 'armrest-support-left-rear':
      case 'armrest-support-right-front':
      case 'armrest-support-right-rear': {
        const left = component.semanticType.includes('left');
        const rear = component.semanticType.endsWith('rear');
        size = [legWidth, 0.25, legWidth];
        position = [
          (left ? -1 : 1) * width * 0.44,
          seatY + 0.125,
          (rear ? -1 : 1) * depth * 0.27,
        ];
        break;
      }
      case 'crossbars':
        size = [width * 0.68, 0.08, 0.08];
        position = [0, legHeight * 0.32, 0];
        break;
    }
  } else if (object.presetId === 'table') {
    switch (component.semanticType) {
      case 'tabletop':
        size = [width, 0.14, depth];
        position = [0, height - 0.07, 0];
        break;
      default: {
        const left = component.semanticType.endsWith('left');
        const rear = component.semanticType.includes('rear');
        size = [0.15, height - 0.14, 0.15];
        position = [(left ? -1 : 1) * width * 0.42, (height - 0.14) / 2, (rear ? -1 : 1) * depth * 0.4];
      }
    }
  } else if (object.presetId === 'wall') {
    size = [width, height, depth];
    position = [0, height / 2, 0];
  } else if (object.presetId === 'shield') {
    if (component.semanticType === 'shield-body') {
      size = [width, height, depth];
      position = [0, height / 2, 0];
      shape = 'shield';
    } else {
      size = [0.14, height * 0.55, 0.12];
      position = [0, height * 0.5, depth * 0.65];
    }
  } else {
    size = [width, height, depth];
    position = [0, height / 2, 0];
  }

  return {
    size: size.map((value, index) => value * component.scale[index]) as WorkshopVec3,
    position: position.map((value, index) => value + component.offset[index]) as WorkshopVec3,
    rotation: rotation.map((value, index) => value + component.rotation[index]) as WorkshopVec3,
    shape,
  };
}

export function placeWorkshopObjectWithoutOverlap(object: WorkshopObject, existingObjects: WorkshopObject[]): WorkshopObject {
  if (existingObjects.length === 0) return object;
  const radius = getWorkshopObjectRadius(object);
  const spacing = Math.max(1.75, (radius + Math.max(...existingObjects.map(getWorkshopObjectRadius))) * 2 + 0.25);
  for (let ring = 1; ring <= existingObjects.length + 2; ring += 1) {
    const candidates: Array<[number, number]> = [];
    for (let x = -ring; x <= ring; x += 1) {
      candidates.push([x, -ring], [x, ring]);
    }
    for (let z = -ring + 1; z < ring; z += 1) {
      candidates.push([-ring, z], [ring, z]);
    }
    for (const [gridX, gridZ] of candidates) {
      const position: WorkshopVec3 = [gridX * spacing, 0, gridZ * spacing];
      const separated = existingObjects.every((other) => {
        const distance = Math.hypot(position[0] - other.position[0], position[2] - other.position[2]);
        return distance >= radius + getWorkshopObjectRadius(other) + 0.2;
      });
      if (separated) return { ...object, position };
    }
  }
  throw new Error('Could not find a clear position for the new object.');
}

function getWorkshopObjectRadius(object: WorkshopObject): number {
  return Math.max(0.35, ...object.components.filter((component) => component.visible).map((component) => {
    const geometry = getComponentGeometry(object, component);
    const x = Math.abs(geometry.position[0]) + geometry.size[0] / 2;
    const z = Math.abs(geometry.position[2]) + geometry.size[2] / 2;
    return Math.hypot(x, z) * Math.max(object.scale[0], object.scale[2]);
  }));
}

export function cagePointIndex(x: number, y: number, z: number, resolution: number): string {
  return `${x}:${y}:${z}:${resolution}`;
}

export function cagePointRestPosition(x: number, y: number, z: number, resolution: number): WorkshopVec3 {
  const divisions = resolution;
  return [
    (x / divisions - 0.5),
    (y / divisions - 0.5),
    (z / divisions - 0.5),
  ];
}

export function deformWorkshopVertex(
  normalizedVertex: WorkshopVec3,
  offsets: Record<string, WorkshopVec3>,
  resolution: number,
  influence: number,
): WorkshopVec3 {
  const radius = 0.4 + influence * 0.9;
  const sum: WorkshopVec3 = [0, 0, 0];
  let totalWeight = 0;
  for (let x = 0; x <= resolution; x += 1) {
    for (let y = 0; y <= resolution; y += 1) {
      for (let z = 0; z <= resolution; z += 1) {
        const key = cagePointIndex(x, y, z, resolution);
        const delta = offsets[key];
        if (!delta) continue;
        const rest = cagePointRestPosition(x, y, z, resolution);
        const distance = Math.hypot(
          normalizedVertex[0] - rest[0],
          normalizedVertex[1] - rest[1],
          normalizedVertex[2] - rest[2],
        );
        if (distance >= radius) continue;
        const falloff = 1 - distance / radius;
        const weight = falloff * falloff;
        sum[0] += delta[0] * weight;
        sum[1] += delta[1] * weight;
        sum[2] += delta[2] * weight;
        totalWeight += weight;
      }
    }
  }
  const divisor = Math.max(1, totalWeight);
  return [
    normalizedVertex[0] + sum[0] / divisor,
    normalizedVertex[1] + sum[1] / divisor,
    normalizedVertex[2] + sum[2] / divisor,
  ];
}

export function isWorkshopScene(value: unknown): value is WorkshopScene {
  if (!isRecord(value)) return false;
  const scene = value as Partial<WorkshopScene>;
  if (scene.version !== 1
    || scene.formatRevision !== 8
    || !Array.isArray(scene.objects)
    || scene.objects.length > 100
    || !['object', 'component', 'cage'].includes(String(scene.mode))
    || !['select', 'move', 'rotate', 'scale'].includes(String(scene.tool))
    || !['free', 'x', 'y', 'z'].includes(String(scene.axis))
    || !Number.isInteger(scene.cageResolution)
    || scene.cageResolution! < 2
    || scene.cageResolution! > 4
    || !isFiniteInRange(scene.cageInfluence, 0.25, 1.5)
    || typeof scene.cageSymmetry !== 'boolean'
    || typeof scene.gridVisible !== 'boolean'
    || typeof scene.wireframe !== 'boolean'
    || typeof scene.selectedObjectId !== 'string'
    || typeof scene.selectedComponentId !== 'string') return false;

  const objectIds = new Set<string>();
  const componentIds = new Set<string>();
  let componentCount = 0;
  for (const candidate of scene.objects) {
    if (!isRecord(candidate)) return false;
    const object = candidate as Partial<WorkshopObject>;
    if (!isId(object.id)
      || objectIds.has(object.id)
      || !isName(object.name)
      || !WORKSHOP_PRESETS.some(({ id }) => id === object.presetId)
      || !isVec3(object.position)
      || !isVec3(object.rotation)
      || !isPositiveVec3(object.scale, 20)
      || typeof object.assemblyLocked !== 'boolean'
      || !isFiniteInRange(object.bevel, 0, 0.15)
      || typeof object.materialId !== 'string'
      || !Object.hasOwn(WORKSHOP_MATERIALS, object.materialId)
      || !isRecord(object.parameters)
      || (object.presetId === 'masonry'
        ? !isMasonryConfig(object.masonry)
        : object.masonry !== undefined)
      || !Array.isArray(object.components)
      || object.components.length === 0) return false;
    objectIds.add(object.id);

    const definition = getPreset(object.presetId as WorkshopPresetId);
    const parameterIds = new Set(definition.parameters.map(({ id }) => id));
    if (Object.keys(object.parameters).length !== parameterIds.size
      || Object.entries(object.parameters).some(([id, value]) => {
        const parameter = definition.parameters.find((item) => item.id === id);
        return !parameter || !isFiniteInRange(value, parameter.min, parameter.max);
      })) return false;

    const localIds = new Set<string>();
    for (const componentCandidate of object.components) {
      if (!isRecord(componentCandidate)) return false;
      const component = componentCandidate as Partial<WorkshopComponent>;
      const asset = getWorkshopAsset(object.presetId as WorkshopPresetId);
      if (!isId(component.id)
        || componentIds.has(component.id)
        || localIds.has(component.id)
        || !isName(component.name)
        || typeof component.semanticType !== 'string'
        || component.semanticType.length > 80
        || (component.assetMeshName !== undefined
          && (typeof component.assetMeshName !== 'string'
            || !asset?.components.some(({ meshName }) => meshName === component.assetMeshName)))
        || (component.geometrySize !== undefined
          && (object.presetId !== 'masonry' || !isPositiveVec3(component.geometrySize, 20)))
        || (component.sourceBackup !== undefined && typeof component.sourceBackup !== 'boolean')
        || (component.parentId !== null && typeof component.parentId !== 'string')
        || !isVec3(component.offset)
        || !isVec3(component.rotation)
        || !isPositiveVec3(component.scale, 20)
        || typeof component.visible !== 'boolean'
        || typeof component.locked !== 'boolean'
        || typeof component.materialId !== 'string'
        || !Object.hasOwn(WORKSHOP_MATERIALS, component.materialId)
        || component.creationPhase !== 'draft'
        || !['unvalidated', 'valid', 'warning', 'invalid'].includes(String(component.validationStatus))) return false;
      localIds.add(component.id);
      componentIds.add(component.id);
      componentCount += 1;
    }
    if (componentCount > 500) return false;
    if (object.presetId === 'masonry'
      && (object.components.filter((component) =>
        component.semanticType === 'masonry-brick' || component.semanticType === 'masonry-paver').length > 350
        || object.components.some((component) => !component.geometrySize))) return false;
    for (const component of object.components as WorkshopComponent[]) {
      if (component.parentId !== null && !localIds.has(component.parentId)) return false;
    }
    if (hasParentCycle(object.components as WorkshopComponent[])) return false;
    if (!isRecord(object.cageOffsets)
      || Object.keys(object.cageOffsets).length > object.components.length) return false;
    for (const [componentId, pointOffsets] of Object.entries(object.cageOffsets)) {
      if (!localIds.has(componentId) || !isRecord(pointOffsets)
        || Object.keys(pointOffsets).length > (scene.cageResolution! + 1) ** 3) return false;
      for (const [key, offset] of Object.entries(pointOffsets)) {
        const coordinates = key.split(':').map(Number);
        if (coordinates.length !== 4
          || coordinates[3] !== scene.cageResolution
          || !coordinates.slice(0, 3).every((coordinate) => Number.isInteger(coordinate) && coordinate >= 0 && coordinate <= scene.cageResolution!)
          || key !== cagePointIndex(coordinates[0], coordinates[1], coordinates[2], scene.cageResolution!)
          || !isVec3InRange(offset, 10)) return false;
      }
    }
  }

  const selectedObject = scene.objects.find((object) => object.id === scene.selectedObjectId);
  if (scene.objects.length === 0) return scene.selectedObjectId === '' && scene.selectedComponentId === '';
  return Boolean(selectedObject && selectedObject.components.some((component) => component.id === scene.selectedComponentId));
}

export function normalizeWorkshopScene(value: unknown): WorkshopScene | null {
  if (!isRecord(value) || !Array.isArray(value.objects)) return null;
  const sourceRevision = typeof value.formatRevision === 'number' ? value.formatRevision : 0;
  if (sourceRevision > 8) return null;
  const legacy = sourceRevision < 5;
  const selectedComponentByObject = new Map<string, string>();
  const placedObjects: WorkshopObject[] = [];
  const candidate = {
    ...value,
    formatRevision: 8,
    objects: value.objects.map((object) => {
      if (!isRecord(object) || !Array.isArray(object.components)) return object;
      const components = object.components.map((component) => isRecord(component) ? {
        ...component,
        creationPhase: component.creationPhase ?? 'draft',
        validationStatus: component.validationStatus ?? 'unvalidated',
      } : component);
      if (legacy && object.presetId === 'chair') upgradeLegacyChair(components);
      const normalizedObject = {
        ...object,
        bevel: object.bevel ?? 0.035,
        assemblyLocked: object.assemblyLocked ?? false,
        parameters: legacy && object.presetId === 'chair'
          ? migrateChairParameters(object.parameters)
          : object.parameters,
        components,
      };
      const presetId = object.presetId as WorkshopPresetId;
      const asset = getWorkshopAsset(presetId);
      const hasAssetBase = components.some((component) => isRecord(component) && typeof component.assetMeshName === 'string');
      if (sourceRevision < 6 && typeof object.id === 'string' && asset && !hasAssetBase) {
        const assetComponents = createWorkshopObject(presetId).components;
        if (value.selectedObjectId === object.id) selectedComponentByObject.set(object.id, assetComponents[0].id);
        normalizedObject.components = components.map((component) => isRecord(component)
          ? markLegacyComponent(presetId, component)
          : component);
        normalizedObject.components.push(...assetComponents);
      } else if (sourceRevision < 7 && asset) {
        normalizedObject.components = components.map((component) => isRecord(component)
          ? markLegacyComponent(presetId, component)
          : component);
      }
      if (sourceRevision < 6 && isWorkshopObject(normalizedObject)) {
        const atOrigin = normalizedObject.position[0] === 0 && normalizedObject.position[2] === 0;
        const originAlreadyUsed = placedObjects.some((item) => item.position[0] === 0 && item.position[2] === 0);
        const positioned = atOrigin && originAlreadyUsed
          ? placeWorkshopObjectWithoutOverlap(normalizedObject, placedObjects)
          : normalizedObject;
        placedObjects.push(positioned);
        return positioned;
      }
      return normalizedObject;
    }),
    selectedComponentId: selectedComponentByObject.get(String(value.selectedObjectId)) ?? value.selectedComponentId,
  };
  return isWorkshopScene(candidate) ? candidate : null;
}

function markLegacyComponent(presetId: WorkshopPresetId, component: Record<string, unknown>) {
  if (!LEGACY_PRESET_COMPONENTS[presetId]?.has(String(component.semanticType))) return component;
  return { ...component, visible: false, sourceBackup: true };
}

function isWorkshopObject(value: unknown): value is WorkshopObject {
  return isRecord(value)
    && typeof value.id === 'string'
    && Array.isArray(value.position)
    && Array.isArray(value.components);
}

function upgradeLegacyChair(components: unknown[]) {
  const legacySupportsIndex = components.findIndex((component) => isRecord(component) && component.semanticType === 'backrest-supports');
  if (legacySupportsIndex >= 0) {
    const legacySupports = components[legacySupportsIndex] as WorkshopComponent;
    components.splice(legacySupportsIndex, 1,
      { ...legacySupports, id: createWorkshopId(), name: 'Left backrest support', semanticType: 'backrest-support-left', offset: [0, 0, 0] },
      { ...legacySupports, name: 'Right backrest support', semanticType: 'backrest-support-right' });
  }
  const seat = components.find((component) => isRecord(component) && component.semanticType === 'seat') as WorkshopComponent | undefined;
  const seatId = seat?.id ?? null;
  const frameMaterialId = seat?.materialId ?? 'oak';
  const presentTypes = new Set(components.filter(isRecord).map((component) => component.semanticType));
  for (const [semanticType, name] of [
    ['armrest-support-left-front', 'Left front armrest support'],
    ['armrest-support-left-rear', 'Left rear armrest support'],
    ['armrest-support-right-front', 'Right front armrest support'],
    ['armrest-support-right-rear', 'Right rear armrest support'],
    ['apron-front', 'Front apron'],
    ['apron-back', 'Back apron'],
    ['apron-left', 'Left side apron'],
    ['apron-right', 'Right side apron'],
  ]) {
    if (presentTypes.has(semanticType)) continue;
    components.push({
      id: createWorkshopId(),
      name,
      semanticType,
      parentId: seatId,
      offset: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      visible: true,
      locked: false,
      materialId: frameMaterialId,
      creationPhase: 'draft',
      validationStatus: 'unvalidated',
    });
  }
  for (const component of components.filter(isRecord)) {
    if ((component.semanticType === 'cushion' || component.semanticType === 'backrest')
      && component.materialId === 'oak') component.materialId = 'fabric';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

function isName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 120;
}

function isVec3(value: unknown): value is WorkshopVec3 {
  return isVec3InRange(value, 1000);
}

function isVec3InRange(value: unknown, maximum: number): value is WorkshopVec3 {
  return Array.isArray(value) && value.length === 3
    && value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate) && Math.abs(coordinate) <= maximum);
}

function isPositiveVec3(value: unknown, maximum: number): value is WorkshopVec3 {
  return isVec3InRange(value, maximum) && value.every((coordinate) => coordinate > 0);
}

function isFiniteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function hasParentCycle(components: WorkshopComponent[]): boolean {
  const parents = new Map(components.map(({ id, parentId }) => [id, parentId]));
  for (const { id } of components) {
    const seen = new Set<string>();
    let current: string | null | undefined = id;
    while (current) {
      if (seen.has(current)) return true;
      seen.add(current);
      current = parents.get(current);
    }
  }
  return false;
}

export function createWorkshopId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `object-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
