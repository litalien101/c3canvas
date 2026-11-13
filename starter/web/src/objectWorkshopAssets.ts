import type { WorkshopPresetId } from './objectWorkshopModel';

export type WorkshopAssetComponent = {
  name: string;
  semanticType: string;
  parent: string | null;
  meshName: string;
};

export type WorkshopAsset = {
  fileName: string;
  sourceAssetId: string;
  sourceName: string;
  author: string;
  sourceUrl: string;
  license: 'CC0 1.0';
  licenseUrl: string;
  downloadedAt: string;
  components: WorkshopAssetComponent[];
};

export const WORKSHOP_ASSETS: Partial<Record<WorkshopPresetId, WorkshopAsset>> = {
  chair: {
    fileName: 'chair.glb',
    sourceAssetId: 'modern_arm_chair_01',
    sourceName: 'Modern Arm Chair 01',
    author: 'Vibrant Nordic',
    sourceUrl: 'https://polyhaven.com/a/modern_arm_chair_01',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    downloadedAt: '2026-11-09',
    components: [
      { name: 'Frame', semanticType: 'asset-frame', parent: null, meshName: 'Frame' },
      { name: 'Upholstery', semanticType: 'asset-upholstery', parent: 'Frame', meshName: 'Upholstery' },
    ],
  },
  stool: {
    fileName: 'stool.glb',
    sourceAssetId: 'wooden_stool_02',
    sourceName: 'Wooden Stool 02',
    author: 'Kuutti Siitonen',
    sourceUrl: 'https://polyhaven.com/a/wooden_stool_02',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    downloadedAt: '2026-11-09',
    components: [
      { name: 'Stool', semanticType: 'asset-stool', parent: null, meshName: 'Stool' },
    ],
  },
  table: {
    fileName: 'table.glb',
    sourceAssetId: 'modern_coffee_table_01',
    sourceName: 'Modern Coffee Table 01',
    author: 'Amin',
    sourceUrl: 'https://polyhaven.com/a/modern_coffee_table_01',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    downloadedAt: '2026-11-09',
    components: [
      { name: 'Coffee table', semanticType: 'asset-table', parent: null, meshName: 'Table' },
    ],
  },
  wall: {
    fileName: 'wall.glb',
    sourceAssetId: 'modular_fort_01',
    sourceName: 'Modular Fort 01 — Straight Wall Section',
    author: 'Rico Cilliers',
    sourceUrl: 'https://polyhaven.com/a/modular_fort_01',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    downloadedAt: '2026-11-09',
    components: [
      { name: 'Masonry', semanticType: 'asset-wall', parent: null, meshName: 'Masonry' },
      { name: 'Stone trim', semanticType: 'asset-wall-trim', parent: 'Masonry', meshName: 'Trim' },
    ],
  },
  shield: {
    fileName: 'shield.glb',
    sourceAssetId: 'kite_shield',
    sourceName: 'Kite Shield',
    author: 'Ulan Cabanilla',
    sourceUrl: 'https://polyhaven.com/a/kite_shield',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    downloadedAt: '2026-11-09',
    components: [
      { name: 'Shield body', semanticType: 'asset-shield-body', parent: null, meshName: 'Shield body' },
      { name: 'Metal trim', semanticType: 'asset-shield-trim', parent: 'Shield body', meshName: 'Metal trim' },
      { name: 'Clamps and bolts', semanticType: 'asset-shield-hardware', parent: 'Shield body', meshName: 'Hardware' },
    ],
  },
};

export function getWorkshopAsset(presetId: WorkshopPresetId): WorkshopAsset | null {
  return WORKSHOP_ASSETS[presetId] ?? null;
}
