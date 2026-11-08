export type HeadMorphGroupId =
  | 'overall'
  | 'skull'
  | 'forehead'
  | 'proportions'
  | 'orientation';

type HeadMorphIdentity = {
  id: string;
  label: string;
};

export const HEAD_MORPH_GROUPS: readonly {
  id: HeadMorphGroupId;
  label: string;
  description: string;
}[] = [
  { id: 'overall', label: 'Overall Head', description: 'Whole-head shape presets and broad head controls.' },
  { id: 'skull', label: 'Skull & Cranium', description: 'Skull silhouette, height, width, depth, and rear contours.' },
  { id: 'forehead', label: 'Forehead', description: 'Forehead contour, depth, height, width, and shape presets.' },
  { id: 'proportions', label: 'Head Proportions', description: 'Overall head scale, width, and front-to-back depth.' },
  { id: 'orientation', label: 'Head Orientation', description: 'Head look, tilt, turn, and forward-back positioning.' },
];

function normalizedName(control: HeadMorphIdentity): string {
  return `${control.label} ${control.id}`.toLocaleLowerCase().replaceAll('_', ' ');
}

export function headMorphGroupForControl(control: HeadMorphIdentity): HeadMorphGroupId {
  const name = normalizedName(control);
  if (/\b(skull|cranium)\b/.test(name)) return 'skull';
  if (/\b(forehead|temple)\b/.test(name)) return 'forehead';
  if (/\b(head look|head tilt|head turn|head back forward)\b/.test(name)) return 'orientation';
  if (/\b(head depth|head width|head scale|head (?:upper|lower|outer) width)\b/.test(name)) return 'proportions';
  return 'overall';
}
