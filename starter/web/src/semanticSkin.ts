export type SkinDefinition = {
  version: 2;
  base: {
    tone: number;
    undertone: 'cool' | 'neutral' | 'warm' | 'olive';
  };
  surface: {
    roughness: number;
  };
  features: {
    freckles: SkinFreckles;
  };
};

type SkinDefinitionInput = {
  version?: number;
  base?: Partial<SkinDefinition['base']>;
  surface?: Partial<SkinDefinition['surface']>;
  features?: {
    freckles?: Partial<SkinFreckles>;
  };
};

export type SkinFreckles = {
  enabled: boolean;
  density: number;
  size: number;
  strength: number;
  color: string;
  seed: number;
  pattern: FrecklePattern;
};

export type FrecklePattern =
  | 'natural'
  | 'light_dusting'
  | 'dense_center'
  | 'cheek_clusters'
  | 'sun_kissed'
  | 'constellation'
  | 'mottled';

export const FRECKLE_PATTERNS: { value: FrecklePattern; label: string }[] = [
  { value: 'natural', label: 'Natural scatter' },
  { value: 'light_dusting', label: 'Light dusting' },
  { value: 'dense_center', label: 'Dense center' },
  { value: 'cheek_clusters', label: 'Cheek clusters' },
  { value: 'sun_kissed', label: 'Sun-kissed' },
  { value: 'constellation', label: 'Constellation' },
  { value: 'mottled', label: 'Mottled variation' },
];

export type SkinDefinitionPatch = {
  base?: Partial<SkinDefinition['base']>;
  surface?: Partial<SkinDefinition['surface']>;
  features?: {
    freckles?: Partial<Omit<SkinFreckles, 'seed'>>;
  };
};

export const DEFAULT_SKIN_DEFINITION: SkinDefinition = {
  version: 2,
  base: { tone: 0.62, undertone: 'neutral' },
  surface: { roughness: 0.42 },
  features: {
    freckles: {
      enabled: false,
      density: 0.18,
      size: 0.45,
      strength: 0.35,
      color: '#80513F',
      seed: 24301,
      pattern: 'natural',
    },
  },
};

export function normalizeSkinDefinition(definition?: SkinDefinitionInput | null): SkinDefinition {
  return {
    version: 2,
    base: { ...DEFAULT_SKIN_DEFINITION.base, ...definition?.base },
    surface: { ...DEFAULT_SKIN_DEFINITION.surface, ...definition?.surface },
    features: {
      freckles: {
        ...DEFAULT_SKIN_DEFINITION.features.freckles,
        ...definition?.features?.freckles,
      },
    },
  };
}

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
    version: 2,
    base: { ...current.base, ...patch.base },
    surface: { ...current.surface, ...patch.surface },
    features: {
      freckles: {
        ...current.features.freckles,
        ...patch.features?.freckles,
      },
    },
  };
}

export type FreckleSpot = {
  x: number;
  y: number;
  radius: number;
  opacity: number;
};

export function generateFreckleSpots(
  freckles: SkinFreckles,
  width: number,
  height: number,
): FreckleSpot[] {
  if (!freckles.enabled || freckles.density <= 0 || width < 1 || height < 1) return [];

  let state = freckles.seed >>> 0;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
  const count = Math.round(freckles.density * 800);
  const minimumDimension = Math.min(width, height);
  return Array.from({ length: count }, () => {
    let x = random();
    let y = random();
    const pattern = freckles.pattern ?? 'natural';

    if (pattern === 'light_dusting') {
      x = 0.16 + random() * 0.68;
      y = 0.18 + random() * 0.64;
    } else if (pattern === 'dense_center') {
      x = Math.min(0.98, Math.max(0.02, 0.5 + (random() - 0.5) * 0.38));
      y = Math.min(0.98, Math.max(0.02, 0.5 + (random() - 0.5) * 0.48));
    } else if (pattern === 'cheek_clusters') {
      const cluster = random() < 0.5 ? -1 : 1;
      x = 0.5 + cluster * (0.18 + random() * 0.13) + (random() - 0.5) * 0.08;
      y = 0.42 + random() * 0.34;
    } else if (pattern === 'sun_kissed') {
      x = 0.5 + (random() - 0.5) * 0.78;
      y = 0.72 - random() * 0.48;
    } else if (pattern === 'constellation') {
      const clusterIndex = Math.floor(random() * 6);
      const angle = random() * Math.PI * 2;
      const distance = random() * 0.12;
      x = (0.22 + (clusterIndex % 3) * 0.28) + Math.cos(angle) * distance;
      y = (0.32 + Math.floor(clusterIndex / 3) * 0.24) + Math.sin(angle) * distance;
    } else if (pattern === 'mottled') {
      x = random() < 0.5 ? random() * 0.55 : 0.45 + random() * 0.55;
      y = random() * 0.82 + 0.08;
    }

    return {
      x: Math.min(0.999, Math.max(0, x)) * width,
      y: Math.min(0.999, Math.max(0, y)) * height,
      radius: minimumDimension * (0.00055 + freckles.size * 0.00115) * (0.6 + random() * 0.8),
      opacity: freckles.strength * 0.35 * (0.6 + random() * 0.8),
    };
  });
}

export function applyFrecklesToCanvas(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  freckles: SkinFreckles,
) {
  const spots = generateFreckleSpots(freckles, width, height);
  if (spots.length === 0) return;

  const pixels = context.getImageData(0, 0, width, height);
  const data = pixels.data;
  const color = [
    Number.parseInt(freckles.color.slice(1, 3), 16),
    Number.parseInt(freckles.color.slice(3, 5), 16),
    Number.parseInt(freckles.color.slice(5, 7), 16),
  ];
  for (const spot of spots) {
    const left = Math.max(0, Math.floor(spot.x - spot.radius));
    const right = Math.min(width - 1, Math.ceil(spot.x + spot.radius));
    const top = Math.max(0, Math.floor(spot.y - spot.radius));
    const bottom = Math.min(height - 1, Math.ceil(spot.y + spot.radius));
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const coverage = Math.min(1, Math.max(0, spot.radius + 0.5 - Math.hypot(x - spot.x, y - spot.y)));
        const alpha = spot.opacity * coverage;
        if (alpha <= 0) continue;
        const offset = (y * width + x) * 4;
        for (let channel = 0; channel < 3; channel += 1) {
          data[offset + channel] = Math.round(data[offset + channel] * (1 - alpha) + color[channel] * alpha);
        }
      }
    }
  }
  context.putImageData(pixels, 0, 0);
}
