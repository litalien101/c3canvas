export type OtherMorphAreaId = 'nose' | 'mouth' | 'arms' | 'hands' | 'legs' | 'feet' | 'misc';
export const OTHER_MORPH_AREA_IDS: readonly OtherMorphAreaId[] = ['nose', 'mouth', 'arms', 'hands', 'legs', 'feet', 'misc'];

export function isOtherMorphAreaId(area: string | undefined): area is OtherMorphAreaId {
  return area !== undefined && OTHER_MORPH_AREA_IDS.some((id) => id === area);
}

export type OtherMorphGroupId =
  | 'nose--nostrils'
  | 'nose--tip'
  | 'nose--shape'
  | 'mouth--expression'
  | 'mouth--lips'
  | 'mouth--jaw'
  | 'mouth--cheeks'
  | 'mouth--teeth'
  | 'mouth--tongue'
  | 'arms--upper-arm'
  | 'arms--forearm'
  | 'arms--elbow'
  | 'arms--wrist'
  | 'arms--general'
  | 'hands--fingers'
  | 'hands--palm'
  | 'hands--nails'
  | 'hands--general'
  | 'legs--thigh'
  | 'legs--knee'
  | 'legs--lower-leg'
  | 'legs--ankle'
  | 'legs--general'
  | 'feet--foot'
  | 'feet--toes'
  | 'feet--heel'
  | 'feet--general'
  | 'misc--dental'
  | 'misc--eyeball'
  | 'misc--eye-orbit'
  | 'misc--tearline'
  | 'misc--numbered'
  | 'misc--body-pose'
  | 'misc--face-detail'
  | 'misc--base-shape'
  | 'misc--other';

type MorphIdentity = {
  id: string;
  label: string;
};

type MorphGroup = {
  id: OtherMorphGroupId;
  label: string;
  description: string;
};

export const OTHER_MORPH_GROUPS: Readonly<Record<OtherMorphAreaId, readonly MorphGroup[]>> = {
  nose: [
    { id: 'nose--nostrils', label: 'Nostrils & Nasal Openings', description: 'Nostril shape, width, and opening contours.' },
    { id: 'nose--tip', label: 'Nose Tip', description: 'Tip shape, projection, and rotation.' },
    { id: 'nose--shape', label: 'Bridge & Overall Shape', description: 'Bridge, root, and overall nose proportions.' },
  ],
  mouth: [
    { id: 'mouth--expression', label: 'Mouth Shape & Expression', description: 'Mouth width, opening, smile, and expression controls.' },
    { id: 'mouth--lips', label: 'Lips', description: 'Upper and lower lip shape, size, and definition.' },
    { id: 'mouth--jaw', label: 'Jaw & Chin', description: 'Jaw and chin shape, width, depth, and proportions.' },
    { id: 'mouth--cheeks', label: 'Cheeks & Dimples', description: 'Cheek contours, cheekbones, and dimples.' },
    { id: 'mouth--teeth', label: 'Teeth', description: 'Teeth and dental shape controls.' },
    { id: 'mouth--tongue', label: 'Tongue', description: 'Tongue shape and position.' },
  ],
  arms: [
    { id: 'arms--upper-arm', label: 'Upper Arm', description: 'Upper-arm and bicep proportions.' },
    { id: 'arms--forearm', label: 'Forearm', description: 'Forearm shape and proportions.' },
    { id: 'arms--elbow', label: 'Elbow', description: 'Elbow contour and definition.' },
    { id: 'arms--wrist', label: 'Wrist', description: 'Wrist size and shape.' },
    { id: 'arms--general', label: 'General Arm Shape', description: 'Arm controls without a more specific region.' },
  ],
  hands: [
    { id: 'hands--fingers', label: 'Fingers', description: 'Finger length, shape, and proportions.' },
    { id: 'hands--palm', label: 'Palm', description: 'Palm width, depth, and overall shape.' },
    { id: 'hands--nails', label: 'Nails', description: 'Fingernail size and shape.' },
    { id: 'hands--general', label: 'Overall Hand', description: 'Hand controls without a more specific region.' },
  ],
  legs: [
    { id: 'legs--thigh', label: 'Thigh', description: 'Thigh size, shape, and proportions.' },
    { id: 'legs--knee', label: 'Knee', description: 'Knee shape and definition.' },
    { id: 'legs--lower-leg', label: 'Calf & Shin', description: 'Calf and shin shape and proportions.' },
    { id: 'legs--ankle', label: 'Ankle', description: 'Ankle size and shape.' },
    { id: 'legs--general', label: 'Overall Leg', description: 'Leg controls without a more specific region.' },
  ],
  feet: [
    { id: 'feet--foot', label: 'Foot Shape', description: 'Overall foot size, width, and proportions.' },
    { id: 'feet--toes', label: 'Toes', description: 'Toe shape, length, and spacing.' },
    { id: 'feet--heel', label: 'Heel', description: 'Heel shape and definition.' },
    { id: 'feet--general', label: 'Other Foot Controls', description: 'Foot controls without a more specific region.' },
  ],
  misc: [
    { id: 'misc--dental', label: 'Dental Details', description: 'Individual incisors, canines, premolars, and molars.' },
    { id: 'misc--eyeball', label: 'Eyeballs', description: 'Eyeball shape and placement controls.' },
    { id: 'misc--eye-orbit', label: 'Eye Orbit', description: 'EO-prefixed eye-orbit controls.' },
    { id: 'misc--tearline', label: 'Tearline & Tear Duct', description: 'TL-prefixed tearline and named tear-duct controls.' },
    { id: 'misc--numbered', label: 'Numbered Controls', description: 'Numbered controls whose names and shape-key metadata do not identify a reliable anatomical region.' },
    { id: 'misc--body-pose', label: 'Body Details & Poses', description: 'Named body-region, limb, and pose-related controls included in Misc.' },
    { id: 'misc--face-detail', label: 'Face & Head Details', description: 'Philtrum, profile, cheek, and other named head-area controls.' },
    { id: 'misc--base-shape', label: 'Base Shapes & Resets', description: 'Named base-shape and neutral-reset controls.' },
    { id: 'misc--other', label: 'Other Miscellaneous', description: 'Remaining controls without a clear anatomical or functional grouping.' },
  ],
};

function normalizedName(control: MorphIdentity): string {
  return `${control.label} ${control.id}`.toLocaleLowerCase().replaceAll('_', ' ');
}

export function otherMorphGroupForControl(area: OtherMorphAreaId, control: MorphIdentity): OtherMorphGroupId {
  const name = normalizedName(control);
  const label = control.label.toLocaleLowerCase().replaceAll('_', ' ');

  if (area === 'nose') {
    if (/\b(nostril|nares?|alar)\b/.test(name)) return 'nose--nostrils';
    if (/\b(tip|apex|tip rotation)\b/.test(name)) return 'nose--tip';
    return 'nose--shape';
  }

  if (area === 'mouth') {
    if (/\b(tooth|teeth|incisor|canine|molar|premolar)\b/.test(name)) return 'mouth--teeth';
    if (/\b(tongue)\b/.test(name)) return 'mouth--tongue';
    if (/\b(cheek|cheekbone|dimple)\b/.test(name)) return 'mouth--cheeks';
    if (/\b(jaw|chin)\b/.test(name)) return 'mouth--jaw';
    if (/\b(lip)\b/.test(name)) return 'mouth--lips';
    return 'mouth--expression';
  }

  if (area === 'arms') {
    if (/\b(wrist)\b/.test(name)) return 'arms--wrist';
    if (/\b(elbow)\b/.test(name)) return 'arms--elbow';
    if (/\b(forearm)\b/.test(name)) return 'arms--forearm';
    if (/\b(upper ?arm|bicep|tricep)\b/.test(name)) return 'arms--upper-arm';
    return 'arms--general';
  }

  if (area === 'hands') {
    if (/\b(nail|fingernail)\b/.test(name)) return 'hands--nails';
    if (/\b(finger|thumb)\b/.test(name)) return 'hands--fingers';
    if (/\b(palm)\b/.test(name)) return 'hands--palm';
    return 'hands--general';
  }

  if (area === 'legs') {
    if (/\b(thigh|hamstring|quadricep|quad)\b/.test(name)) return 'legs--thigh';
    if (/\b(knee)\b/.test(name)) return 'legs--knee';
    if (/\b(ankle)\b/.test(name)) return 'legs--ankle';
    if (/\b(calf|calves|shin)\b/.test(name)) return 'legs--lower-leg';
    return 'legs--general';
  }

  if (area === 'feet') {
    if (/\b(toe|toes)\b/.test(name)) return 'feet--toes';
    if (/\b(heel)\b/.test(name)) return 'feet--heel';
    if (/\b(foot|feet|instep)\b/.test(name)) return 'feet--foot';
    return 'feet--general';
  }

  if (/^(tl\b|tearline\b|tear duct\b)/i.test(label)) return 'misc--tearline';
  if (/^eo\b/i.test(label) || /\beye orbit\b/.test(name)) return 'misc--eye-orbit';
  if (/\b(eyeball|iris|pupil)\b/.test(name)) return 'misc--eyeball';
  if (/\b(tooth|teeth|incisor|canine|molar|premolar)\b/.test(name) || /\b(upper|lower) (central|lateral)\b/.test(label)) return 'misc--dental';
  if (/^\d{2}_/.test(control.label)) return 'misc--numbered';
  if (/\b(abs|buttocks?|elbows?|forearms?|knee|kneeling|navel|nipple|slacker|upper ?arm|hamstring|quadriceps?|quads?|glutes?|love handles|pectoral)\b/.test(name) || /forearm\d*/.test(name)) return 'misc--body-pose';
  if (/\b(cheeks?|philtrum|profile|occiput|temples?)\b/.test(name)) return 'misc--face-detail';
  if (/^(cc1|cc3) base\b/i.test(label) || /\b(resume to cc3 shape)\b/i.test(label)) return 'misc--base-shape';
  return 'misc--other';
}
