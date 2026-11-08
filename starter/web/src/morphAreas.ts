type MorphAreaControl = {
  id: string;
  label: string;
};

export function morphAreaForControl(control: MorphAreaControl): string {
  const text = `${control.label} ${control.id}`.toLocaleLowerCase().replaceAll('_', ' ');
  const rules: readonly [string, RegExp][] = [
    ['eyes', /\b(eye|eyes|eyelid|eyelash|blink|iris|pupil|squint|gaze|tearline)\b/],
    ['nose', /\b(nose|nostril|nasal|septum)\b/],
    ['mouth', /\b(mouth|lip|lips|teeth|tooth|tongue|jaw|chin|smile|frown|sneer|pucker|funnel|viseme|phoneme|cheek|dimple)\b/],
    ['ears', /\b(ear|ears|earlobe)\b/],
    ['head', /\b(head|skull|cranium|forehead|temple)\b/],
    ['face', /\b(face|brow|eyebrow|expression)\b/],
    ['hands', /\b(hand|hands|finger|thumb|palm|fingernail|nail)\b/],
    ['arms', /\b(arm|arms|bicep|tricep|forearm|elbow|wrist|clavicle)\b/],
    ['feet', /\b(foot|feet|toe|toes|heel|instep)\b/],
    ['legs', /\b(leg|legs|thigh|knee|calf|calves|shin|ankle)\b/],
    ['tail', /\btail\b/],
    ['body', /\b(body|height|width|scale|waist|hip|torso|chest|abdomen|muscle|fat|physique|shoulder|neck|back|belly|rib|breast|bust|weight|build)\b/],
  ];
  return rules.find(([, pattern]) => pattern.test(text))?.[0] ?? 'misc';
}

export function isBodyMorphControl(control: MorphAreaControl): boolean {
  return morphAreaForControl(control) === 'body';
}
