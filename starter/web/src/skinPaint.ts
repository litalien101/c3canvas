import { Matrix3, Texture } from 'three';

export type SkinPaintPoint = { u: number; v: number; pressure?: number };
export type SkinPaintStroke = {
  material: 'Std_Skin_Head' | 'Std_Skin_Body' | 'Std_Skin_Arm' | 'Std_Skin_Leg';
  tool: 'paint' | 'freckles' | 'erase';
  color: string;
  radius: number;
  opacity: number;
  points: SkinPaintPoint[];
};

const UV_CONTINUITY_DISTANCE = 0.08;
const SKIN_MATERIAL_UV_OFFSETS: Record<SkinPaintStroke['material'], number> = {
  Std_Skin_Head: 0,
  Std_Skin_Body: 1,
  Std_Skin_Arm: 2,
  Std_Skin_Leg: 3,
};

export function skinMaterialUvOffset(material: SkinPaintStroke['material']): number {
  return SKIN_MATERIAL_UV_OFFSETS[material];
}

export function applySkinMaterialUvOffset(texture: Texture, material: SkinPaintStroke['material']) {
  const offset = skinMaterialUvOffset(material);
  if (offset === 0) return;
  if (texture.matrixAutoUpdate) {
    texture.offset.x -= offset;
    texture.updateMatrix();
    return;
  }
  texture.matrix.multiply(new Matrix3().makeTranslation(-offset, 0));
  texture.needsUpdate = true;
}

export function normalizeSkinPaintMaterialName(
  name: string | null | undefined,
): SkinPaintStroke['material'] | null {
  if (!name) return null;
  const normalized = name.trim().replace(/\.(?:\d+|[0-9]+)$/i, '');
  if (/(?:^|[_\-. ])skin[_\-. ]?head(?:$|[_\-. ])/i.test(normalized)
    || /\bStd_Skin_Head\b/i.test(normalized)) return 'Std_Skin_Head';
  if (/(?:^|[_\-. ])skin[_\-. ]?body(?:$|[_\-. ])/i.test(normalized)
    || /\bStd_Skin_Body\b/i.test(normalized)) return 'Std_Skin_Body';
  if (/(?:^|[_\-. ])skin[_\-. ]?arm(?:$|[_\-. ])/i.test(normalized)
    || /\bStd_Skin_Arm\b/i.test(normalized)) return 'Std_Skin_Arm';
  if (/(?:^|[_\-. ])skin[_\-. ]?leg(?:$|[_\-. ])/i.test(normalized)
    || /\bStd_Skin_Leg\b/i.test(normalized)) return 'Std_Skin_Leg';
  return null;
}

export function resolveSkinPaintMaterialFromGeometry(
  materialNames: Array<string | null | undefined>,
  faceIndex: number | undefined,
  groups: ReadonlyArray<{ start: number; count: number; materialIndex?: number }>,
  indexed: boolean,
): SkinPaintStroke['material'] | null {
  if (faceIndex === undefined || !Number.isFinite(faceIndex)) return null;
  const faceVertexOffset = indexed ? faceIndex * 3 : faceIndex * 3;
  for (const group of groups) {
    if (group.materialIndex === undefined) continue;
    if (faceVertexOffset >= group.start && faceVertexOffset < group.start + group.count) {
      return normalizeSkinPaintMaterialName(materialNames[group.materialIndex]);
    }
  }
  if (materialNames.length === 1) {
    return normalizeSkinPaintMaterialName(materialNames[0]);
  }
  return null;
}

export function skinPaintPressure(pointerType: string, pressure: number): number {
  if (pointerType !== 'pen' || !Number.isFinite(pressure) || pressure <= 0) return 1;
  return Math.min(1, Math.max(0.05, pressure));
}

export function shouldConnectSkinPaintPoints(from: SkinPaintPoint, to: SkinPaintPoint): boolean {
  return Math.hypot(to.u - from.u, to.v - from.v) <= UV_CONTINUITY_DISTANCE;
}

export function skinPaintPoint(
  u: number,
  v: number,
  pointerType: string,
  pressure: number,
  material?: SkinPaintStroke['material'],
): SkinPaintPoint {
  const materialLocalU = material ? u - skinMaterialUvOffset(material) : u;
  return {
    u: Math.min(1, Math.max(0, materialLocalU)),
    v: Math.min(1, Math.max(0, v)),
    pressure: skinPaintPressure(pointerType, pressure),
  };
}
