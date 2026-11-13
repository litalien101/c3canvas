export const ELVEN_EAR_PRESET_MORPHS = {
  '2025-12-12-15-07-46_ear_pointed': 1,
  '2019-08-25-17-39-45_ear pointed': 1,
  '2018-09-10-17-03-40_ear length': 0.75,
  'cc embed morphs/embed_ear2': 0.35,
  '2018-09-10-16-46-50_ear angle top': 0.25,
} as const;

export type CharacterPresetKind = 'body' | 'head';
export type CharacterPresetSelection = Record<CharacterPresetKind, string | null>;
export type CharacterPresetDefinition = { id: string; kind: CharacterPresetKind };

export function normalizeCharacterPresetSelection(
  presets: readonly CharacterPresetDefinition[],
  bodyPresetId: string | null | undefined,
  headPresetId: string | null | undefined,
): CharacterPresetSelection {
  const bodyPresetKind = presets.find(({ id }) => id === bodyPresetId)?.kind;
  return {
    body: bodyPresetKind === 'head' ? null : bodyPresetId ?? null,
    head: headPresetId ?? (bodyPresetKind === 'head' ? bodyPresetId ?? null : null),
  };
}

export function selectCharacterPreset(
  current: CharacterPresetSelection,
  kind: CharacterPresetKind,
  presetId: string | null,
): CharacterPresetSelection {
  return { ...current, [kind]: presetId };
}

export function applyElvenEarPreset(current: Readonly<Record<string, number>>): Record<string, number> {
  return { ...current, ...ELVEN_EAR_PRESET_MORPHS };
}
