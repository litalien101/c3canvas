export type EarMorphGroupId =
  | 'earlobe'
  | 'tip'
  | 'center'
  | 'rim'
  | 'rim-details'
  | 'inner'
  | 'angle'
  | 'depth'
  | 'width'
  | 'height'
  | 'size'
  | 'shape'
  | 'other';

type EarMorphIdentity = {
  id: string;
  label: string;
};

export const EAR_MORPH_GROUPS: readonly {
  id: EarMorphGroupId;
  label: string;
  description: string;
}[] = [
  { id: 'tip', label: 'Ear Tip', description: 'Point, upper tip, and top contour.' },
  { id: 'earlobe', label: 'Earlobe', description: 'Lobe shape, attachment, size, and definition.' },
  { id: 'center', label: 'Ear Center', description: 'Central ear placement and center contour.' },
  { id: 'rim', label: 'Ear Rim', description: 'Outer edge contour, width, and depth.' },
  { id: 'rim-details', label: 'Ear Rim Details', description: 'Fine, lettered controls along the outer edge.' },
  { id: 'inner', label: 'Ear Inner Structure', description: 'Inner folds, opening, and tragus details.' },
  { id: 'angle', label: 'Ear Angle', description: 'Orientation and directional angle controls.' },
  { id: 'depth', label: 'Ear Depth', description: 'Depth, in/out placement, and protrusion.' },
  { id: 'width', label: 'Ear Width', description: 'Overall width and narrowness.' },
  { id: 'height', label: 'Ear Height', description: 'Overall height and vertical proportions.' },
  { id: 'size', label: 'Ear Size', description: 'Overall ear scale.' },
  { id: 'shape', label: 'Ear Shape', description: 'Whole-ear silhouette and style presets.' },
  { id: 'other', label: 'Other', description: 'Related head-area controls without a closer ear group.' },
];

function normalizedName(control: EarMorphIdentity): string {
  return `${control.label} ${control.id}`.toLocaleLowerCase().replaceAll('_', ' ');
}

export function isEarMorphControl(control: EarMorphIdentity): boolean {
  return /\b(ear|ears|earlobe)\b/.test(normalizedName(control));
}

export function earMorphGroupForControl(control: EarMorphIdentity): EarMorphGroupId {
  const name = normalizedName(control);
  if (/\b(earlobe|lobes?)\b/.test(name)) return 'earlobe';
  if (/\bskull\b/.test(name)) return 'other';
  if (/\bedge detail\b/.test(name)) return 'rim-details';
  if (/\b(edge|contour|rim|reshape)\b/.test(name)) return 'rim';
  if (/\b(inner|hole|tragus|folds?)\b/.test(name)) return 'inner';
  if (/\b(center|middle)\b/.test(name)) return 'center';
  if (/\b(angle|rotation|rotate|orientation)\b/.test(name)) return 'angle';
  if (/\b(depth|in out|protrud|prominent)\b/.test(name)) return 'depth';
  if (/\b(top|tip|point(?:ed)?)\b/.test(name)) return 'tip';
  if (/\b(width|narrow)\b/.test(name)) return 'width';
  if (/\b(height|length)\b/.test(name)) return 'height';
  if (/\b(size|scale|large)\b/.test(name)) return 'size';
  if (/\b(curl(?:ed)?|round|square|tilt(?:ed)?|silhouette)\b/.test(name)) return 'shape';
  return 'other';
}
