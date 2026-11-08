export type BodyMorphGroupId =
  | 'overall'
  | 'neck'
  | 'shoulders'
  | 'chest'
  | 'torso'
  | 'hips'
  | 'limbs'
  | 'eyes'
  | 'tearline'
  | 'teeth'
  | 'face'
  | 'other';

type BodyMorphIdentity = {
  id: string;
  label: string;
};

export const BODY_MORPH_GROUPS: readonly {
  id: BodyMorphGroupId;
  label: string;
  description: string;
}[] = [
  { id: 'overall', label: 'Overall Body', description: 'Whole-body shape, physique, and scale.' },
  { id: 'neck', label: 'Neck & Nape', description: 'Neck shape and rear-neck contour controls.' },
  { id: 'shoulders', label: 'Shoulders', description: 'Shoulder, deltoid, and armpit contours.' },
  { id: 'chest', label: 'Chest & Breasts', description: 'Chest, breast, pectoral, and nipple shape.' },
  { id: 'torso', label: 'Abdomen & Waist', description: 'Abdomen, waist, and torso proportions.' },
  { id: 'hips', label: 'Hips & Glutes', description: 'Pelvis, hip, and glute proportions.' },
  { id: 'limbs', label: 'Limbs', description: 'Arm and leg shape controls in this category.' },
  { id: 'eyes', label: 'Eyes & Eye Orbit', description: 'Eyeball, eye-orbit, and tear-duct controls.' },
  { id: 'tearline', label: 'Tearline', description: 'TL-prefixed tearline shape controls.' },
  { id: 'teeth', label: 'Teeth', description: 'Individual tooth and dental-width controls.' },
  { id: 'face', label: 'Face Detail', description: 'Small face-area controls included in this category.' },
  { id: 'other', label: 'Other Body Controls', description: 'Numbered controls without a clear anatomical label.' },
];

function normalizedName(control: BodyMorphIdentity): string {
  return `${control.label} ${control.id}`.toLocaleLowerCase().replaceAll('_', ' ');
}

export function bodyMorphGroupForControl(control: BodyMorphIdentity): BodyMorphGroupId {
  const name = normalizedName(control);
  if (/\b(tooth|teeth|incisor|canine|molar)\b/.test(name)) return 'teeth';
  if (/\b(eo\b|eyeball|tear duct)\b/.test(name)) return 'eyes';
  if (/\btl\b/.test(name)) return 'tearline';
  if (/\bneck\b/.test(name)) return 'neck';
  if (/\b(back|spine|lumbar)\b/.test(name)) return 'neck';
  if (/\b(shoulder|clavicle|armpit|deltoid)\b/.test(name)) return 'shoulders';
  if (/\b(chest|breast|bust|rib|pectoral|nipple)\b/.test(name)) return 'chest';
  if (/\b(torso|waist|abdomen|stomach|belly|navel|love handles)\b/.test(name)) return 'torso';
  if (/\b(hip|glute|buttock|pelvis)\b/.test(name)) return 'hips';
  if (/\b(upperarm|hamstring|quad|arm|leg)\b/.test(name)) return 'limbs';
  if (/\b(philtrum|mouth|lip|face|jaw|chin)\b/.test(name)) return 'face';
  if (/^\d{2}\s/.test(name)) return 'other';
  return 'overall';
}
