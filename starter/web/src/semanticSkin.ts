export type SkinDefinition = {
  version: 1;
  base: {
    tone: number;
    undertone: 'cool' | 'neutral' | 'warm' | 'olive';
  };
  surface: {
    roughness: number;
  };
};

export type SkinDefinitionPatch = {
  base?: Partial<SkinDefinition['base']>;
  surface?: Partial<SkinDefinition['surface']>;
};

export const DEFAULT_SKIN_DEFINITION: SkinDefinition = {
  version: 1,
  base: { tone: 0.62, undertone: 'neutral' },
  surface: { roughness: 0.42 },
};

export function skinMaterialParameters(definition: SkinDefinition) {
  const toneFactor = 0.7 + definition.base.tone * 0.5;
  const undertone = {
    cool: [0.97, 0.99, 1.04],
    neutral: [1, 1, 1],
    warm: [1.04, 1, 0.96],
    olive: [0.99, 1.02, 0.96],
  }[definition.base.undertone];
  return {
    colorMultiplier: undertone.map((channel) => toneFactor * channel) as [number, number, number],
    roughnessScale: definition.surface.roughness / DEFAULT_SKIN_DEFINITION.surface.roughness,
  };
}

export function applySkinDefinitionPatch(
  current: SkinDefinition,
  patch: SkinDefinitionPatch,
): SkinDefinition {
  return {
    version: 1,
    base: { ...current.base, ...patch.base },
    surface: { ...current.surface, ...patch.surface },
  };
}
