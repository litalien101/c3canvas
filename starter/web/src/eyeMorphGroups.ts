export type EyeMorphGroupId =
  | 'position'
  | 'corners'
  | 'lids'
  | 'expression'
  | 'lashes-upper'
  | 'lashes-lower'
  | 'lashes'
  | 'under-eye'
  | 'socket'
  | 'iris-pupil'
  | 'eye-shape'
  | 'lid-presets';

type EyeMorphIdentity = {
  id: string;
  label: string;
};

export const EYE_MORPH_GROUPS: readonly {
  id: EyeMorphGroupId;
  label: string;
  description: string;
}[] = [
  { id: 'position', label: 'Eye Position & Proportions', description: 'Eye placement, spacing, angle, depth, width, and height.' },
  { id: 'corners', label: 'Inner & Outer Corners', description: 'Inner and outer eye-corner position, contour, and definition.' },
  { id: 'lids', label: 'Eyelids & Folds', description: 'Upper and lower eyelids, creases, folds, and lid contours.' },
  { id: 'expression', label: 'Eye Expression', description: 'Blink and squint controls.' },
  { id: 'lashes-upper', label: 'Upper Eyelashes', description: 'Upper lash length, angle, curve, placement, and scale.' },
  { id: 'lashes-lower', label: 'Lower Eyelashes', description: 'Lower lash length, angle, curve, placement, and scale.' },
  { id: 'lashes', label: 'General Eyelash Controls', description: 'Eyelash controls not specific to the upper or lower lash line.' },
  { id: 'under-eye', label: 'Under-Eye & Eye Bags', description: 'Eye bags and under-eye contours.' },
  { id: 'socket', label: 'Eye Socket & Orbit', description: 'Eye socket shape, depth, and protrusion-related presets.' },
  { id: 'iris-pupil', label: 'Iris & Pupil', description: 'Iris and pupil shape controls.' },
  { id: 'eye-shape', label: 'Eye Shape', description: 'Overall eye silhouette and named eye-shape controls.' },
  { id: 'lid-presets', label: 'Eyelid Style Presets', description: 'Named monolid and double-eyelid presets.' },
];

function normalizedName(control: EyeMorphIdentity): string {
  return `${control.label} ${control.id}`.toLocaleLowerCase().replaceAll('_', ' ');
}

export function eyeMorphGroupForControl(control: EyeMorphIdentity): EyeMorphGroupId {
  const name = normalizedName(control);
  if (/\b(monolid|double eyelids?|eyelid.*preset)\b/.test(name)) return 'lid-presets';
  if (/\b(eye bag|eyebag|aegyo sal|eye smile lines)\b/.test(name)) return 'under-eye';
  if (/\b(inner|outer) corner\b/.test(name)) return 'corners';
  if (/\b(sockets?|orbits?)\b/.test(name)) return 'socket';
  if (/\b(iris|pupil|eyeball)\b/.test(name)) return 'iris-pupil';
  if (/\b(blink|squint)\b/.test(name)) return 'expression';
  if (/\beyelash\b/.test(name) && /\b(upper|top)\b/.test(name)) return 'lashes-upper';
  if (/\beyelash\b/.test(name) && /\b(lower|bottom)\b/.test(name)) return 'lashes-lower';
  if (/\beyelash\b/.test(name)) return 'lashes';
  if (/\b(eyelid|eye crease|crease.*eye|fold|eye (?:upper|lower) opening)\b/.test(name)) return 'lids';
  if (/\b(almond|round|asian|african|eye.*preset|eye hood|eye droop|eye downturn|eye upturn)\b/.test(name)) return 'eye-shape';
  return 'position';
}
