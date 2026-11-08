export type FaceMorphGroupId = 'face-shape' | 'brows' | 'shape-presets';

type FaceMorphIdentity = {
  id: string;
  label: string;
};

export const FACE_MORPH_GROUPS: readonly {
  id: FaceMorphGroupId;
  label: string;
  description: string;
}[] = [
  { id: 'face-shape', label: 'Face Shape & Proportions', description: 'Overall facial silhouette, depth, width, height, and shape presets.' },
  { id: 'brows', label: 'Brows & Brow Ridge', description: 'Brow angle, contour, height, width, depth, and brow presets.' },
  { id: 'shape-presets', label: 'Face Shape Presets', description: 'Named whole-face silhouette presets.' },
];

function normalizedName(control: FaceMorphIdentity): string {
  return `${control.label} ${control.id}`.toLocaleLowerCase().replaceAll('_', ' ');
}

export function faceMorphGroupForControl(control: FaceMorphIdentity): FaceMorphGroupId {
  const name = normalizedName(control);
  if (/\bbrow\b/.test(name)) return 'brows';
  if (/\bpreset\b/.test(name)) return 'shape-presets';
  return 'face-shape';
}
