import { Suspense, lazy, type CSSProperties, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { Activity, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Box, Camera, ChevronDown, ChevronRight, Circle, CircleHelp, Crosshair, Download, Ear, Eye, EyeOff, Footprints, FolderOpen, GripVertical, Hand, Home, Info, Layers3, LockKeyhole, Maximize, Minimize, MoveVertical, Palette, Paperclip, PersonStanding, Play, Plus, RotateCcw, ScanFace, Search, Send, Settings, SlidersHorizontal, Sparkles, Star, Sun, Trash2, UserRound, Video, Waves, X, Zap, ZoomIn } from 'lucide-react';
import { AccountGate } from './AccountGate';
import { ApiRequestError, apiFetch, requestJson, setCsrfToken, type AuthAccount, type AuthSession } from './apiClient';
import type { CC3MorphControl, CC3MorphControlSpec, ModelPartKey, SkinPaintStroke } from './CC3ModelPreview';
import {
  applyElvenEarPreset,
  ELVEN_EAR_PRESET_MORPHS,
  normalizeCharacterPresetSelection,
  selectCharacterPreset,
  type CharacterPresetKind,
  type CharacterPresetSelection,
} from './characterMorphPresets';
import { BODY_MORPH_GROUPS, bodyMorphGroupForControl, type BodyMorphGroupId } from './bodyMorphGroups';
import { EAR_MORPH_GROUPS, earMorphGroupForControl, type EarMorphGroupId } from './earMorphGroups';
import { HEAD_MORPH_GROUPS, headMorphGroupForControl, type HeadMorphGroupId } from './headMorphGroups';
import { FACE_MORPH_GROUPS, faceMorphGroupForControl, type FaceMorphGroupId } from './faceMorphGroups';
import { EYE_MORPH_GROUPS, eyeMorphGroupForControl, type EyeMorphGroupId } from './eyeMorphGroups';
import { morphAreaForControl } from './morphAreas';
import { isOtherMorphAreaId, OTHER_MORPH_GROUPS, otherMorphGroupForControl, type OtherMorphGroupId } from './otherMorphGroups';
import {
  applySkinDefinitionPatch,
  DEFAULT_SKIN_DEFINITION,
  FRECKLE_PATTERNS,
  normalizeSkinDefinition,
  type SkinDefinition,
  type SkinDefinitionPatch,
} from './semanticSkin';
import {
  createMorphDraftHistory,
  pushMorphDraftHistory,
  redoMorphDraftHistory,
  undoMorphDraftHistory,
} from './draftMorphHistory';
import { getMorphHistoryShortcut } from './morphHistoryShortcut';

const ObjectWorkshop = lazy(() => import('./ObjectWorkshop').then(({ ObjectWorkshop: Workshop }) => ({ default: Workshop })));
const CharacterViewportCanvas = lazy(() => import('./CharacterViewportCanvas'));

type ApiComponent = {
  id: string;
  display_name: string;
  semantic_type: string;
  source_asset?: {
    asset_id?: ApiAssetId;
    glb_sha256?: string;
    morph_control_specs?: CC3MorphControlSpec[];
    morph_preview_mode?: 'client' | 'server';
  };
  cc3_morphs?: Partial<Record<CC3MorphControl, number>>;
  cc3_preset_id?: string | null;
  cc3_head_preset_id?: string | null;
  morphs_baked?: boolean;
  bake_checkpoint_id?: string;
};
type ApiAssetId =
  | 'character_cc3_morphs_v1'
  | 'character_cc3_male_morphs_v1'
  | 'character_cc5_rlcc3plus_all_morphs_v1';
type ApiPhase = { id: string; phase_key: string; title: string; status: string; requires_approval?: boolean };
type ApiReference = { id: string; display_name: string; mime_type: string; width: number; height: number };
type ApiMessage = { id: string; role: 'assistant' | 'user'; content: string; created_at: string };
type AssistantProposal = {
  morph_updates: Record<string, number>;
  appearance_updates: Partial<{ eye_asset_id: string | null; body_preset_id: string | null; head_preset_id: string | null; skin_asset_id: string | null }>;
};
type AssistantGuidance = { target_id: string; title: string; message: string };
type SkinInterpretation = {
  patch: SkinDefinitionPatch;
  preview: SkinDefinition;
  changed_properties: string[];
  explanation: string;
};
const landingCardIds = ['hero', 'assistant', 'new-projects', 'workflow', 'recent-projects'] as const;
type LandingCardId = typeof landingCardIds[number];
const defaultLandingCardOrder: LandingCardId[] = ['hero', 'workflow', 'assistant', 'recent-projects', 'new-projects'];
const priorLandingCardOrder: LandingCardId[] = [...landingCardIds];
const previousDefaultLandingCardOrder: LandingCardId[] = ['hero', 'assistant', 'new-projects', 'recent-projects', 'workflow'];
const landingCardLabels: Record<LandingCardId, string> = {
  hero: 'Welcome',
  assistant: 'Canvas assistant',
  'new-projects': 'New projects',
  'recent-projects': 'Recent projects',
  workflow: 'Workflow',
};

function isLandingCardId(value: unknown): value is LandingCardId {
  return typeof value === 'string' && landingCardIds.some((id) => id === value);
}

function loadLandingCardOrder(): LandingCardId[] {
  try {
    const stored = localStorage.getItem('c3canvas.dashboard-card-order');
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length === landingCardIds.length && parsed.every(isLandingCardId) && new Set(parsed).size === landingCardIds.length) {
        if ([priorLandingCardOrder, previousDefaultLandingCardOrder].some((previousOrder) => parsed.every((id, index) => id === previousOrder[index]))) {
          return [...defaultLandingCardOrder];
        }
        return parsed;
      }
    }
  } catch {
    return [...defaultLandingCardOrder];
  }
  return [...defaultLandingCardOrder];
}
type ChatEntry = {
  role: 'assistant' | 'user';
  text: string;
  proposal?: AssistantProposal;
  guidance?: AssistantGuidance;
  interactionWarning?: string;
  proposalApplied?: boolean;
};
type ApiProject = {
  id: string;
  name: string;
  scene_version: number;
  draft_morphs: Record<CC3MorphControl, number>;
  draft_revision: number;
  draft_appearance: { eye_asset_id: string | null; body_preset_id: string | null; head_preset_id?: string | null; skin_asset_id: string | null };
  draft_skin_paint_strokes: SkinPaintStroke[];
  draft_skin_definition: SkinDefinition;
  draft_skin_revision: number;
  base_model_asset_id: ApiAssetId;
  mode: 'blender';
  components: ApiComponent[];
  phases: ApiPhase[];
  operations?: ApiOperation[];
  component_plan: { id: string | null; display_name: string; semantic_type: string; optional: boolean }[];
  planning_metadata?: { summary?: string; warnings?: string[] };
  references?: ApiReference[];
  messages?: ApiMessage[];
};
type ApiOperation = {
  tool_name: string;
  scene_version: number;
  rollback_checkpoint_id?: string | null;
};
type ApiProjectSummary = {
  id: string;
  name: string;
  base_model_asset_id: ApiAssetId;
  has_character: boolean;
};
type ApiBaseModel = {
  asset_id: ApiAssetId;
  name: string;
  detail: string;
  category: 'character';
  morph_control_count: number;
  glb_sha256: string;
  preview_sha256: string;
  startup_preview_sha256: string | null;
  morph_preview_mode: 'client' | 'server';
  morph_proxy_sha256?: string | null;
  morph_delta_sha256?: string | null;
  morph_presets?: { id: string; label: string; kind: CharacterPresetKind; glb_path?: string; glb_sha256?: string }[];
  requires_approval: boolean;
};

type EyeAsset = {
  id: string;
  name: string;
  category: 'eyes';
  variant: 'game_multi_uv' | 'game_one_uv' | 'normal';
  source_path: string;
  fbx_sha256: string;
  generated_path: string;
  generated_sha256: string;
  file_count: number;
  attachment_status: 'attachable';
};

type SkinAsset = {
  id: string;
  name: string;
  category: 'skin';
  compatible_asset_ids: ApiAssetId[];
  preview_sha256: string;
  materials: Record<string, { diffuse: string; normal: string }>;
};

type ApiHealth = { status: string; blender_available: boolean; blender_error?: string | null };
type DraftSaveStatus = 'saved' | 'saving' | 'error';
type PartState = Record<ModelPartKey, { label: string; visible: boolean }>;

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api/v1';
const SERVER_MORPH_PREVIEW_DEBOUNCE_MS = 350;
const MORPH_CARD_ARTWORK: Record<string, string> = {
  shoulder_size: '/shoulder/shoulder_size.png',
  shoulder_top_peak: '/shoulder/shoulder_top_peak.png',
  ear_angle_top: '/head/ear/ear_angle_top.png',
  ear_angle: '/head/ear/ear_angle.png',
  ear_depth: '/head/ear/ear_depth.png',
  ear_height: '/head/ear/ear_height.png',
  ear_reshape: '/head/ear/Ear_Reshape.png',
  ear_size: '/head/ear/Ear_Size.png',
  ear_length: '/head/ear/ear_length.png',
  earlobe: '/head/ear/earlobe.png',
  eye_angle: '/head/eye/eye_angle.png',
  eye_depth: '/head/eye/eye_depth.png',
  eye_height: '/head/eye/eye_height.png',
  eye_size: '/head/eye/eye_size.png',
  eye_width: '/head/eye/eye_width.png',
  eyeball_distance: '/head/eye/eyeball/eyeball_distance.png',
  eyeball_enlarge: '/head/eye/eyeball/eyeball_enlarge.png',
  eyeball_enlarge_left: '/head/eye/eyeball/eyeball_enlarge_left.png',
  eyeball_enlarge_right: '/head/eye/eyeball/eyeball_enlarge_right.png',
  eyeball_forward_back: '/head/eye/eyeball/eyeball_forward_back.png',
  eyeball_forward_back_right: '/head/eye/eyeball/eyeball_forward_back_right.png',
  eyeball_left_right: '/head/eye/eyeball/eyeball_left_right.png',
  eyeball_side_side_left: '/head/eye/eyeball/eyeball_side_side_left.png',
  eyeball_side_side_right: '/head/eye/eyeball/eyeball_side_side_right.png',
  eyeball_up_down: '/head/eye/eyeball/eyeball_up_down.png',
  eyeball_up_down_left: '/head/eye/eyeball/eyeball_up_down_left.png',
  eyeball_up_down_right: '/head/eye/eyeball/eyeball_up_down_right.png',
  brow_angle: '/head/brow/brow_angle.png',
  brow_depth: '/head/brow/brow_depth.png',
  brow_height: '/head/brow/brow_height.png',
  brow_lower: '/head/brow/brow_lower.png',
  near_brow: '/head/brow/near_brow.png',
  chin_depth: '/head/chin/chin_depth.png',
  chin_length: '/head/chin/chin_length.png',
  chin_width: '/head/chin/chin_width.png',
  jaw_angle: '/head/jaw/jaw_angle.png',
  jaw_define_02: '/head/jaw/jaw_define_02.png',
  jaw_height: '/head/jaw/jaw_height.png',
  jaw_size: '/head/jaw/jaw_size.png',
  nose_bridge_depth: '/head/nose/nose_bridge_depth.png',
  nose_depth: '/head/nose/nose_depth.png',
  cheek_bones_height: '/head/cheek/cheek_bones_height.png',
  cheek_bones_size: '/head/cheek/cheek_bones_size.png',
  cheek_sink: '/head/cheek/cheek_sink.png',
  cranium_slope: '/head/cranium_slope.png',
  skull_depth: '/head/skull/skull_depth.png',
  skull_height: '/head/skull/skull_height.png',
  skull_width: '/head/skull/skull_width.png',
  temples_size: '/head/temples/temples_size.png',
  eye_outer_width_left: '/head/eye/eye_outer_width_left.png',
  eye_outer_width_right: '/head/eye/eye_outer_width_right.png',
  eye_lower_depth: '/head/eye/eye_lower_depth.png',
  eyeball_forward_back_left: '/head/eye/eyeball/eyeball_forward_back_left.png',
  eyeball_shrink: '/head/eye/eyeball/eyeball_shrink.png',
  eyes_outer_inner_width: '/head/eye/eyes_outer_inner_width.png',
  eyes_outer_width: '/head/eye/eyes_outer_width.png',
  lower_eyelid_up: '/head/eye/eyelid/lower_eyelid_up.png',
  eyelid_bottom_in_height: '/head/eye/eyelid/eyelid_bottom_in_height.png',
  eyelash_curl: '/head/eye/eyelash/eyelash_curl.png',
  eyelash_length: '/head/eye/eyelash/eyelash_length.png',
  occiput_shape: '/head/skull/Occiput_Shape.png',
  shoulder_width: '/shoulder_width_icon.png',
  arm_length: '/arm/arm_length.png',
  elbow_thin: '/arm/elbow/elbow_thin.png',
  forearm_inner: '/arm/forearm/forearm_inner.png',
  forearm_length: '/arm/forearm/forearm_length.png',
  forearm_size: '/arm/forearm/forearm_size.png',
  upper_arm_size: '/arm/upper_arm/upper_arm_size.png',
  upper_arm_length: '/arm/upper_arm/upper_arm_length.png',
  upperarm_inner: '/arm/upper_arm/upperarm_inner.png',
  hand_shape: '/hand/hand_shape.png',
  hand_thickness: '/hand/hand_thickness.png',
  hand_tone: '/hand/hand_tone.png',
  proximal_nail_fold: '/hand/nail/proximal_nail_fold.png',
  palm_edge_slim: '/hand/palm/palm_edge_slim.png',
  hand_scale: '/hand/hand_scale.png',
  finger_length: '/hand/finger/finger_length.png',
  finger_width: '/hand/finger/finger_width.png',
  fingernail_shape_a: '/hand/finger/fingernail_shape_a.png',
  fingernail_shape_b: '/hand/finger/fingernail_shape_b.png',
  neck_length: '/neck/neck_length.png',
  neck_size: '/neck/neck_size.png',
  chest_width: '/chest/chest_width.png',
  chest_depth: '/chest/chest_depth.png',
  chest_scale: '/chest/chest_scale.png',
  pectoral_size: '/chest/pectoral/pectoral_size.png',
  waist_width: '/waist/waist_width.png',
  leg_length: '/leg/leg_length.png',
  calves_size_02: '/leg/calves/Calves_Size_02.png',
  quadriceps: '/leg/quads/Quadriceps.png',
  shin_size: '/leg/shin/Shin_Size.png',
  shin_length: '/leg/shin/shin_length.png',
  hamstring_correction: '/leg/hamstring/hamstring_correction.png',
  foot_length: '/foot/foot_length.png',
  toe_depth: '/foot/toe/toe_depth.png',
  toe_length: '/foot/toe/toe_length.png',
  toe_tip_size: '/foot/toe/toe_tip_size.png',
  toe_width: '/foot/toe/toe_width.png',
  foot_arch_02: '/foot/Foot_Arch_02.png',
  ankle_tone: '/leg/ankle/ankle_tone.png',
  foot_scale: '/leg/foot/foot_scale.png',
  foot_shape_02: '/leg/foot/foot_shape_02.png',
  foot_thickness: '/leg/foot/foot_thickness.png',
  foot_tone: '/leg/foot/foot_tone.png',
  knee_bone_width: '/leg/knee/knee_bone_width.png',
  knee_tone: '/leg/knee/knee_tone.png',
  thigh_lower_inner: '/leg/thigh/thigh_lower_inner.png',
  thigh_size: '/leg/thigh/thigh_size.png',
  lip_tone: '/head/mouth/lips/lip_tone.png',
  mouth_depth: '/head/mouth/mouth_depth.png',
  mouth_height: '/head/mouth/mouth_height.png',
  mouth_size: '/head/mouth/mouth_size.png',
  mouth_width: '/head/mouth/mouth_width.png',
  glutes_height: '/leg/glutes/glutes_height.png',
  glutes_size: '/leg/glutes/glutes_size.png',
  hip_length: '/hips/hip_length.png',
  abdomen_middle: '/stomach/abdomen_middle.png',
  torso_length: '/torso/torso_length.png',
  love_handles: '/love_handles/love_handles.png',
  navel: '/stomach/navel.png',
  wrist_size: '/wrist/wrist_size.png',
};
const defaultParts: PartState = {
  body: { label: 'Body, skin and eyelashes', visible: true },
  eyes: { label: 'Eyes and corneas', visible: true },
  teeth: { label: 'Upper and lower teeth', visible: true },
  tongue: { label: 'Tongue', visible: true },
};
const HIDDEN_MORPH_CONTROLS = new Set<CC3MorphControl>(['torso_length']);
const BASIC_CHARACTER_ASSET_ID: ApiAssetId = 'character_cc3_morphs_v1';
const ADVANCED_CHARACTER_ASSET_ID: ApiAssetId = 'character_cc5_rlcc3plus_all_morphs_v1';
const MORPH_AREAS = [
  { id: 'presets', label: 'Presets', icon: Sparkles },
  { id: 'body', label: 'Body', icon: PersonStanding },
  { id: 'head', label: 'Head', icon: MoveVertical },
  { id: 'face', label: 'Face', icon: ScanFace },
  { id: 'eyes', label: 'Eyes', icon: Eye },
  { id: 'nose', label: 'Nose', icon: Activity },
  { id: 'mouth', label: 'Mouth', icon: ScanFace },
  { id: 'ears', label: 'Ears', icon: Ear },
  { id: 'arms', label: 'Arms', icon: Activity },
  { id: 'hands', label: 'Hands', icon: Hand },
  { id: 'legs', label: 'Legs', icon: PersonStanding },
  { id: 'feet', label: 'Feet', icon: Footprints },
  { id: 'tail', label: 'Tail', icon: Waves },
  { id: 'misc', label: 'Misc', icon: CircleHelp },
] as const;
const MORPH_TYPE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'proportions', label: 'Proportions' },
  { id: 'muscle', label: 'Muscle' },
  { id: 'physique', label: 'Physique' },
  { id: 'shape', label: 'Shape' },
  { id: 'other', label: 'Other' },
] as const;
const EAR_MORPH_GROUP_ICONS = {
  tip: ArrowUp,
  earlobe: Circle,
  center: Crosshair,
  rim: Activity,
  'rim-details': Layers3,
  inner: Waves,
  angle: RotateCcw,
  depth: MoveVertical,
  width: ArrowRight,
  height: MoveVertical,
  size: Maximize,
  shape: Ear,
  other: CircleHelp,
} satisfies Record<EarMorphGroupId, typeof Ear>;
const BODY_MORPH_GROUP_ICONS = {
  overall: PersonStanding,
  neck: MoveVertical,
  shoulders: Activity,
  chest: Circle,
  torso: Layers3,
  hips: UserRound,
  limbs: Footprints,
  eyes: Eye,
  tearline: Waves,
  teeth: Sparkles,
  face: ScanFace,
  other: CircleHelp,
} satisfies Record<BodyMorphGroupId, typeof Ear>;
const HEAD_MORPH_GROUP_ICONS = {
  overall: ScanFace,
  skull: Circle,
  forehead: MoveVertical,
  proportions: Maximize,
  orientation: RotateCcw,
} satisfies Record<HeadMorphGroupId, typeof Ear>;
const FACE_MORPH_GROUP_ICONS = {
  'face-shape': ScanFace,
  brows: Eye,
  'shape-presets': Sparkles,
} satisfies Record<FaceMorphGroupId, typeof Ear>;
const EYE_MORPH_GROUP_ICONS = {
  position: MoveVertical,
  corners: Crosshair,
  lids: Eye,
  expression: Zap,
  'lashes-upper': ArrowUp,
  'lashes-lower': ArrowDown,
  lashes: Activity,
  'under-eye': Waves,
  socket: Circle,
  'iris-pupil': Circle,
  'eye-shape': ScanFace,
  'lid-presets': Sparkles,
} satisfies Record<EyeMorphGroupId, typeof Ear>;
const OTHER_MORPH_GROUP_ICONS = {
  'nose--nostrils': Crosshair,
  'nose--tip': ArrowUp,
  'nose--shape': ScanFace,
  'mouth--expression': Circle,
  'mouth--lips': Waves,
  'mouth--jaw': UserRound,
  'mouth--cheeks': ScanFace,
  'mouth--teeth': Sparkles,
  'mouth--tongue': Waves,
  'arms--upper-arm': Activity,
  'arms--forearm': Activity,
  'arms--elbow': Circle,
  'arms--wrist': Circle,
  'arms--general': PersonStanding,
  'hands--fingers': Hand,
  'hands--palm': Hand,
  'hands--nails': Sparkles,
  'hands--general': Hand,
  'legs--thigh': Footprints,
  'legs--knee': Circle,
  'legs--lower-leg': Footprints,
  'legs--ankle': Circle,
  'legs--general': Footprints,
  'feet--foot': Footprints,
  'feet--toes': Footprints,
  'feet--heel': Circle,
  'feet--general': Footprints,
  'misc--dental': Sparkles,
  'misc--eyeball': Eye,
  'misc--eye-orbit': Eye,
  'misc--tearline': Waves,
  'misc--numbered': CircleHelp,
  'misc--body-pose': PersonStanding,
  'misc--face-detail': ScanFace,
  'misc--base-shape': Layers3,
  'misc--other': CircleHelp,
} satisfies Record<OtherMorphGroupId, typeof Ear>;
type BodyAreaId = string;
type MorphLibraryView = 'all' | 'favorites' | 'recent';
type MorphTypeFilter = typeof MORPH_TYPE_FILTERS[number]['id'];

type MorphControlIdentity = Pick<CC3MorphControlSpec, 'id' | 'label' | 'category'>;

function morphTypeForControl(control: MorphControlIdentity): Exclude<MorphTypeFilter, 'all'> {
  const text = `${control.label} ${control.id}`.toLocaleLowerCase().replaceAll('_', ' ');
  if (/\b(muscle|muscular|bicep|tricep|athletic|definition)\b/.test(text)) return 'muscle';
  if (/\b(physique|fat|weight|build|body type)\b/.test(text)) return 'physique';
  if (/\b(height|width|length|scale|depth|proportion|size|distance)\b/.test(text)) return 'proportions';
  if (/\b(shape|round|square|oval|pointed|angular|fullness)\b/.test(text)) return 'shape';
  return 'other';
}

function morphInputId(id: string, prefix: string): string {
  return `${prefix}-${encodeURIComponent(id)}`;
}

function morphDisplayLabel(label: string): string {
  if (!label.includes('_')) return label;
  return label
    .replace(/^\d+_/, '')
    .replace(/_L\b/g, ' Left')
    .replace(/_R\b/g, ' Right')
    .replaceAll('_', ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b[a-z]/g, (letter) => letter.toLocaleUpperCase());
}

function summarizeProject(project: ApiProject): ApiProjectSummary {
  return {
    id: project.id,
    name: project.name,
    base_model_asset_id: project.base_model_asset_id,
    has_character: project.components.some((component) => Boolean(component.source_asset?.asset_id)),
  };
}

export default function App() {
  const [project, setProject] = useState<ApiProject | null>(null);
  const [account, setAccount] = useState<AuthAccount | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [authRetry, setAuthRetry] = useState(0);
  const [zoomFitViewport, setZoomFitViewport] = useState<{ width: number; height: number } | null>(null);
  const [objectWorkshopOpen, setObjectWorkshopOpen] = useState(false);
  const [savedProjects, setSavedProjects] = useState<ApiProjectSummary[]>([]);
  const [apiReady, setApiReady] = useState(false);
  const [blenderAvailable, setBlenderAvailable] = useState(false);
  const [blenderError, setBlenderError] = useState('');
  const [apiError, setApiError] = useState('');
  const [initialDataRetry, setInitialDataRetry] = useState(0);
  const [initialDataLoading, setInitialDataLoading] = useState(true);
  const [savedProjectsLoading, setSavedProjectsLoading] = useState(true);
  const [savedProjectsError, setSavedProjectsError] = useState('');
  const [availableBaseModels, setAvailableBaseModels] = useState<ApiBaseModel[]>([]);
  const [eyeAssets, setEyeAssets] = useState<EyeAsset[]>([]);
  const [eyeAssetsLoading, setEyeAssetsLoading] = useState(true);
  const [eyeAssetsError, setEyeAssetsError] = useState('');
  const [eyeAssetsRetry, setEyeAssetsRetry] = useState(0);
  const [skinAssets, setSkinAssets] = useState<SkinAsset[]>([]);
  const [skinAssetsLoading, setSkinAssetsLoading] = useState(true);
  const [skinAssetsError, setSkinAssetsError] = useState('');
  const [skinAssetsRetry, setSkinAssetsRetry] = useState(0);
  const [skinPreviewError, setSkinPreviewError] = useState('');
  const [skinPaintEnabled, setSkinPaintEnabled] = useState(false);
  const [skinPaintColor, setSkinPaintColor] = useState('#c84051');
  const [skinPaintTool, setSkinPaintTool] = useState<'paint' | 'freckles' | 'erase'>('paint');
  const [skinPaintSize, setSkinPaintSize] = useState(28);
  const [skinPaintOpacity, setSkinPaintOpacity] = useState(75);
  const [skinPaintDraftStrokes, setSkinPaintDraftStrokes] = useState<SkinPaintStroke[]>([]);
  const skinPaintDraftStrokesRef = useRef<SkinPaintStroke[]>([]);
  const skinPaintSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [skinPaintPointerOnModel, setSkinPaintPointerOnModel] = useState(false);
  useEffect(() => {
    let active = true;
    setAuthLoading(true);
    requestJson<AuthSession>('/auth/session').then((session) => {
      if (!active) return;
      setCsrfToken(session.csrf_token);
      setAccount(session.account);
      setAuthError('');
    }).catch((error: unknown) => {
      if (!active) return;
      setAuthError(error instanceof Error ? error.message : 'Account session could not be checked.');
      setAccount(null);
    }).finally(() => {
      if (active) setAuthLoading(false);
    });
    return () => { active = false; };
  }, [authRetry]);
  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 760px)');
    const visualViewport = window.visualViewport;
    const updateCompactWorkspace = () => setCompactWorkspace(
      mediaQuery.matches || Boolean(visualViewport && visualViewport.scale > 1.25 && visualViewport.width < 760),
    );
    mediaQuery.addEventListener('change', updateCompactWorkspace);
    visualViewport?.addEventListener('resize', updateCompactWorkspace);
    window.addEventListener('resize', updateCompactWorkspace);
    return () => {
      mediaQuery.removeEventListener('change', updateCompactWorkspace);
      visualViewport?.removeEventListener('resize', updateCompactWorkspace);
      window.removeEventListener('resize', updateCompactWorkspace);
    };
  }, []);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const updateZoomFitViewport = () => {
      const needsFit = viewport.scale > 1.25 && viewport.width < 760 && viewport.height < 420;
      setZoomFitViewport(needsFit ? { width: viewport.width, height: viewport.height } : null);
    };

    updateZoomFitViewport();
    viewport.addEventListener('resize', updateZoomFitViewport);
    window.addEventListener('resize', updateZoomFitViewport);
    return () => {
      viewport.removeEventListener('resize', updateZoomFitViewport);
      window.removeEventListener('resize', updateZoomFitViewport);
    };
  }, []);
  useEffect(() => {
    const canvas = viewportRef.current?.querySelector('canvas');
    if (!canvas) return;
    canvas.style.cursor = skinPaintEnabled
      ? (skinPaintPointerOnModel ? 'none' : 'crosshair')
      : '';
    return () => {
      canvas.style.cursor = '';
    };
  }, [skinPaintEnabled, skinPaintPointerOnModel]);
  const [skinDefinitionDraft, setSkinDefinitionDraft] = useState<SkinDefinition>(DEFAULT_SKIN_DEFINITION);
  const [skinPrompt, setSkinPrompt] = useState('');
  const [skinInterpretation, setSkinInterpretation] = useState<SkinInterpretation | null>(null);
  const [skinInterpretationLoading, setSkinInterpretationLoading] = useState(false);
  const [skinInterpretationError, setSkinInterpretationError] = useState('');
  const [skinDefinitionSaving, setSkinDefinitionSaving] = useState(false);
  const onSkinPreviewError = useCallback((error: string) => setSkinPreviewError(error), []);
  const [baseModelsLoading, setBaseModelsLoading] = useState(true);
  const [baseModelsError, setBaseModelsError] = useState('');
  const [morphControlsByAsset, setMorphControlsByAsset] = useState<Partial<Record<ApiAssetId, CC3MorphControlSpec[]>>>({});
  const [morphControlsLoading, setMorphControlsLoading] = useState(true);
  const [morphControlsError, setMorphControlsError] = useState('');
  const [morphControlsRetry, setMorphControlsRetry] = useState(0);
  const [projectName, setProjectName] = useState('My Project');
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [message, setMessage] = useState('');
  const [running, setRunning] = useState(false);
  const [appearanceSaving, setAppearanceSaving] = useState(false);
  const appearanceSaveInProgress = useRef(false);
  const [importingCharacter, setImportingCharacter] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [removingReferenceId, setRemovingReferenceId] = useState<string | null>(null);
  const [referenceActionError, setReferenceActionError] = useState('');
  const [parts, setParts] = useState(defaultParts);
  const [morphs, setMorphs] = useState<Record<CC3MorphControl, number>>({});
  const [morphHistory, setMorphHistory] = useState(() => createMorphDraftHistory<Record<CC3MorphControl, number>>());
  const [activeBodyPresetIds, setActiveBodyPresetIds] = useState<CharacterPresetSelection>({ body: null, head: null });
  const [draftSaveStatus, setDraftSaveStatus] = useState<DraftSaveStatus>('saved');
  const [draftSaveError, setDraftSaveError] = useState('');
  const [draftSaveRetry, setDraftSaveRetry] = useState(0);
  const [serverMorphPreview, setServerMorphPreview] = useState<{
    url: string;
    projectId: string;
    componentId: string;
    sceneVersion: number;
  } | null>(null);
  const chooseViewportLayout = (layout: 'viewport' | 'balanced' | 'editor') => {
    setViewportLayout(layout);
  };
  const [serverMorphPreviewStatus, setServerMorphPreviewStatus] = useState<'idle' | 'updating' | 'error'>('idle');
  const [serverMorphPreviewError, setServerMorphPreviewError] = useState('');
  const [clientMorphPreviewStatus, setClientMorphPreviewStatus] = useState<'idle' | 'updating' | 'error'>('idle');
  const [clientMorphPreviewError, setClientMorphPreviewError] = useState('');
  const onClientMorphPreviewState = useCallback((status: 'idle' | 'updating' | 'error', error: string) => {
    setClientMorphPreviewStatus(status);
    setClientMorphPreviewError(error);
  }, []);
  const [morphPreviewRetry, setMorphPreviewRetry] = useState(0);
  const [morphPreviewEnabled, setMorphPreviewEnabled] = useState(false);
  const [morphInteractionActive, setMorphInteractionActive] = useState(false);
  const [selectedBodyArea, setSelectedBodyArea] = useState<BodyAreaId>('body');
  const [selectedBodyMorphGroupId, setSelectedBodyMorphGroupId] = useState<BodyMorphGroupId | null>(null);
  const [selectedEarMorphGroupId, setSelectedEarMorphGroupId] = useState<EarMorphGroupId | null>(null);
  const [selectedHeadMorphGroupId, setSelectedHeadMorphGroupId] = useState<HeadMorphGroupId | null>(null);
  const [selectedFaceMorphGroupId, setSelectedFaceMorphGroupId] = useState<FaceMorphGroupId | null>(null);
  const [selectedEyeMorphGroupId, setSelectedEyeMorphGroupId] = useState<EyeMorphGroupId | null>(null);
  const [selectedOtherMorphGroupId, setSelectedOtherMorphGroupId] = useState<OtherMorphGroupId | null>(null);
  const [morphMode, setMorphMode] = useState<'basic' | 'advanced'>('basic');
  const [morphSearch, setMorphSearch] = useState('');
  const [morphLibraryView, setMorphLibraryView] = useState<MorphLibraryView>('all');
  const [morphTypeFilter, setMorphTypeFilter] = useState<MorphTypeFilter>('all');
  const [selectedMorphId, setSelectedMorphId] = useState<CC3MorphControl | null>(null);
  const [favoriteMorphIds, setFavoriteMorphIds] = useState<string[]>([]);
  const [recentMorphIds, setRecentMorphIds] = useState<string[]>([]);
  const [cameraKey, setCameraKey] = useState(0);
  const [cameraMode, setCameraMode] = useState<'orbit' | 'pan' | 'zoom'>('orbit');
  const orbitControlsRef = useRef<OrbitControlsImpl | null>(null);
  const [viewportCanvasReady, setViewportCanvasReady] = useState(false);
  const notifyCanvasCreated = useCallback(() => setViewportCanvasReady(true), []);
  const panModeButtonRef = useRef<HTMLButtonElement>(null);
  const [cameraProjection, setCameraProjection] = useState<'perspective' | 'orthographic'>('perspective');
  const [characterDockWidth, setCharacterDockWidth] = useState(() => Math.min(
    760,
    Math.max(300, Math.min(window.innerWidth * 0.445, window.innerWidth * 0.848 - 320)),
  ));
  const [characterDockHeight, setCharacterDockHeight] = useState(48);
  const [characterDockResizing, setCharacterDockResizing] = useState(false);
  const [compactWorkspace, setCompactWorkspace] = useState(() => {
    const visualViewport = window.visualViewport;
    return window.matchMedia('(max-width: 760px)').matches
      || Boolean(visualViewport && visualViewport.scale > 1.25 && visualViewport.width < 760);
  });
  const [viewportLayout, setViewportLayout] = useState<'viewport' | 'balanced' | 'editor'>('balanced');
  useEffect(() => {
    const updateWorkspaceSize = () => {
      if (compactWorkspace) {
        setCharacterDockHeight(viewportLayout === 'viewport' ? 38 : viewportLayout === 'editor' ? 60 : 48);
        return;
      }
      const maxWidth = Math.max(300, (workspaceRef.current?.clientWidth ?? window.innerWidth * 0.848) - 320);
      setCharacterDockWidth(viewportLayout === 'viewport'
        ? Math.min(440, maxWidth)
        : viewportLayout === 'editor'
          ? Math.min(760, maxWidth)
          : Math.min(760, Math.max(300, Math.min(window.innerWidth * 0.445, maxWidth))));
    };
    updateWorkspaceSize();
    window.addEventListener('resize', updateWorkspaceSize);
    return () => window.removeEventListener('resize', updateWorkspaceSize);
  }, [compactWorkspace, viewportLayout, project?.id]);
  const [lightingPreset, setLightingPreset] = useState<'cool' | 'warm'>('cool');
  const [fillLightsEnabled, setFillLightsEnabled] = useState(true);
  const [viewportFullscreen, setViewportFullscreen] = useState(false);
  const [viewportControlError, setViewportControlError] = useState('');
  const [selectedPart, setSelectedPart] = useState<ModelPartKey | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectStep, setNewProjectStep] = useState<'asset-types' | 'character-setup'>('asset-types');
  const [projectCreationError, setProjectCreationError] = useState('');
  const [selectedBaseModel, setSelectedBaseModel] = useState<ApiBaseModel['asset_id'] | null>(null);
  const [studioSection, setStudioSection] = useState<'scene' | 'models'>('models');
  const [customizationCategory, setCustomizationCategory] = useState<'body' | 'eyes' | 'skin' | 'clothing' | 'accessories'>('body');
  const [savedProjectsOpen, setSavedProjectsOpen] = useState(false);
  const [landingSection, setLandingSection] = useState<'home' | 'projects'>('home');
  const [showAllLandingProjects, setShowAllLandingProjects] = useState(false);
  const [landingCardOrder, setLandingCardOrder] = useState<LandingCardId[]>(loadLandingCardOrder);
  const [landingCardStorageError, setLandingCardStorageError] = useState('');
  const [draggingLandingCard, setDraggingLandingCard] = useState<LandingCardId | null>(null);
  const [landingDropTarget, setLandingDropTarget] = useState<LandingCardId | null>(null);
  const [chatOpen, setChatOpen] = useState(true);
  useEffect(() => {
    if (project && (zoomFitViewport || compactWorkspace)) setChatOpen(false);
  }, [project?.id, zoomFitViewport !== null || compactWorkspace]);
  const [activeGuidance, setActiveGuidance] = useState<AssistantGuidance | null>(null);
  const [guidancePosition, setGuidancePosition] = useState<{ left: number; top: number; arrowLeft: number; placement: 'above' | 'below' } | null>(null);
  const projectNameInput = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const landingCardDragRef = useRef<{ cardId: LandingCardId; pointerId: number; startX: number; startY: number; moved: boolean; target: LandingCardId | null } | null>(null);
  const morphPreviewRequestId = useRef(0);
  const morphPreviewAbortController = useRef<AbortController | null>(null);
  const draftSaveInFlight = useRef(false);
  const activeProjectId = useRef<string | null>(null);
  activeProjectId.current = project?.id ?? null;
  const latestMorphs = useRef(morphs);
  latestMorphs.current = morphs;
  const morphHistoryRef = useRef(morphHistory);
  morphHistoryRef.current = morphHistory;
  const morphInteractionRef = useRef(false);
  const morphGestureHistoryCaptured = useRef(false);
  const morphPreviewRetryTimeout = useRef<number | null>(null);
  const morphPreviewObjectUrl = useRef<string | null>(null);
  useEffect(() => {
    const emptyHistory = createMorphDraftHistory<Record<CC3MorphControl, number>>();
    morphHistoryRef.current = emptyHistory;
    setMorphHistory(emptyHistory);
    morphInteractionRef.current = false;
    morphGestureHistoryCaptured.current = false;
    setMorphInteractionActive(false);
  }, [project?.id]);
  useEffect(() => {
    if (!project) setViewportCanvasReady(false);
  }, [project?.id]);
  useEffect(() => {
    const canvas = viewportRef.current?.querySelector('canvas');
    const panButton = panModeButtonRef.current;
    if (!canvas || !panButton) return;

    let ctrlZoomPointerId: number | null = null;
    let panRequested = false;
    let panRequestId = 0;
    let suppressPanClick = false;
    const startPan = (event: PointerEvent) => {
      if (event.button !== 0 || event.pointerType === 'touch' || panRequested) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      panRequested = true;
      const requestId = ++panRequestId;
      suppressPanClick = true;
      setCameraMode('pan');
      setViewportControlError('');
      try {
        const request = canvas.requestPointerLock();
        if (request && typeof request.then === 'function') {
          void request.then(() => {
            if (!panRequested && document.pointerLockElement === canvas) document.exitPointerLock();
          }).catch(() => {
            if (requestId !== panRequestId) return;
            panRequested = false;
            setViewportControlError('Pointer lock could not be activated. Check browser permissions and try again.');
          });
        }
      } catch {
        panRequested = false;
        setViewportControlError('Pointer lock could not be activated. Check browser permissions and try again.');
      }
    };
    const startNavigation = (event: PointerEvent) => {
      const controls = orbitControlsRef.current;
      if (event.button !== 1 || !(event.ctrlKey || event.metaKey) || !controls?.enabled) return;
      ctrlZoomPointerId = event.pointerId;
      controls.mouseButtons.MIDDLE = 1;
    };
    const stopLockedMouseEvent = (event: Event) => {
      if (!panRequested) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === 'pointerup' || event.type === 'pointercancel' || event.type === 'mouseup') finishPan();
    };
    const stopPanClick = (event: MouseEvent) => {
      if (!suppressPanClick) return;
      suppressPanClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const panWithMovement = (event: MouseEvent) => {
      if (!panRequested || document.pointerLockElement !== canvas) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const controls = orbitControlsRef.current;
      if (!controls) return;
      const bounds = canvas.getBoundingClientRect();
      if (bounds.height <= 0) return;
      const camera = controls.object;
      let worldPerPixel: number;
      if ('isOrthographicCamera' in camera && camera.isOrthographicCamera) {
        worldPerPixel = (camera.top - camera.bottom) / camera.zoom / bounds.height;
      } else if ('fov' in camera && typeof camera.fov === 'number') {
        worldPerPixel = 2 * controls.getDistance() * Math.tan((camera.fov * Math.PI) / 360) / bounds.height;
      } else {
        return;
      }
      camera.updateMatrixWorld();
      const matrix = camera.matrix.elements;
      const movementX = -event.movementX * worldPerPixel;
      const movementY = event.movementY * worldPerPixel;
      const offsetX = matrix[0] * movementX + matrix[4] * movementY;
      const offsetY = matrix[1] * movementX + matrix[5] * movementY;
      const offsetZ = matrix[2] * movementX + matrix[6] * movementY;
      camera.position.x += offsetX;
      camera.position.y += offsetY;
      camera.position.z += offsetZ;
      controls.target.x += offsetX;
      controls.target.y += offsetY;
      controls.target.z += offsetZ;
      controls.update();
    };
    const finishPan = () => {
      if (panRequested) {
        panRequested = false;
        if (document.pointerLockElement === canvas) document.exitPointerLock();
      }
      window.setTimeout(() => {
        suppressPanClick = false;
      }, 0);
    };
    const onPointerLockChange = () => {
      if (document.pointerLockElement === canvas) {
        if (!panRequested) document.exitPointerLock();
        return;
      }
      if (!panRequested) return;
      panRequested = false;
    };
    const onPointerLockError = () => {
      if (!panRequested) return;
      panRequested = false;
      setViewportControlError('Pointer lock could not be activated. Check browser permissions and try again.');
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') finishPan();
    };
    const onWindowBlur = () => finishPan();
    const stopLockedKeyEvent = (event: KeyboardEvent) => {
      if (!panRequested || document.pointerLockElement !== canvas || event.key === 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const finishNavigation = (event: PointerEvent) => {
      if (event.pointerId !== ctrlZoomPointerId) return;
      ctrlZoomPointerId = null;
      const controls = orbitControlsRef.current;
      if (controls) controls.mouseButtons.MIDDLE = 0;
    };

    panButton.addEventListener('pointerdown', startPan, true);
    panButton.addEventListener('click', stopPanClick, true);
    document.addEventListener('mousemove', panWithMovement, true);
    document.addEventListener('mousemove', stopLockedMouseEvent, true);
    document.addEventListener('pointerdown', stopLockedMouseEvent, true);
    document.addEventListener('pointermove', stopLockedMouseEvent, true);
    document.addEventListener('mousedown', stopLockedMouseEvent, true);
    document.addEventListener('mouseup', stopLockedMouseEvent, true);
    document.addEventListener('click', stopLockedMouseEvent, true);
    document.addEventListener('pointerup', stopLockedMouseEvent, true);
    document.addEventListener('pointercancel', stopLockedMouseEvent, true);
    document.addEventListener('pointerup', finishPan, true);
    document.addEventListener('mouseup', finishPan, true);
    document.addEventListener('pointercancel', finishPan, true);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('pointerlockerror', onPointerLockError);
    document.addEventListener('visibilitychange', onVisibilityChange);
    document.addEventListener('keydown', stopLockedKeyEvent, true);
    document.addEventListener('keyup', stopLockedKeyEvent, true);
    window.addEventListener('blur', onWindowBlur);
    canvas.addEventListener('pointerdown', startNavigation, true);
    window.addEventListener('pointerup', finishNavigation, true);
    window.addEventListener('pointercancel', finishNavigation, true);
    return () => {
      panButton.removeEventListener('pointerdown', startPan, true);
      panButton.removeEventListener('click', stopPanClick, true);
      document.removeEventListener('mousemove', panWithMovement, true);
      document.removeEventListener('mousemove', stopLockedMouseEvent, true);
      document.removeEventListener('pointerdown', stopLockedMouseEvent, true);
      document.removeEventListener('pointermove', stopLockedMouseEvent, true);
      document.removeEventListener('mousedown', stopLockedMouseEvent, true);
      document.removeEventListener('mouseup', stopLockedMouseEvent, true);
      document.removeEventListener('click', stopLockedMouseEvent, true);
      document.removeEventListener('pointerup', stopLockedMouseEvent, true);
      document.removeEventListener('pointercancel', stopLockedMouseEvent, true);
      document.removeEventListener('pointerup', finishPan, true);
      document.removeEventListener('mouseup', finishPan, true);
      document.removeEventListener('pointercancel', finishPan, true);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      document.removeEventListener('pointerlockerror', onPointerLockError);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      document.removeEventListener('keydown', stopLockedKeyEvent, true);
      document.removeEventListener('keyup', stopLockedKeyEvent, true);
      window.removeEventListener('blur', onWindowBlur);
      canvas.removeEventListener('pointerdown', startNavigation, true);
      window.removeEventListener('pointerup', finishNavigation, true);
      window.removeEventListener('pointercancel', finishNavigation, true);
      finishPan();
      panRequestId += 1;
      const controls = orbitControlsRef.current;
      if (controls) controls.mouseButtons.MIDDLE = 0;
    };
  }, [cameraKey, cameraProjection, project?.id, viewportCanvasReady]);
  const projectAssetId = project?.base_model_asset_id
    ?? project?.components.find((item) => item.source_asset?.asset_id)?.source_asset?.asset_id;
  const activeAssetId = projectAssetId ?? selectedBaseModel;
  const morphControlsAssetId = activeAssetId ?? 'character_cc3_morphs_v1';
  const body = project?.components.find((item) => item.semantic_type === 'body')
    ?? project?.components.find((item) => item.source_asset?.asset_id === projectAssetId);
  const isCc5FullMorphAsset = morphControlsAssetId === 'character_cc5_rlcc3plus_all_morphs_v1';
  const previewModelInfo = availableBaseModels.find((model) => model.asset_id === activeAssetId)
    ?? availableBaseModels.find((model) => model.asset_id === 'character_cc3_morphs_v1')
    ?? null;
  const cc5ModelInfo = availableBaseModels.find((model) => model.asset_id === 'character_cc5_rlcc3plus_all_morphs_v1');
  const bodyPresets = cc5ModelInfo?.morph_presets?.length ? cc5ModelInfo.morph_presets : previewModelInfo?.morph_presets ?? [];
  const morphPreviewMode = isCc5FullMorphAsset
    ? availableBaseModels.find((model) => model.asset_id === projectAssetId)?.morph_preview_mode
      ?? body?.source_asset?.morph_preview_mode
      ?? 'server'
    : body?.source_asset?.morph_preview_mode ?? previewModelInfo?.morph_preview_mode ?? 'client';
  const controls = body?.source_asset?.morph_control_specs ?? morphControlsByAsset[morphControlsAssetId] ?? [];
  const visibleControls = useMemo(
    () => controls.filter(({ id }) => isCc5FullMorphAsset || !HIDDEN_MORPH_CONTROLS.has(id)),
    [controls, isCc5FullMorphAsset],
  );
  const visibleMorphControlCount = visibleControls.length;
  const savedMorphs = body?.cc3_morphs ?? project?.draft_morphs ?? {};
  const savedBodyPresetIds = normalizeCharacterPresetSelection(
    bodyPresets,
    body?.cc3_preset_id ?? project?.draft_appearance?.body_preset_id,
    body?.cc3_head_preset_id ?? project?.draft_appearance?.head_preset_id,
  );
  const morphAreas = useMemo(() => {
    const counts = new Map<string, number>();
    for (const control of visibleControls) {
      const area = morphAreaForControl(control);
      counts.set(area, (counts.get(area) ?? 0) + 1);
    }
    return MORPH_AREAS
      .filter(({ id }) => id === 'presets' || counts.has(id))
      .map((area) => ({
        ...area,
        count: area.id === 'presets' ? bodyPresets.length : counts.get(area.id) ?? 0,
      }));
  }, [bodyPresets.length, visibleControls]);
  const activeBodyArea = morphAreas.find(({ id }) => id === selectedBodyArea) ?? morphAreas[0];
  const activeBodyMorphGroup = BODY_MORPH_GROUPS.find(({ id }) => id === selectedBodyMorphGroupId) ?? null;
  const activeEarMorphGroup = EAR_MORPH_GROUPS.find(({ id }) => id === selectedEarMorphGroupId) ?? null;
  const activeHeadMorphGroup = HEAD_MORPH_GROUPS.find(({ id }) => id === selectedHeadMorphGroupId) ?? null;
  const activeFaceMorphGroup = FACE_MORPH_GROUPS.find(({ id }) => id === selectedFaceMorphGroupId) ?? null;
  const activeEyeMorphGroup = EYE_MORPH_GROUPS.find(({ id }) => id === selectedEyeMorphGroupId) ?? null;
  const activeOtherMorphGroup = isOtherMorphAreaId(activeBodyArea?.id)
    ? OTHER_MORPH_GROUPS[activeBodyArea.id].find(({ id }) => id === selectedOtherMorphGroupId) ?? null
    : null;
  const isBodyMorphRoot = activeBodyArea?.id === 'body' && activeBodyMorphGroup === null && !morphSearch.trim();
  const isEarMorphRoot = activeBodyArea?.id === 'ears' && activeEarMorphGroup === null && !morphSearch.trim();
  const isHeadMorphRoot = activeBodyArea?.id === 'head' && activeHeadMorphGroup === null && !morphSearch.trim();
  const isFaceMorphRoot = activeBodyArea?.id === 'face' && activeFaceMorphGroup === null && !morphSearch.trim();
  const isEyeMorphRoot = activeBodyArea?.id === 'eyes' && activeEyeMorphGroup === null && !morphSearch.trim();
  const isOtherMorphRoot = isOtherMorphAreaId(activeBodyArea?.id) && activeOtherMorphGroup === null && !morphSearch.trim();
  const bodyAreaControls = useMemo(
    () => visibleControls.filter((control) => (
      morphAreaForControl(control) === activeBodyArea?.id
      && (activeBodyArea?.id !== 'body'
        || selectedBodyMorphGroupId === null
        || bodyMorphGroupForControl(control) === selectedBodyMorphGroupId)
      && (activeBodyArea?.id !== 'ears'
        || selectedEarMorphGroupId === null
        || earMorphGroupForControl(control) === selectedEarMorphGroupId)
      && (activeBodyArea?.id !== 'head'
        || selectedHeadMorphGroupId === null
        || headMorphGroupForControl(control) === selectedHeadMorphGroupId)
      && (activeBodyArea?.id !== 'face'
        || selectedFaceMorphGroupId === null
        || faceMorphGroupForControl(control) === selectedFaceMorphGroupId)
      && (activeBodyArea?.id !== 'eyes'
        || selectedEyeMorphGroupId === null
        || eyeMorphGroupForControl(control) === selectedEyeMorphGroupId)
      && (!isOtherMorphAreaId(activeBodyArea?.id)
        || selectedOtherMorphGroupId === null
        || otherMorphGroupForControl(activeBodyArea.id, control) === selectedOtherMorphGroupId)
    )),
    [activeBodyArea?.id, selectedBodyMorphGroupId, selectedEarMorphGroupId, selectedHeadMorphGroupId, selectedFaceMorphGroupId, selectedEyeMorphGroupId, selectedOtherMorphGroupId, visibleControls],
  );
  const elvenEarPresetAvailable = isCc5FullMorphAsset
    && Object.keys(ELVEN_EAR_PRESET_MORPHS).every((id) => controls.some((control) => control.id === id));
  const elvenEarPresetApplied = elvenEarPresetAvailable
    && Object.entries(ELVEN_EAR_PRESET_MORPHS).every(([id, value]) => (morphs[id] ?? 0) === value);
  const morphLibraryScopeControls = useMemo(() => {
    const query = morphSearch.trim().toLocaleLowerCase();
    return visibleControls.filter((control) => {
      const { id, label, category } = control;
      if (!query && morphAreaForControl(control) !== activeBodyArea?.id) return false;
      if (
        !query
        && activeBodyArea?.id === 'body'
        && selectedBodyMorphGroupId !== null
        && bodyMorphGroupForControl(control) !== selectedBodyMorphGroupId
      ) return false;
      if (
        !query
        && activeBodyArea?.id === 'ears'
        && selectedEarMorphGroupId !== null
        && earMorphGroupForControl(control) !== selectedEarMorphGroupId
      ) return false;
      if (
        !query
        && activeBodyArea?.id === 'head'
        && selectedHeadMorphGroupId !== null
        && headMorphGroupForControl(control) !== selectedHeadMorphGroupId
      ) return false;
      if (
        !query
        && activeBodyArea?.id === 'face'
        && selectedFaceMorphGroupId !== null
        && faceMorphGroupForControl(control) !== selectedFaceMorphGroupId
      ) return false;
      if (
        !query
        && activeBodyArea?.id === 'eyes'
        && selectedEyeMorphGroupId !== null
        && eyeMorphGroupForControl(control) !== selectedEyeMorphGroupId
      ) return false;
      if (
        !query
        && isOtherMorphAreaId(activeBodyArea?.id)
        && selectedOtherMorphGroupId !== null
        && otherMorphGroupForControl(activeBodyArea.id, control) !== selectedOtherMorphGroupId
      ) return false;
      if (morphTypeFilter !== 'all' && morphTypeForControl({ id, label, category }) !== morphTypeFilter) return false;
      const searchText = [
        label,
        category,
        id,
        control.positive_shape_key,
        control.negative_shape_key,
      ].filter(Boolean).join(' ').toLocaleLowerCase();
      return !query || searchText.includes(query);
    });
  }, [activeBodyArea?.id, morphSearch, morphTypeFilter, selectedBodyMorphGroupId, selectedEarMorphGroupId, selectedHeadMorphGroupId, selectedFaceMorphGroupId, selectedEyeMorphGroupId, selectedOtherMorphGroupId, visibleControls]);
  const visibleLibraryControls = useMemo(
    () => morphLibraryScopeControls.filter(({ id }) => (
      morphLibraryView === 'favorites'
        ? favoriteMorphIds.includes(id)
        : morphLibraryView !== 'recent' || recentMorphIds.includes(id)
    )),
    [favoriteMorphIds, morphLibraryScopeControls, morphLibraryView, recentMorphIds],
  );
  const morphLibraryCounts = useMemo(() => ({
    all: morphLibraryScopeControls.length,
    favorites: morphLibraryScopeControls.filter(({ id }) => favoriteMorphIds.includes(id)).length,
    recent: morphLibraryScopeControls.filter(({ id }) => recentMorphIds.includes(id)).length,
  }), [favoriteMorphIds, morphLibraryScopeControls, recentMorphIds]);
  const visibleBodyMorphGroups = useMemo(() => {
    const counts = new Map<BodyMorphGroupId, number>();
    for (const control of visibleLibraryControls) {
      if (morphAreaForControl(control) !== 'body') continue;
      const groupId = bodyMorphGroupForControl(control);
      counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
    }
    return BODY_MORPH_GROUPS
      .filter(({ id }) => (counts.get(id) ?? 0) > 0)
      .map((group) => ({ ...group, count: counts.get(group.id) ?? 0 }));
  }, [visibleLibraryControls]);
  const visibleEarMorphGroups = useMemo(() => {
    const counts = new Map<EarMorphGroupId, number>();
    for (const control of visibleLibraryControls) {
      if (morphAreaForControl(control) !== 'ears') continue;
      const groupId = earMorphGroupForControl(control);
      counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
    }
    return EAR_MORPH_GROUPS
      .filter(({ id }) => (counts.get(id) ?? 0) > 0)
      .map((group) => ({ ...group, count: counts.get(group.id) ?? 0 }));
  }, [visibleLibraryControls]);
  const visibleHeadMorphGroups = useMemo(() => {
    const counts = new Map<HeadMorphGroupId, number>();
    for (const control of visibleLibraryControls) {
      if (morphAreaForControl(control) !== 'head') continue;
      const groupId = headMorphGroupForControl(control);
      counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
    }
    return HEAD_MORPH_GROUPS
      .filter(({ id }) => (counts.get(id) ?? 0) > 0)
      .map((group) => ({ ...group, count: counts.get(group.id) ?? 0 }));
  }, [visibleLibraryControls]);
  const visibleFaceMorphGroups = useMemo(() => {
    const counts = new Map<FaceMorphGroupId, number>();
    for (const control of visibleLibraryControls) {
      if (morphAreaForControl(control) !== 'face') continue;
      const groupId = faceMorphGroupForControl(control);
      counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
    }
    return FACE_MORPH_GROUPS
      .filter(({ id }) => (counts.get(id) ?? 0) > 0)
      .map((group) => ({ ...group, count: counts.get(group.id) ?? 0 }));
  }, [visibleLibraryControls]);
  const visibleEyeMorphGroups = useMemo(() => {
    const counts = new Map<EyeMorphGroupId, number>();
    for (const control of visibleLibraryControls) {
      if (morphAreaForControl(control) !== 'eyes') continue;
      const groupId = eyeMorphGroupForControl(control);
      counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
    }
    return EYE_MORPH_GROUPS
      .filter(({ id }) => (counts.get(id) ?? 0) > 0)
      .map((group) => ({ ...group, count: counts.get(group.id) ?? 0 }));
  }, [visibleLibraryControls]);
  const visibleOtherMorphGroups = useMemo(() => {
    if (!isOtherMorphAreaId(activeBodyArea?.id)) return [];
    const counts = new Map<OtherMorphGroupId, number>();
    for (const control of visibleLibraryControls) {
      if (morphAreaForControl(control) !== activeBodyArea.id) continue;
      const groupId = otherMorphGroupForControl(activeBodyArea.id, control);
      counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
    }
    return OTHER_MORPH_GROUPS[activeBodyArea.id]
      .filter(({ id }) => (counts.get(id) ?? 0) > 0)
      .map((group) => ({ ...group, count: counts.get(group.id) ?? 0 }));
  }, [activeBodyArea?.id, visibleLibraryControls]);
  const displayedLibraryControls = morphMode === 'basic'
    ? visibleLibraryControls.slice(0, 12)
    : visibleLibraryControls;
  const selectedMorph = isBodyMorphRoot || isEarMorphRoot || isHeadMorphRoot || isFaceMorphRoot || isEyeMorphRoot || isOtherMorphRoot
    ? undefined
    : displayedLibraryControls.find(({ id }) => id === selectedMorphId)
      ?? displayedLibraryControls[0];
  const relatedMorphs = useMemo(() => {
    if (!selectedMorph) return [];
    const terms = selectedMorph.label.toLocaleLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 2);
    return displayedLibraryControls
      .filter((control) => control.id !== selectedMorph.id && morphAreaForControl(control) === morphAreaForControl(selectedMorph))
      .map((control) => ({
        control,
        score: control.label.toLocaleLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 2 && terms.includes(term)).length,
      }))
      .sort((a, b) => b.score - a.score || a.control.label.localeCompare(b.control.label))
      .slice(0, 3)
      .map(({ control }) => control);
  }, [displayedLibraryControls, selectedMorph]);
  const activeCategoryHasChanges = bodyAreaControls.some(({ id }) => (morphs[id] ?? 0) !== 0);
  const hasCharacter = Boolean(body);
  const hasActiveProject = project !== null;
  const morphsBaked = body?.morphs_baked === true;
  const serverMorphsNeedAssembly = morphPreviewMode === 'server' && !hasCharacter;
  const morphControlsDisabled = morphsBaked || serverMorphsNeedAssembly;
  const hasNonNeutralMorphs = controls.some(({ id }) => (morphs[id] ?? 0) !== 0);
  const morphPreviewAssetId = body?.source_asset?.asset_id ?? previewModelInfo?.asset_id;
  const morphPreviewAssetHash = body?.source_asset?.glb_sha256 ?? previewModelInfo?.glb_sha256;
  const hasCc5ClientMorphProxy = isCc5FullMorphAsset
    && morphPreviewMode === 'client'
    && Boolean(previewModelInfo?.morph_proxy_sha256 && previewModelInfo.morph_delta_sha256);
  const cc5MorphProxyUrl = hasCc5ClientMorphProxy && morphPreviewAssetId && morphPreviewAssetHash
    ? `${API_BASE}/models/${morphPreviewAssetId}/morph-proxy?sha256=${morphPreviewAssetHash}&proxy_sha256=${previewModelInfo?.morph_proxy_sha256}`
    : null;
  const morphPresetDeltaBaseUrl = hasCc5ClientMorphProxy && morphPreviewAssetId && bodyPresets.length > 0
    ? `${API_BASE}/models/${morphPreviewAssetId}/morph-presets`
    : null;
  const clientMorphControls = useMemo(
    () => morphPresetDeltaBaseUrl
      ? [
        ...controls,
        ...bodyPresets.map(({ id, label }): CC3MorphControlSpec => ({
          id,
          label,
          category: 'Presets',
          minimum: 0,
          maximum: 1,
          positive_shape_key: null,
          negative_shape_key: null,
          isPreset: true,
        })),
      ]
      : controls,
    [bodyPresets, controls, morphPresetDeltaBaseUrl],
  );
  const clientMorphValues = useMemo(
    () => morphPresetDeltaBaseUrl
      ? {
        ...morphs,
        ...Object.fromEntries(bodyPresets.map(({ id, kind }) => [id, activeBodyPresetIds[kind] === id ? 1 : 0])),
      }
      : morphs,
    [activeBodyPresetIds, bodyPresets, morphPresetDeltaBaseUrl, morphs],
  );
  const previewUrl = hasCharacter && project
    ? `${API_BASE}/projects/${project.id}/preview?scene_version=${project.scene_version}`
    : cc5MorphProxyUrl && !morphsBaked
    ? cc5MorphProxyUrl
    : previewModelInfo
    ? previewModelInfo.startup_preview_sha256
      ? `${API_BASE}/models/${previewModelInfo.asset_id}/startup-preview?sha256=${previewModelInfo.glb_sha256}&preview_sha256=${previewModelInfo.startup_preview_sha256}`
      : `${API_BASE}/models/${previewModelInfo.asset_id}/morph-preview?sha256=${previewModelInfo.glb_sha256}&preview_sha256=${previewModelInfo.preview_sha256}`
    : null;
  const morphPreviewUrl = (
    morphPreviewEnabled
    || (hasCc5ClientMorphProxy && hasNonNeutralMorphs)
    || (hasCc5ClientMorphProxy && (activeBodyPresetIds.body !== null || activeBodyPresetIds.head !== null))
  )
    && !morphsBaked && morphPreviewAssetId && morphPreviewAssetHash
    && morphPreviewMode === 'client'
    ? hasCc5ClientMorphProxy
      ? cc5MorphProxyUrl
      : `${API_BASE}/models/${morphPreviewAssetId}/morph-preview?sha256=${morphPreviewAssetHash}&preview_sha256=${previewModelInfo?.preview_sha256 ?? morphPreviewAssetHash}`
    : null;
  const morphDeltaBaseUrl = hasCc5ClientMorphProxy && morphPreviewAssetId
    ? `${API_BASE}/models/${morphPreviewAssetId}/morph-deltas/`
    : null;
  const morphDeltaSha256 = hasCc5ClientMorphProxy ? previewModelInfo?.morph_delta_sha256 ?? null : null;
  const morphPresetDeltaSha256 = morphPresetDeltaBaseUrl
    ? previewModelInfo?.morph_delta_sha256 ?? null
    : null;
  const referencePlan = project?.phases.find((phase) => phase.phase_key === 'reference_plan');
  const reviewPhase = project?.phases.find((phase) => phase.status === 'awaiting_review');
  const morphsDirty = controls.some(({ id }) => (morphs[id] ?? 0) !== (savedMorphs[id] ?? 0));
  const bodyPresetDirty = activeBodyPresetIds.body !== savedBodyPresetIds.body
    || activeBodyPresetIds.head !== savedBodyPresetIds.head;
  const serverMorphPreviewUrl = serverMorphPreview
    && serverMorphPreview.projectId === project?.id
    && serverMorphPreview.componentId === body?.id
    && serverMorphPreview.sceneVersion === project?.scene_version
    && (morphsDirty || bodyPresetDirty)
    ? serverMorphPreview.url
    : null;
  const displayPreviewUrl = serverMorphPreviewUrl ?? previewUrl;
  const selectedDraftEye = project?.draft_appearance?.eye_asset_id
    ? eyeAssets.find(({ id }) => id === project.draft_appearance.eye_asset_id)
    : null;
  const eyePreviewUrl = selectedDraftEye
    ? `${API_BASE}/assets/eyes/${encodeURIComponent(selectedDraftEye.id)}/preview?sha256=${encodeURIComponent(selectedDraftEye.generated_sha256)}`
    : null;
  const selectedDraftSkin = project?.draft_appearance?.skin_asset_id
    ? skinAssets.find(({ id }) => id === project.draft_appearance.skin_asset_id)
    : null;
  const skinPreview = useMemo(() => selectedDraftSkin
    && selectedDraftSkin.compatible_asset_ids.includes(project?.base_model_asset_id ?? 'character_cc3_morphs_v1')
    ? {
      materials: Object.fromEntries(Object.entries(selectedDraftSkin.materials).map(([materialName, hashes]) => [
        materialName,
        {
          diffuse: `${API_BASE}/assets/skins/${encodeURIComponent(selectedDraftSkin.id)}/textures/${encodeURIComponent(materialName)}/diffuse?sha256=${encodeURIComponent(hashes.diffuse)}`,
          normal: `${API_BASE}/assets/skins/${encodeURIComponent(selectedDraftSkin.id)}/textures/${encodeURIComponent(materialName)}/normal?sha256=${encodeURIComponent(hashes.normal)}`,
        },
      ])),
    }
    : null, [project?.base_model_asset_id, selectedDraftSkin]);
  const skinPaintStrokes = skinPaintDraftStrokes;
  const savedSkinDefinition = normalizeSkinDefinition(project?.draft_skin_definition);
  const skinDefinitionDirty = Boolean(project)
    && JSON.stringify(skinDefinitionDraft) !== JSON.stringify(savedSkinDefinition);
  const skinDefinitionPreview = useMemo(
    () => normalizeSkinDefinition(skinInterpretation?.preview ?? skinDefinitionDraft),
    [skinDefinitionDraft, skinInterpretation?.preview],
  );
  const visibleParts = useMemo(
    () => Object.fromEntries(Object.entries(parts).map(([key, part]) => [key, part.visible])) as Record<ModelPartKey, boolean>,
    [parts],
  );
  const otherSavedProjects = savedProjects.filter((item) => item.id !== project?.id);
  const selectedBaseModelInfo = availableBaseModels.find((model) => model.asset_id === selectedBaseModel) ?? null;
  const orderedBaseModels = useMemo(() => [...availableBaseModels].sort((left, right) => {
    const rank = (assetId: ApiAssetId) => assetId === BASIC_CHARACTER_ASSET_ID
      ? 0
      : assetId === ADVANCED_CHARACTER_ASSET_ID ? 1 : 2;
    return rank(left.asset_id) - rank(right.asset_id);
  }), [availableBaseModels]);
  const activeModelName = projectAssetId
    ? availableBaseModels.find((model) => model.asset_id === projectAssetId)?.name
      ?? (projectAssetId === 'character_cc3_male_morphs_v1' ? 'CC3 Base Male' : 'CC3 Base Female')
    : 'CC3 Character';
  useEffect(() => {
    const requestId = ++morphPreviewRequestId.current;
    morphPreviewAbortController.current?.abort();
    if (morphPreviewRetryTimeout.current !== null) {
      window.clearTimeout(morphPreviewRetryTimeout.current);
      morphPreviewRetryTimeout.current = null;
    }

    if (
      !project
      || !body
      || !morphsDirty
      || morphsBaked
      || morphPreviewMode !== 'server'
      || !body.source_asset?.asset_id
    ) {
      if (morphPreviewObjectUrl.current) {
        URL.revokeObjectURL(morphPreviewObjectUrl.current);
        morphPreviewObjectUrl.current = null;
      }
      setServerMorphPreview(null);
      setServerMorphPreviewStatus('idle');
      setServerMorphPreviewError('');
      return;
    }

    const controller = new AbortController();
    morphPreviewAbortController.current = controller;
    setServerMorphPreviewStatus('updating');
    setServerMorphPreviewError('');
    const timeout = window.setTimeout(async () => {
      try {
        const response = await apiFetch(`/projects/${project.id}/morph-preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ morphs }),
          signal: controller.signal,
        });
        if (response.status === 429) {
          if (requestId === morphPreviewRequestId.current) {
            morphPreviewRetryTimeout.current = window.setTimeout(() => {
              morphPreviewRetryTimeout.current = null;
              setMorphPreviewRetry((attempt) => attempt + 1);
            }, 1000);
          }
          return;
        }
        if (!response.ok) {
          const responseBody = await response.json().catch(() => null);
          const detail = responseBody && typeof responseBody === 'object' && 'detail' in responseBody
            ? responseBody.detail
            : null;
          const message = detail && typeof detail === 'object' && 'message' in detail
            ? String(detail.message)
            : 'Could not update the character preview.';
          throw new Error(message);
        }

        const preview = await response.blob();
        if (requestId !== morphPreviewRequestId.current) return;
        if (preview.size === 0 || !response.headers.get('content-type')?.includes('model/gltf-binary')) {
          throw new Error('Blender returned an invalid character preview.');
        }

        const url = URL.createObjectURL(preview);
        const previousUrl = morphPreviewObjectUrl.current;
        morphPreviewObjectUrl.current = url;
        setServerMorphPreview({
          url,
          projectId: project.id,
          componentId: body.id,
          sceneVersion: project.scene_version,
        });
        setServerMorphPreviewStatus('idle');
        if (previousUrl) URL.revokeObjectURL(previousUrl);
      } catch (error) {
        if (controller.signal.aborted || requestId !== morphPreviewRequestId.current) return;
        setServerMorphPreviewError(error instanceof Error ? error.message : 'Could not update the character preview.');
        setServerMorphPreviewStatus('error');
      }
    }, SERVER_MORPH_PREVIEW_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
      if (morphPreviewRetryTimeout.current !== null) {
        window.clearTimeout(morphPreviewRetryTimeout.current);
        morphPreviewRetryTimeout.current = null;
      }
    };
  }, [
    body,
    morphPreviewMode,
    morphPreviewRetry,
    morphs,
    morphsBaked,
    morphsDirty,
    project,
  ]);
  useEffect(() => {
    if (!project || hasCharacter || controls.length === 0 || !morphsDirty || morphInteractionActive) return;
    const projectId = project.id;
    const revision = project.draft_revision ?? 0;
    const values = Object.fromEntries(controls.map(({ id }) => [id, morphs[id] ?? 0]));
    setDraftSaveStatus('saving');
    setDraftSaveError('');
    const timeout = window.setTimeout(async () => {
      if (draftSaveInFlight.current) {
        setDraftSaveRetry((attempt) => attempt + 1);
        return;
      }
      draftSaveInFlight.current = true;
      try {
        const saved = await requestJson<ApiProject>(`/projects/${projectId}/draft-morphs`, {
          method: 'PATCH',
          body: JSON.stringify({
            expected_draft_revision: revision,
            morphs: values,
          }),
        });
        setProject((current) => current?.id === projectId
          ? { ...current, draft_morphs: saved.draft_morphs, draft_revision: saved.draft_revision }
          : current);
        if (controls.every(({ id }) => (latestMorphs.current[id] ?? 0) === values[id])) {
          setDraftSaveStatus('saved');
        }
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 409) {
          const current = await requestJson<ApiProject>(`/projects/${projectId}`);
          setProject((loaded) => loaded?.id === projectId
            ? { ...loaded, draft_morphs: current.draft_morphs, draft_revision: current.draft_revision }
            : loaded);
          setDraftSaveStatus('saving');
          return;
        }
        setDraftSaveStatus('error');
        setDraftSaveError(error instanceof Error ? error.message : 'Draft slider values could not be saved.');
      } finally {
        draftSaveInFlight.current = false;
      }
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [
    controls,
    draftSaveRetry,
    hasCharacter,
    morphs,
    morphInteractionActive,
    morphsDirty,
    project?.draft_revision,
    project?.id,
  ]);
  useEffect(() => () => {
    morphPreviewAbortController.current?.abort();
    if (morphPreviewRetryTimeout.current !== null) {
      window.clearTimeout(morphPreviewRetryTimeout.current);
    }
    if (morphPreviewObjectUrl.current) URL.revokeObjectURL(morphPreviewObjectUrl.current);
  }, []);
  const recordMorphEdit = useCallback(() => {
    if (!project || morphControlsDisabled) return;
    if (morphInteractionRef.current) {
      if (morphGestureHistoryCaptured.current) return;
      morphGestureHistoryCaptured.current = true;
    }
    const nextHistory = pushMorphDraftHistory(morphHistoryRef.current, latestMorphs.current);
    morphHistoryRef.current = nextHistory;
    setMorphHistory(nextHistory);
  }, [morphControlsDisabled, project?.id]);
  const beginMorphInteraction = useCallback(() => {
    if (!morphInteractionRef.current) morphGestureHistoryCaptured.current = false;
    morphInteractionRef.current = true;
    setMorphInteractionActive(true);
  }, []);
  const endMorphInteraction = useCallback(() => {
    morphInteractionRef.current = false;
    morphGestureHistoryCaptured.current = false;
    setMorphInteractionActive(false);
  }, []);
  const undoMorphEdit = useCallback(() => {
    if (!project || morphControlsDisabled) return;
    const result = undoMorphDraftHistory(morphHistoryRef.current, latestMorphs.current);
    if (!result) return;
    morphHistoryRef.current = result.history;
    setMorphHistory(result.history);
    setMorphs(result.values);
    setMorphPreviewEnabled(true);
    endMorphInteraction();
  }, [endMorphInteraction, morphControlsDisabled, project?.id]);
  const redoMorphEdit = useCallback(() => {
    if (!project || morphControlsDisabled) return;
    const result = redoMorphDraftHistory(morphHistoryRef.current, latestMorphs.current);
    if (!result) return;
    morphHistoryRef.current = result.history;
    setMorphHistory(result.history);
    setMorphs(result.values);
    setMorphPreviewEnabled(true);
    endMorphInteraction();
  }, [endMorphInteraction, morphControlsDisabled, project?.id]);
  useEffect(() => {
    function handleHistoryShortcut(event: KeyboardEvent) {
      const target = event.target;
      const editableTarget = target instanceof HTMLElement
        && (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"]') !== null);
      const action = getMorphHistoryShortcut(event, editableTarget);
      if (!action || !project || morphControlsDisabled || running) return;
      if (action === 'undo' && morphHistory.past.length === 0) return;
      if (action === 'redo' && morphHistory.future.length === 0) return;
      event.preventDefault();
      if (action === 'undo') undoMorphEdit();
      else redoMorphEdit();
    }

    window.addEventListener('keydown', handleHistoryShortcut);
    return () => window.removeEventListener('keydown', handleHistoryShortcut);
  }, [
    morphControlsDisabled,
    morphHistory.future.length,
    morphHistory.past.length,
    project,
    redoMorphEdit,
    running,
    undoMorphEdit,
  ]);
  const updateMorph = useCallback((id: CC3MorphControl, value: number) => {
    if (morphControlsDisabled) return;
    if ((latestMorphs.current[id] ?? 0) === value) return;
    recordMorphEdit();
    setMorphs((current) => ({ ...current, [id]: value }));
    setRecentMorphIds((current) => current[0] === id
      ? current
      : [id, ...current.filter((recentId) => recentId !== id)].slice(0, 12));
    setMorphPreviewEnabled(true);
  }, [morphControlsDisabled, project?.id, recordMorphEdit]);
  useEffect(() => {
    if (!morphAreas.some(({ id }) => id === selectedBodyArea)) {
      setSelectedBodyArea(morphAreas.find(({ id }) => id === 'body')?.id ?? morphAreas[0]?.id ?? '');
    }
  }, [morphAreas, selectedBodyArea]);

  const toggleMorphFavorite = useCallback((id: CC3MorphControl) => {
    setFavoriteMorphIds((current) => current.includes(id)
      ? current.filter((favoriteId) => favoriteId !== id)
      : [...current, id]);
  }, []);
  const selectMorphControl = (control: MorphControlIdentity) => {
    if (morphSearch.trim()) {
      const area = morphAreaForControl(control);
      setSelectedBodyArea(area);
      setSelectedBodyMorphGroupId(area === 'body' ? bodyMorphGroupForControl(control) : null);
      setSelectedEarMorphGroupId(area === 'ears' ? earMorphGroupForControl(control) : null);
      setSelectedHeadMorphGroupId(area === 'head' ? headMorphGroupForControl(control) : null);
      setSelectedFaceMorphGroupId(area === 'face' ? faceMorphGroupForControl(control) : null);
      setSelectedEyeMorphGroupId(area === 'eyes' ? eyeMorphGroupForControl(control) : null);
      setSelectedOtherMorphGroupId(isOtherMorphAreaId(area) ? otherMorphGroupForControl(area, control) : null);
      setMorphSearch('');
    }
    setSelectedMorphId(control.id);
  };
  const resetMorphs = () => {
    if (!controls.some(({ id }) => (morphs[id] ?? 0) !== 0)) return;
    recordMorphEdit();
    setMorphs(Object.fromEntries(controls.map(({ id }) => [id, 0])));
  };
  const resetMorphArea = () => {
    if (!activeBodyArea) return;
    if (!bodyAreaControls.some(({ id }) => (morphs[id] ?? 0) !== 0)) return;
    recordMorphEdit();
    setMorphs((current) => {
      const next = { ...current };
      for (const { id } of bodyAreaControls) next[id] = 0;
      return next;
    });
  };
  const resetSelectedMorph = () => {
    if (selectedMorph) updateMorph(selectedMorph.id, 0);
  };
  const applyElvenEarPresetToDraft = () => {
    if (!elvenEarPresetAvailable || morphControlsDisabled || running) return;
    const nextMorphs = applyElvenEarPreset(morphs);
    if (controls.some(({ id }) => (morphs[id] ?? 0) !== (nextMorphs[id] ?? 0))) {
      recordMorphEdit();
    }
    setMorphs(nextMorphs);
    setSelectedBodyArea('ears');
    setSelectedBodyMorphGroupId(null);
    setSelectedEarMorphGroupId('tip');
    setMorphSearch('');
    setMorphLibraryView('all');
    setMorphTypeFilter('all');
    setSelectedMorphId('2019-08-25-17-39-45_ear pointed');
    setRecentMorphIds((current) => [
      ...Object.keys(ELVEN_EAR_PRESET_MORPHS).filter((id) => !current.includes(id)),
      ...current,
    ].slice(0, 12));
    setMorphPreviewEnabled(true);
  };
  useEffect(() => {
    if (!newProjectOpen) return;
    if (newProjectStep === 'character-setup') projectNameInput.current?.focus({ preventScroll: true });
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !running) setNewProjectOpen(false);
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [newProjectOpen, newProjectStep, running]);
  useEffect(() => {
    const guidance = activeGuidance;
    if (!guidance) return;

    let frame = 0;
    let retryTimer = 0;
    let attempts = 0;
    const positionTarget = () => {
      const target = document.querySelector<HTMLElement>(
        `[data-ai-guide-target="${CSS.escape(guidance.target_id)}"]`,
      );
      if (!target) {
        setGuidancePosition(null);
        return false;
      }

      const bounds = target.getBoundingClientRect();
      const tooltipWidth = Math.min(340, window.innerWidth - 24);
      const tooltipHeight = Math.min(260, window.innerHeight - 24);
      const placement = bounds.bottom + 12 + tooltipHeight <= window.innerHeight ? 'below' : 'above';
      const left = Math.min(
        Math.max(12, bounds.left + bounds.width / 2 - tooltipWidth / 2),
        Math.max(12, window.innerWidth - tooltipWidth - 12),
      );
      const top = placement === 'below'
        ? bounds.bottom + 12
        : Math.max(12, bounds.top - tooltipHeight - 12);
      setGuidancePosition({
        left,
        top,
        placement,
        arrowLeft: Math.min(
          Math.max(20, bounds.left + bounds.width / 2 - left),
          tooltipWidth - 20,
        ),
      });
      return true;
    };

    const schedulePosition = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (!positionTarget()) {
          window.clearTimeout(retryTimer);
          if (attempts++ < 15) retryTimer = window.setTimeout(schedulePosition, 250);
        }
      });
    };
    const initialTimer = window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>(
        `[data-ai-guide-target="${CSS.escape(guidance.target_id)}"]`,
      );
      target?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      schedulePosition();
    }, 60);
    window.addEventListener('resize', schedulePosition);
    window.addEventListener('scroll', schedulePosition, true);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearTimeout(retryTimer);
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedulePosition);
      window.removeEventListener('scroll', schedulePosition, true);
    };
  }, [activeGuidance, controls, customizationCategory, eyeAssets, morphSearch, selectedBodyArea, selectedMorphId, skinAssets, studioSection]);
  useEffect(() => {
    if (
      !newProjectOpen
      || newProjectStep !== 'character-setup'
      || selectedBaseModel !== null
      || availableBaseModels.length === 0
    ) return;
    const defaultModel = availableBaseModels.find(({ asset_id }) => asset_id === BASIC_CHARACTER_ASSET_ID)
      ?? availableBaseModels[0];
    setSelectedBaseModel(defaultModel.asset_id);
  }, [availableBaseModels, newProjectOpen, newProjectStep, selectedBaseModel]);

  useEffect(() => {
    function closeSavedProjectsOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setSavedProjectsOpen(false);
    }
    window.addEventListener('keydown', closeSavedProjectsOnEscape);
    return () => window.removeEventListener('keydown', closeSavedProjectsOnEscape);
  }, []);

  function applyProject(next: ApiProject, resetCamera = true) {
    const changingProject = activeProjectId.current !== next.id;
    const changingSkin = project?.draft_appearance?.skin_asset_id !== next.draft_appearance?.skin_asset_id;
    const preserveLocalSkinDraft = !changingProject
      && project?.draft_skin_revision === next.draft_skin_revision
      && JSON.stringify(skinDefinitionDraft) !== JSON.stringify(project?.draft_skin_definition ?? DEFAULT_SKIN_DEFINITION);
    const assetComponent = next.components.find((item) => item.source_asset?.asset_id);
    const selectedAssetId = next.base_model_asset_id
      ?? assetComponent?.source_asset?.asset_id;
    if (selectedAssetId) setSelectedBaseModel(selectedAssetId);
    const savedMorphs = assetComponent?.cc3_morphs ?? next.draft_morphs ?? {};
    const savedPresetIds = normalizeCharacterPresetSelection(
      bodyPresets,
      assetComponent?.cc3_preset_id ?? next.draft_appearance?.body_preset_id,
      assetComponent?.cc3_head_preset_id ?? next.draft_appearance?.head_preset_id,
    );
    const preserveLocalDraft = activeProjectId.current === next.id
      && !assetComponent
      && (
        controls.some(({ id }) => (latestMorphs.current[id] ?? 0) !== (savedMorphs[id] ?? 0))
        || activeBodyPresetIds.body !== savedPresetIds.body
        || activeBodyPresetIds.head !== savedPresetIds.head
      );
    const skinDefinition = normalizeSkinDefinition(next.draft_skin_definition);
    setProject({ ...next, draft_skin_definition: skinDefinition });
    const nextPaintStrokes = next.draft_skin_paint_strokes ?? [];
    skinPaintDraftStrokesRef.current = nextPaintStrokes;
    setSkinPaintDraftStrokes(nextPaintStrokes);
    if (!preserveLocalSkinDraft) setSkinDefinitionDraft(skinDefinition);
    if (changingProject) {
      setSkinPrompt('');
      setReferenceActionError('');
    }
    if (changingProject || changingSkin) {
      setSkinInterpretation(null);
      setSkinInterpretationError('');
    }
    if (changingProject || assetComponent) setSkinPaintEnabled(false);
    setProjectName(next.name);
    setActiveBodyPresetIds(preserveLocalDraft ? activeBodyPresetIds : savedPresetIds);
    if (!preserveLocalDraft) {
      setMorphs(Object.fromEntries(Object.entries(savedMorphs).map(([id, value]) => [id, value ?? 0])));
      setDraftSaveStatus('saved');
      setDraftSaveError('');
    }
    setParts(defaultParts);
    setSelectedPart(assetComponent ? 'body' : null);
    setMorphPreviewEnabled((enabled) => preserveLocalDraft
      ? enabled || Object.values(latestMorphs.current).some((value) => value !== 0)
        || activeBodyPresetIds.body !== null || activeBodyPresetIds.head !== null
      : Object.values(savedMorphs).some((value) => value !== 0)
        || savedPresetIds.body !== null || savedPresetIds.head !== null);
    if (resetCamera) setCameraKey((key) => key + 1);
  }

  useEffect(() => {
    if (authLoading || !account) {
      setInitialDataLoading(false);
      setSavedProjectsLoading(false);
      return;
    }
    let active = true;
    let remainingRequests = 3;
    const finishRequest = () => {
      remainingRequests -= 1;
      if (active && remainingRequests === 0) setInitialDataLoading(false);
    };
    setInitialDataLoading(true);
    setSavedProjectsLoading(true);
    setSavedProjectsError('');
    setBaseModelsLoading(true);
    setBaseModelsError('');
    requestJson<ApiHealth>('/health').then((health) => {
      if (!active) return;
      setApiReady(true);
      setBlenderAvailable(health.blender_available);
      setBlenderError(health.blender_error ?? '');
      setApiError('');
    }).catch((error: unknown) => {
      if (!active) return;
      setApiError(error instanceof Error ? error.message : 'The local Blender API is unavailable.');
      setApiReady(false);
      setBlenderAvailable(false);
    }).finally(finishRequest);
    requestJson<ApiProjectSummary[]>('/projects/summary').then((projects) => {
      if (!active) return;
      setSavedProjects(projects);
      setSavedProjectsError('');
      setSavedProjectsLoading(false);
    }).catch((error: unknown) => {
      if (!active) return;
      setSavedProjectsError(error instanceof Error ? error.message : 'Saved projects could not be loaded.');
      setSavedProjectsLoading(false);
    }).finally(finishRequest);
    requestJson<ApiBaseModel[]>('/models').then((models) => {
      if (!active) return;
      const available = models.filter((model) => model.category === 'character');
      setAvailableBaseModels(available);
      setSelectedBaseModel((current) => current && available.some((model) => model.asset_id === current)
        ? current
        : null);
      setBaseModelsError('');
      setBaseModelsLoading(false);
    }).catch((error: unknown) => {
      if (!active) return;
      setBaseModelsError(error instanceof Error ? error.message : 'Available base models could not be loaded.');
      setBaseModelsLoading(false);
    }).finally(finishRequest);
    return () => { active = false; };
  }, [account?.id, authLoading, initialDataRetry]);
  useEffect(() => {
    if (!project) return;
    let active = true;
    setEyeAssetsLoading(true);
    setEyeAssetsError('');
    requestJson<EyeAsset[]>('/assets/eyes').then((assets) => {
      if (!active) return;
      setEyeAssets(assets);
      setEyeAssetsError('');
      setEyeAssetsLoading(false);
    }).catch((error: unknown) => {
      if (!active) return;
      setEyeAssetsError(error instanceof Error ? error.message : 'Eye assets could not be loaded.');
      setEyeAssetsLoading(false);
    });
    return () => { active = false; };
  }, [eyeAssetsRetry, project?.id]);
  useEffect(() => {
    if (!project) return;
    let active = true;
    setSkinAssetsLoading(true);
    setSkinAssetsError('');
    requestJson<SkinAsset[]>('/assets/skins').then((assets) => {
      if (!active) return;
      setSkinAssets(assets);
      setSkinAssetsError('');
      setSkinAssetsLoading(false);
    }).catch((error: unknown) => {
      if (!active) return;
      setSkinAssetsError(error instanceof Error ? error.message : 'Skin assets could not be loaded.');
      setSkinAssetsLoading(false);
    });
    return () => { active = false; };
  }, [project?.id, skinAssetsRetry]);
  useEffect(() => {
    if (!hasActiveProject && !selectedBaseModel) {
      setMorphControlsLoading(false);
      setMorphControlsError('');
      return;
    }
    if (!availableBaseModels.some((model) => model.asset_id === morphControlsAssetId)) {
      if (!baseModelsLoading) {
        setMorphControlsLoading(false);
        setMorphControlsError(baseModelsError || 'Character morph controls are unavailable for this model.');
      }
      return;
    }
    if (body?.source_asset?.morph_control_specs?.length) {
      setMorphControlsLoading(false);
      setMorphControlsError('');
      return;
    }
    if (morphControlsByAsset[morphControlsAssetId]) {
      setMorphControlsLoading(false);
      setMorphControlsError('');
      return;
    }

    let active = true;
    setMorphControlsLoading(true);
    setMorphControlsError('');
    requestJson<CC3MorphControlSpec[]>(`/models/${morphControlsAssetId}/morph-controls`).then((assetControls) => {
      if (!active) return;
      if (assetControls.length === 0) {
        throw new Error('No manifest-backed character controls were returned for this model.');
      }
      setMorphControlsByAsset((current) => ({ ...current, [morphControlsAssetId]: assetControls }));
      setMorphControlsLoading(false);
    }).catch((error: unknown) => {
      if (!active) return;
      setMorphControlsError(error instanceof Error ? error.message : 'Character morph controls could not be loaded.');
      setMorphControlsLoading(false);
    });
    return () => { active = false; };
  }, [availableBaseModels, baseModelsError, baseModelsLoading, body?.source_asset?.morph_control_specs, hasActiveProject, morphControlsAssetId, morphControlsByAsset, morphControlsRetry, selectedBaseModel]);

  function retryMorphControls() {
    if (!availableBaseModels.some(({ asset_id }) => asset_id === morphControlsAssetId)) {
      setInitialDataRetry((retry) => retry + 1);
      return;
    }
    setMorphControlsByAsset((current) => {
      const next = { ...current };
      delete next[morphControlsAssetId];
      return next;
    });
    setMorphControlsRetry((retry) => retry + 1);
  }

  function openNewProject() {
    if (skinDefinitionDirty || skinDefinitionSaving) return;
    setSavedProjectsOpen(false);
    setProjectCreationError('');
    setSelectedBaseModel(null);
    setNewProjectStep('character-setup');
    setNewProjectOpen(true);
  }

  async function sendProjectChatMessage(activeProject: ApiProject, text: string, selectedComponentId: string | null): Promise<ChatEntry> {
    const response = await requestJson<{
      assistant_message: string;
      assistant_proposal?: AssistantProposal | null;
      guidance?: AssistantGuidance | null;
      interaction_warning?: string | null;
      project: ApiProject;
    }>(`/projects/${activeProject.id}/chat`, {
      method: 'POST',
      body: JSON.stringify({ message: text, selected_component_id: selectedComponentId }),
    });
    applyProject(response.project);
    setSavedProjects((projects) => [summarizeProject(response.project), ...projects.filter((item) => item.id !== response.project.id)]);
    if (response.guidance) showAssistantGuidance(response.guidance);
    return {
      role: 'assistant',
      text: response.assistant_message,
      proposal: response.assistant_proposal ?? undefined,
      guidance: response.guidance ?? undefined,
      interactionWarning: response.interaction_warning ?? undefined,
    };
  }

  async function createProjectForAsset(assetId: ApiAssetId, name: string) {
    const initialPrompt = message.trim();
    const created = await requestJson<ApiProject>('/projects', {
      method: 'POST',
      body: JSON.stringify({
        name: name.trim() || 'Untitled Character',
        target_profile: 'general_purpose',
        base_model_asset_id: assetId,
      }),
    });
    const planned = await requestJson<ApiProject>(`/projects/${created.id}/plan`, { method: 'POST' });
    setMorphPreviewEnabled(false);
    applyProject(planned);
    setProjectName(planned.name);
    setSelectedBaseModel(assetId);
    setSavedProjects((projects) => [summarizeProject(planned), ...projects.filter((item) => item.id !== planned.id)]);
    const welcomeMessage: ChatEntry = {
      role: 'assistant',
      text: `Draft project created for ${availableBaseModels.find((model) => model.asset_id === assetId)?.name ?? 'the selected character'}. Preview and adjust sliders now; approve the plan and assemble in Blender when you are ready.`,
    };
    if (initialPrompt) {
      const userMessage: ChatEntry = { role: 'user', text: initialPrompt };
      setChat([welcomeMessage, userMessage]);
      try {
        const assistantMessage = await sendProjectChatMessage(planned, initialPrompt, null);
        setMessage('');
        setChat([welcomeMessage, userMessage, assistantMessage]);
      } catch (error) {
        setChat([welcomeMessage, userMessage, {
          role: 'assistant',
          text: `Request failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        }]);
      }
    } else {
      setChat([welcomeMessage]);
    }
    setStudioSection('models');
    setNewProjectOpen(false);
    setProjectCreationError('');
  }

  async function createProject() {
    if (!selectedBaseModelInfo) {
      throw new Error('Choose an available character base model before creating the project.');
    }
    await createProjectForAsset(selectedBaseModelInfo.asset_id, projectName);
  }

  async function runAction(action: () => Promise<void>) {
    setRunning(true);
    try {
      await action();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'unknown error';
      if (newProjectOpen) setProjectCreationError(errorMessage);
      setChat((items) => [...items, {
        role: 'assistant',
        text: `Action failed: ${errorMessage}`,
      }]);
    } finally {
      setRunning(false);
    }
  }

  function acceptAccountSession(session: AuthSession) {
    setCsrfToken(session.csrf_token);
    setAccount(session.account);
    setAuthError('');
  }

  async function signOut() {
    await requestJson<void>('/auth/logout', { method: 'POST' });
    setCsrfToken(null);
    setAccount(null);
    setProject(null);
    setSavedProjects([]);
    setSavedProjectsError('');
    setApiReady(false);
    setChat([]);
  }

  function returnToWelcome() {
    if (running || draftSaveStatus !== 'saved' || morphsDirty || bodyPresetDirty || skinDefinitionDirty || skinDefinitionSaving) return;
    setProject(null);
    setSelectedBaseModel(null);
    setSavedProjectsOpen(false);
    setChatOpen(true);
    setStudioSection('models');
  }

  async function openProject(id: string) {
    if (skinDefinitionDirty || skinDefinitionSaving) {
      throw new Error('Save skin property changes before opening another project.');
    }
    if (!id) return;
    const loaded = await requestJson<ApiProject>(`/projects/${id}`);
    applyProject(loaded);
    setMorphPreviewEnabled(false);
    setChat(loaded.messages?.map((item) => ({ role: item.role, text: item.content })) ?? []);
    setSavedProjectsOpen(false);
  }

  async function deleteProject(id: string, name: string) {
    if (!window.confirm(`Permanently delete "${name}" and its reference images, checkpoints, and scene files? This cannot be undone.`)) return;
    await requestJson<void>(`/projects/${id}`, { method: 'DELETE' });
    setSavedProjects((projects) => projects.filter((item) => item.id !== id));
    if (project?.id === id) openNewProject();
    setSavedProjectsOpen(false);
  }

  async function approvePhase() {
    if (!project || !reviewPhase) return;
    const updated = await requestJson<ApiProject>(`/projects/${project.id}/phases/${reviewPhase.id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ expected_scene_version: project.scene_version }),
    });
    applyProject(updated);
    setChat((items) => [...items, { role: 'assistant', text: `${reviewPhase.title} approved.` }]);
  }

  async function buildEditableCharacter(projectToImport = project) {
    if (!projectToImport) throw new Error('Create a project first.');
    const assetId = projectToImport.base_model_asset_id ?? selectedBaseModel;
    if (!assetId) throw new Error('The selected base model is no longer available.');
    setImportingCharacter(true);
    try {
      const result = await requestJson<{ project: ApiProject }>(`/projects/${projectToImport.id}/modeling-tools`, {
        method: 'POST',
        body: JSON.stringify({
          tool_name: 'import_base_model',
          operation_id: crypto.randomUUID(),
          expected_scene_version: projectToImport.scene_version,
          scope_component_ids: [],
          dependency_component_ids: [],
          arguments: {
            asset_id: assetId,
            preset_ids: projectToImport.draft_appearance
              ? normalizeCharacterPresetSelection(
                bodyPresets,
                projectToImport.draft_appearance.body_preset_id,
                projectToImport.draft_appearance.head_preset_id,
              )
              : activeBodyPresetIds,
            skin_asset_id: projectToImport.draft_appearance?.skin_asset_id ?? null,
            skin_paint_strokes: projectToImport.draft_skin_paint_strokes ?? [],
            ...(projectToImport.draft_appearance?.skin_asset_id
              ? { skin_definition: projectToImport.draft_skin_definition }
              : {}),
          },
        }),
      });
      applyProject(result.project);
      setSavedProjects((projects) => [summarizeProject(result.project), ...projects.filter((item) => item.id !== result.project.id)]);
      setChat((items) => [...items, { role: 'assistant', text: `Saved and compiled the ${availableBaseModels.find((model) => model.asset_id === assetId)?.name ?? 'character'} in Blender, including the tracked morph, preset, eye, and skin choices.` }]);
    } finally {
      setImportingCharacter(false);
    }
  }

  async function saveMorphs() {
    if (!project || !body) throw new Error('Import the CC3 morph character before saving controls.');
    if (morphsBaked) throw new Error('Restore the pre-bake checkpoint before saving morph controls again.');
    const assetId = body.source_asset?.asset_id;
    if (!assetId) throw new Error('The imported model does not identify its source asset.');
    const result = await requestJson<{ project: ApiProject }>(`/projects/${project.id}/modeling-tools`, {
      method: 'POST',
      body: JSON.stringify({
        tool_name: bodyPresetDirty ? 'apply_cc3_body_preset' : 'apply_cc3_morph_controls',
        operation_id: crypto.randomUUID(),
        expected_scene_version: project.scene_version,
        scope_component_ids: [body.id],
        dependency_component_ids: [],
        arguments: {
          component_id: body.id,
          asset_id: assetId,
          morphs,
          ...(bodyPresetDirty ? { preset_ids: activeBodyPresetIds } : {}),
        },
      }),
    });
    applyProject(result.project);
    setChat((items) => [...items, {
      role: 'assistant',
      text: bodyPresetDirty
        ? 'The character preset and current morph values were saved to the Blender project.'
        : 'Morph controls saved to the Blender project.',
    }]);
  }

  async function updateDraftAppearance(
    appearance: { eye_asset_id: string | null; body_preset_id: string | null; head_preset_id?: string | null; skin_asset_id: string | null },
    paintStrokes?: SkinPaintStroke[],
  ) {
    if (appearanceSaveInProgress.current) throw new Error('Wait for the current appearance change to finish saving.');
    appearanceSaveInProgress.current = true;
    setAppearanceSaving(true);
    try {
      if (!project) throw new Error('Create a project first.');
      if (hasCharacter) throw new Error('Compiled projects cannot change draft appearance. Start a new draft to preview different assets.');
      const saved = await requestJson<ApiProject>(`/projects/${project.id}/draft-appearance`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...appearance,
          ...(paintStrokes === undefined ? {} : { skin_paint_strokes: paintStrokes }),
        }),
      });
      applyProject(saved, false);
      setSavedProjects((projects) => [summarizeProject(saved), ...projects.filter((item) => item.id !== saved.id)]);
    } finally {
      appearanceSaveInProgress.current = false;
      setAppearanceSaving(false);
    }
  }

  async function selectDraftEye(assetId: string | null) {
    const appearance = project?.draft_appearance ?? {
      eye_asset_id: null,
      body_preset_id: activeBodyPresetIds.body,
      head_preset_id: activeBodyPresetIds.head,
      skin_asset_id: null,
    };
    await updateDraftAppearance({ ...appearance, eye_asset_id: assetId });
  }

  function updateSkinDefinition(patch: SkinDefinitionPatch) {
    setSkinDefinitionDraft((current) => applySkinDefinitionPatch(current, patch));
    setSkinInterpretation(null);
    setSkinInterpretationError('');
  }

  async function saveSkinDefinition(definition: SkinDefinition) {
    if (!project || !selectedDraftSkin) throw new Error('Select a skin asset before editing its properties.');
    if (hasCharacter) throw new Error('Skin properties can only be changed before compilation.');
    if (skinDefinitionSaving) throw new Error('Wait for the current skin update to finish saving.');
    if (JSON.stringify(definition) === JSON.stringify(project.draft_skin_definition)) {
      setSkinDefinitionDraft(definition);
      return;
    }
    setSkinDefinitionSaving(true);
    try {
      const saved = await requestJson<ApiProject>(`/projects/${project.id}/draft-skin`, {
        method: 'PATCH',
        body: JSON.stringify({
          expected_draft_skin_revision: project.draft_skin_revision,
          skin_definition: definition,
        }),
      });
      applyProject(saved, false);
      setSavedProjects((projects) => [summarizeProject(saved), ...projects.filter((item) => item.id !== saved.id)]);
      setSkinInterpretation(null);
    } finally {
      setSkinDefinitionSaving(false);
    }
  }

  async function interpretSkinPrompt() {
    if (!project || !selectedDraftSkin) throw new Error('Select a skin asset before asking for a skin interpretation.');
    setSkinInterpretationLoading(true);
    setSkinInterpretationError('');
    setSkinInterpretation(null);
    try {
      const interpretation = await requestJson<SkinInterpretation>(`/projects/${project.id}/skin/interpret`, {
        method: 'POST',
        body: JSON.stringify({ prompt: skinPrompt }),
      });
      setSkinInterpretation(interpretation);
    } catch (error) {
      setSkinInterpretationError(error instanceof Error ? error.message : 'The skin request could not be interpreted.');
      throw error;
    } finally {
      setSkinInterpretationLoading(false);
    }
  }

  async function applySkinInterpretation() {
    if (!skinInterpretation) throw new Error('Ask for a skin interpretation before applying it.');
    await saveSkinDefinition(skinInterpretation.preview);
  }

  async function selectDraftPreset(kind: CharacterPresetKind, presetId: string | null) {
    const appearance = project?.draft_appearance ?? {
      eye_asset_id: null,
      body_preset_id: activeBodyPresetIds.body,
      head_preset_id: activeBodyPresetIds.head,
      skin_asset_id: null,
    };
    const selected = selectCharacterPreset(activeBodyPresetIds, kind, presetId);
    await updateDraftAppearance({
      ...appearance,
      body_preset_id: selected.body,
      head_preset_id: selected.head,
    });
    setActiveBodyPresetIds(selected);
    setMorphPreviewEnabled(true);
  }

  async function clearDraftPresets() {
    const appearance = project?.draft_appearance ?? {
      eye_asset_id: null,
      body_preset_id: activeBodyPresetIds.body,
      head_preset_id: activeBodyPresetIds.head,
      skin_asset_id: null,
    };
    await updateDraftAppearance({
      ...appearance,
      body_preset_id: null,
      head_preset_id: null,
    });
    setActiveBodyPresetIds({ body: null, head: null });
  }

  async function selectDraftSkin(assetId: string | null) {
    const appearance = project?.draft_appearance ?? {
      eye_asset_id: null,
      body_preset_id: activeBodyPresetIds.body,
      head_preset_id: activeBodyPresetIds.head,
      skin_asset_id: null,
    };
    await updateDraftAppearance(
      { ...appearance, skin_asset_id: assetId },
      assetId === selectedDraftSkin?.id ? undefined : [],
    );
  }

  async function appendSkinPaintStrokes(strokes: SkinPaintStroke[]) {
    if (!project || !selectedDraftSkin) throw new Error('Select a skin asset before painting.');
    if (hasCharacter) throw new Error('Skin painting is available only in a draft before compilation.');
    const queuedSave = skinPaintSaveQueueRef.current.catch(() => undefined).then(async () => {
      const savedStrokes = skinPaintDraftStrokesRef.current;
      if (savedStrokes.length + strokes.length > 500) {
        throw new Error('This draft has reached the 500-stroke limit. Undo or clear strokes before painting more.');
      }
      if ([...savedStrokes, ...strokes].reduce((total, stroke) => total + stroke.points.length, 0) > 20_000) {
        throw new Error('This draft has reached the 20,000-point paint limit. Undo or clear strokes before painting more.');
      }
      const nextStrokes = [...savedStrokes, ...strokes];
      skinPaintDraftStrokesRef.current = nextStrokes;
      setSkinPaintDraftStrokes(nextStrokes);
      try {
        await updateDraftAppearance(project.draft_appearance, nextStrokes);
      } catch (error) {
        if (skinPaintDraftStrokesRef.current === nextStrokes) {
          skinPaintDraftStrokesRef.current = savedStrokes;
          setSkinPaintDraftStrokes(savedStrokes);
        }
        throw error;
      }
    });
    skinPaintSaveQueueRef.current = queuedSave;
    await queuedSave;
  }

  async function saveSkinPaintStrokes(strokes: SkinPaintStroke[]) {
    if (!project || !selectedDraftSkin) throw new Error('Select a skin asset before editing paint strokes.');
    if (hasCharacter) throw new Error('Skin painting is available only in a draft before compilation.');
    const queuedSave = skinPaintSaveQueueRef.current.catch(() => undefined).then(async () => {
      const savedStrokes = skinPaintDraftStrokesRef.current;
      skinPaintDraftStrokesRef.current = strokes;
      setSkinPaintDraftStrokes(strokes);
      try {
        await updateDraftAppearance(project.draft_appearance, strokes);
      } catch (error) {
        if (skinPaintDraftStrokesRef.current === strokes) {
          skinPaintDraftStrokesRef.current = savedStrokes;
          setSkinPaintDraftStrokes(savedStrokes);
        }
        throw error;
      }
    });
    skinPaintSaveQueueRef.current = queuedSave;
    await queuedSave;
  }

  async function bakeMorphs() {
    if (!project || !body) throw new Error('Import the CC3 morph character before baking its shape.');
    if (morphsBaked) throw new Error('The character morphs have already been baked.');
    if (!hasNonNeutralMorphs) throw new Error('Adjust at least one morph control before baking.');
    if (!window.confirm('Bake the current shape into the mesh? This removes the editable morph sliders. A checkpoint will be saved so you can restore them later.')) return;
    const assetId = body.source_asset?.asset_id;
    if (!assetId) throw new Error('The imported model does not identify its source asset.');
    const result = await requestJson<{ project: ApiProject }>(`/projects/${project.id}/modeling-tools`, {
      method: 'POST',
      body: JSON.stringify({
        tool_name: 'bake_cc3_morph_controls',
        operation_id: crypto.randomUUID(),
        expected_scene_version: project.scene_version,
        scope_component_ids: [body.id],
        dependency_component_ids: [],
        arguments: { component_id: body.id, asset_id: assetId, morphs },
      }),
    });
    applyProject(result.project);
    setSavedProjects((projects) => [summarizeProject(result.project), ...projects.filter((item) => item.id !== result.project.id)]);
    setChat((items) => [...items, { role: 'assistant', text: 'Baked the current morph shape into the mesh. Editable sliders were neutralized; use Restore editable morphs to return to the pre-bake checkpoint.' }]);
  }

  async function restoreEditableMorphs() {
    if (!project || !body?.bake_checkpoint_id) throw new Error('The pre-bake checkpoint is unavailable.');
    if (!window.confirm('Restore the scene from the checkpoint created before baking? This will discard scene changes made after that checkpoint.')) return;
    const restored = await requestJson<ApiProject>(
      `/projects/${project.id}/checkpoints/${body.bake_checkpoint_id}/restore`,
      { method: 'POST' },
    );
    applyProject(restored);
    setSavedProjects((projects) => [summarizeProject(restored), ...projects.filter((item) => item.id !== restored.id)]);
    setChat((items) => [...items, { role: 'assistant', text: 'Restored the editable morph controls from the pre-bake checkpoint.' }]);
  }

  async function uploadReference(file: File) {
    if (!project) {
      setChat((items) => [...items, { role: 'assistant', text: 'Create a project before uploading a reference.' }]);
      return;
    }
    setUploading(true);
    setReferenceActionError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await apiFetch(`/projects/${project.id}/references`, { method: 'POST', body: form });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : null;
        throw new Error(detail && typeof detail === 'object' && 'message' in detail ? String(detail.message) : 'Reference upload was rejected.');
      }
      const loaded = await requestJson<ApiProject>(`/projects/${project.id}`);
      applyProject(loaded);
      setChat((items) => [...items, { role: 'assistant', text: 'Reference image stored with this project.' }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      setReferenceActionError(`Reference upload failed: ${message}`);
      setChat((items) => [...items, { role: 'assistant', text: `Reference upload failed: ${message}` }]);
    } finally {
      setUploading(false);
    }
  }

  async function removeReference(reference: ApiReference) {
    if (!project) throw new Error('Open a project before removing a reference.');
    if (!window.confirm(`Remove reference "${reference.display_name}" from this project?`)) return;
    setRemovingReferenceId(reference.id);
    setReferenceActionError('');
    try {
      await requestJson<void>(
        `/projects/${project.id}/references/${encodeURIComponent(reference.id)}`,
        { method: 'DELETE' },
      );
      setProject((current) => current?.id === project.id
        ? { ...current, references: (current.references ?? []).filter(({ id }) => id !== reference.id) }
        : current);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      setReferenceActionError(`Reference removal failed: ${message}`);
      throw error;
    } finally {
      setRemovingReferenceId(null);
    }
  }

  function showAssistantGuidance(guidance: AssistantGuidance) {
    setGuidancePosition(null);
    const targetId = guidance.target_id;
    if (targetId.startsWith('morph:')) {
      const controlId = targetId.slice('morph:'.length);
      const control = controls.find(({ id }) => id === controlId);
      setStudioSection('models');
      setCustomizationCategory('body');
      if (control) {
        const area = morphAreaForControl(control);
        setSelectedBodyArea(area);
        setSelectedBodyMorphGroupId(area === 'body' ? bodyMorphGroupForControl(control) : null);
        setSelectedEarMorphGroupId(area === 'ears' ? earMorphGroupForControl(control) : null);
        setSelectedHeadMorphGroupId(area === 'head' ? headMorphGroupForControl(control) : null);
        setSelectedFaceMorphGroupId(area === 'face' ? faceMorphGroupForControl(control) : null);
        setSelectedEyeMorphGroupId(area === 'eyes' ? eyeMorphGroupForControl(control) : null);
        setSelectedOtherMorphGroupId(isOtherMorphAreaId(area) ? otherMorphGroupForControl(area, control) : null);
        setMorphMode('advanced');
        setMorphLibraryView('all');
        setMorphTypeFilter('all');
        setMorphSearch(control.label);
        setSelectedMorphId(control.id);
        setMorphPreviewEnabled(true);
      }
    } else if (targetId.startsWith('skin:')) {
      setStudioSection('models');
      setCustomizationCategory('skin');
    } else if (targetId.startsWith('eye:')) {
      setStudioSection('models');
      setCustomizationCategory('eyes');
    } else if (targetId.startsWith('preset:') || targetId === 'preset-library') {
      setStudioSection('models');
      setCustomizationCategory('body');
      setSelectedBodyArea('presets');
      setSelectedBodyMorphGroupId(null);
      setSelectedEarMorphGroupId(null);
      setSelectedHeadMorphGroupId(null);
      setSelectedFaceMorphGroupId(null);
      setSelectedEyeMorphGroupId(null);
      setSelectedOtherMorphGroupId(null);
      setMorphSearch('');
      setMorphLibraryView('all');
      setMorphTypeFilter('all');
      setMorphMode('advanced');
    } else if (targetId === 'skin-library') {
      setStudioSection('models');
      setCustomizationCategory('skin');
    } else if (targetId === 'eye-library') {
      setStudioSection('models');
      setCustomizationCategory('eyes');
    } else if (targetId === 'workflow-review') {
      setStudioSection('scene');
    } else if (targetId === 'morph-library') {
      setStudioSection('models');
      setCustomizationCategory('body');
      setMorphSearch('');
      setMorphLibraryView('all');
      setMorphTypeFilter('all');
      setMorphMode('advanced');
      const firstBodyControl = visibleControls.find((control) => morphAreaForControl(control) === 'body')
        ?? visibleControls[0];
      if (firstBodyControl) {
        const area = morphAreaForControl(firstBodyControl);
        setSelectedBodyArea(area);
        setSelectedBodyMorphGroupId(area === 'body' ? bodyMorphGroupForControl(firstBodyControl) : null);
        setSelectedEarMorphGroupId(area === 'ears' ? earMorphGroupForControl(firstBodyControl) : null);
        setSelectedHeadMorphGroupId(area === 'head' ? headMorphGroupForControl(firstBodyControl) : null);
        setSelectedFaceMorphGroupId(area === 'face' ? faceMorphGroupForControl(firstBodyControl) : null);
        setSelectedEyeMorphGroupId(area === 'eyes' ? eyeMorphGroupForControl(firstBodyControl) : null);
        setSelectedOtherMorphGroupId(isOtherMorphAreaId(area) ? otherMorphGroupForControl(area, firstBodyControl) : null);
        setSelectedMorphId(firstBodyControl.id);
      } else {
        setSelectedBodyArea('body');
        setSelectedBodyMorphGroupId(null);
        setSelectedEarMorphGroupId(null);
        setSelectedHeadMorphGroupId(null);
        setSelectedFaceMorphGroupId(null);
        setSelectedEyeMorphGroupId(null);
        setSelectedOtherMorphGroupId(null);
        setSelectedMorphId(null);
      }
    } else {
      setStudioSection('models');
      setCustomizationCategory('body');
    }
    setActiveGuidance(guidance);
  }

  async function applyAssistantProposal(proposal: AssistantProposal, chatIndex: number) {
    if (!project) throw new Error('Open a project before applying an AI proposal.');
    const morphUpdates = proposal.morph_updates ?? {};
    for (const [controlId, value] of Object.entries(morphUpdates)) {
      const control = controls.find(({ id }) => id === controlId);
      if (!control || !Number.isFinite(value) || value < control.minimum || value > control.maximum) {
        throw new Error(`The proposed ${controlId} value is not available for this character.`);
      }
      if (morphControlsDisabled) throw new Error('Morph editing is unavailable for this character in its current state.');
    }

    const appearanceUpdates = proposal.appearance_updates ?? {};
    const changesAppearance = Object.keys(appearanceUpdates).length > 0;
    if (changesAppearance) {
      if (hasCharacter) throw new Error('Appearance choices can only be changed in an uncompiled draft.');
      if (appearanceSaveInProgress.current) throw new Error('Wait for the current appearance change to finish saving.');
      const nextAppearance = {
        ...project.draft_appearance,
        ...appearanceUpdates,
      };
      await updateDraftAppearance(nextAppearance);
      if (Object.hasOwn(appearanceUpdates, 'body_preset_id')) setMorphPreviewEnabled(true);
    }

    if (Object.keys(morphUpdates).length > 0) {
      if (controls.some(({ id }) => Object.hasOwn(morphUpdates, id)
        && (latestMorphs.current[id] ?? 0) !== morphUpdates[id])) {
        recordMorphEdit();
      }
      morphInteractionRef.current = false;
      morphGestureHistoryCaptured.current = false;
      setMorphInteractionActive(false);
      setMorphs((current) => ({ ...current, ...morphUpdates }));
      setRecentMorphIds((current) => [
        ...Object.keys(morphUpdates).reverse(),
        ...current.filter((id) => !Object.hasOwn(morphUpdates, id)),
      ].slice(0, 12));
      setMorphPreviewEnabled(true);
      if (hasCharacter) {
        setChat((items) => [...items, {
          role: 'assistant',
          text: 'The proposed morphs are previewed. Use “Save changes to Blender” when you want to commit them to the compiled scene.',
        }]);
      }
    }
    setChat((items) => items.map((item, index) => index === chatIndex
      ? { ...item, proposalApplied: true }
      : item));
  }

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (!text || running) return;
    if (!project && !selectedBaseModelInfo) {
      if (availableBaseModels.length > 0) {
        setProjectCreationError('');
        setNewProjectStep('character-setup');
        setNewProjectOpen(true);
      }
      return;
    }
    setMessage('');
    setChat((items) => [...items, { role: 'user', text }]);
    setRunning(true);
    try {
      let activeProject = project;
      if (!activeProject) {
        if (!apiReady) throw new Error('The local workspace API is not connected.');
        if (!selectedBaseModelInfo) throw new Error('No character base model is available. Open New Project to review model availability.');
        const created = await requestJson<ApiProject>('/projects', {
          method: 'POST',
          body: JSON.stringify({
            name: projectName.trim() || 'Untitled Character',
            target_profile: 'general_purpose',
            base_model_asset_id: selectedBaseModelInfo.asset_id,
          }),
        });
        activeProject = created;
        applyProject(created);
        setSavedProjects((projects) => [summarizeProject(created), ...projects.filter((item) => item.id !== created.id)]);
        const planned = await requestJson<ApiProject>(`/projects/${created.id}/plan`, { method: 'POST' });
        activeProject = planned;
        applyProject(planned);
        setSavedProjects((projects) => [summarizeProject(planned), ...projects.filter((item) => item.id !== planned.id)]);
      }
      const assistantMessage = await sendProjectChatMessage(
        activeProject,
        text,
        activeProject.id === project?.id ? body?.id ?? null : null,
      );
      setChat((items) => [...items, assistantMessage]);
    } catch (error) {
      setChat((items) => [...items, { role: 'assistant', text: `Request failed: ${error instanceof Error ? error.message : 'unknown error'}` }]);
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    function syncViewportFullscreen() {
      setViewportFullscreen(document.fullscreenElement === viewportRef.current);
    }
    document.addEventListener('fullscreenchange', syncViewportFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncViewportFullscreen);
  }, []);

  async function toggleViewportFullscreen() {
    const viewport = viewportRef.current;
    if (!viewport) {
      setViewportControlError('The 3D viewport is not available for fullscreen.');
      return;
    }
    try {
      if (document.fullscreenElement === viewport) {
        await document.exitFullscreen();
      } else {
        if (document.fullscreenElement) await document.exitFullscreen();
        await viewport.requestFullscreen();
      }
      setViewportControlError('');
    } catch (error) {
      setViewportControlError(error instanceof Error ? `Fullscreen failed: ${error.message}` : 'Fullscreen failed.');
    }
  }

  const chatWidget = (
    <section
      className={`chat-widget${chatOpen ? ' is-open' : ' is-collapsed'}${!project ? ' landing-chat-widget' : ''}`}
      aria-label="Studio chat"
    >
      {chatOpen ? <>
        <header className="chat-widget-header">
        <div className="chat-widget-title"><Sparkles size={19} /><strong>{project ? 'Chat' : 'Chat with Canvas'}</strong></div>
        {!project && <span className={`landing-online-status${apiReady ? ' is-ready' : apiError ? ' is-offline' : ' is-connecting'}`}><span /> {apiReady ? 'Online' : apiError ? 'Offline' : 'Connecting'}</span>}
        <div className="chat-widget-actions">
          <button className="chat-widget-action" type="button" aria-label="Collapse chat" title="Collapse chat" onClick={() => setChatOpen(false)}><ChevronDown size={17} /></button>
        </div>
        </header>
        {(chat.length > 0 || running) ? <div className="chat-feed" aria-live="polite">
          {chat.map((item, index) => <div key={index} className={`chat-line ${item.role}`}><div className="chat-avatar" aria-hidden="true">{item.role === 'assistant' ? <Sparkles size={18} /> : <UserRound size={18} />}</div><div className="chat-content">
            <div className="chat-role">{item.role === 'assistant' ? 'C3Studio' : 'You'}</div>
            <p>{item.text}</p>
            {item.interactionWarning && <p className="assistant-interaction-warning" role="status">{item.interactionWarning}</p>}
            {item.proposal && <section className="assistant-proposal" aria-label="Proposed draft changes">
              <strong>Suggested changes</strong>
              {Object.entries(item.proposal.morph_updates).length > 0 && <span>{Object.entries(item.proposal.morph_updates).map(([id, value]) => {
                const control = controls.find(({ id: controlId }) => controlId === id);
                return `${control?.label ?? id}: ${(value * 100).toFixed(0)}%`;
              }).join(' · ')}</span>}
              {Object.entries(item.proposal.appearance_updates).map(([key, value]) => {
                const asset = [...eyeAssets, ...skinAssets, ...bodyPresets].find(({ id }) => id === value);
                const label = key === 'eye_asset_id' ? 'Eyes' : key === 'skin_asset_id' ? 'Skin' : 'Preset';
                const assetLabel = asset && 'name' in asset ? asset.name : asset && 'label' in asset ? asset.label : value ?? 'Clear selection';
                return <span key={key}>{label}: {assetLabel}</span>;
              })}
              <button
                type="button"
                disabled={item.proposalApplied || running || !project}
                onClick={() => void runAction(() => applyAssistantProposal(item.proposal!, index))}
              >{item.proposalApplied ? 'Applied to draft' : 'Apply to draft'}</button>
            </section>}
            {item.guidance && <button className="assistant-guidance-link" type="button" onClick={() => showAssistantGuidance(item.guidance!)}>
              {activeGuidance?.target_id === item.guidance.target_id ? 'Guidance shown' : `Show guide: ${item.guidance.title}`}
            </button>}
          </div></div>)}
          {running && <div className="thinking"><span /><span /><span /> Working…</div>}
        </div> : <div className="chat-empty-state">
          <span className="chat-empty-icon"><Sparkles size={22} /></span>
          <strong>{project ? 'How can I help with this project?' : 'Hi, I’m Canvas. How can I help today?'}</strong>
          <span>{project
            ? 'Ask a question or describe a scoped change.'
            : 'Describe a character. Choose a model before we create its draft.'}</span>
          {!project && <div className="landing-chat-shortcuts" aria-label="Assistant suggestions">
            <button type="button" onClick={openNewProject}><Plus size={14} /> Create a new project <ChevronRight size={14} /></button>
            <button type="button" onClick={() => setMessage('What can I create with the installed character models?')}><Box size={14} /> Explore character creation <ChevronRight size={14} /></button>
          </div>}
        </div>}
        {apiError && <div className="workspace-alert" role="alert">
          <span>{apiError}. Check that the local API is running.</span>
          <button className="initial-data-retry" type="button" disabled={initialDataLoading} onClick={() => setInitialDataRetry((retry) => retry + 1)}>{initialDataLoading ? 'Retrying…' : 'Retry connection'}</button>
        </div>}
        <form className="composer" aria-label="Prompt composer" onSubmit={(event) => void sendMessage(event)}>
          <Sparkles className="composer-sparkle" size={18} aria-hidden="true" />
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={!apiReady
              ? 'Connect to the local workspace to chat…'
              : !project && baseModelsLoading
                ? 'Checking character model availability…'
                : !project && baseModelsError
                  ? 'Describe your character; model availability needs attention…'
                  : !project && availableBaseModels.length === 0
                    ? 'Describe your character; no base models are available…'
                    : !project && !selectedBaseModelInfo
                      ? 'Describe your character; choose a base model when sending…'
                  : !project
                    ? 'Describe your character to start a project…'
                    : 'Ask me anything…'}
            rows={1}
            disabled={!apiReady || running || (!project && baseModelsLoading)}
          />
          <div className="composer-bottom">
            <div className="composer-hints">
              <input type="file" accept="image/png,image/jpeg,image/webp" hidden id="reference-upload" aria-label="Choose reference image" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadReference(file); }} />
              <button type="button" aria-label="Attach reference image" disabled={!project || uploading} onClick={() => document.getElementById('reference-upload')?.click()}><Paperclip size={18} /></button>
            </div>
            <button className="send-button" type="submit" disabled={!message.trim() || !apiReady || running || (!project && (baseModelsLoading || availableBaseModels.length === 0))} aria-label="Send message"><Send size={18} /></button>
          </div>
        </form>
      </> : <button
        className="chat-launcher"
        type="button"
        aria-label="Open chat"
        title="Open chat"
        onClick={() => {
          setChatOpen(true);
        }}
      ><Sparkles size={25} /><span className="chat-launcher-label">Chat</span></button>}
    </section>
  );

  const assistantGuidanceTooltip = activeGuidance && guidancePosition ? createPortal(
    <aside
      className={`assistant-guidance-tooltip${guidancePosition.placement === 'above' ? ' is-above' : ''}`}
      role="status"
      aria-live="polite"
      style={{
        left: guidancePosition.left,
        top: guidancePosition.top,
        ['--guide-arrow-left' as string]: `${guidancePosition.arrowLeft}px`,
      }}
    >
      <button type="button" aria-label="Dismiss guidance" onClick={() => { setActiveGuidance(null); setGuidancePosition(null); }}><X size={15} /></button>
      <strong>{activeGuidance.title}</strong>
      <p>{activeGuidance.message}</p>
    </aside>,
    document.body,
  ) : null;

  const sceneHierarchy = (
    <div className="scene-tree">
      <div className="scene-tree-row scene-root"><ChevronDown size={15} /><Box size={19} /><span>Scene</span></div>
      {hasCharacter ? <>
        <div className="scene-tree-row scene-character"><ChevronDown size={15} /><UserRound size={19} /><span>Character</span></div>
        {(Object.keys(parts) as ModelPartKey[]).map((key) => <div className={`scene-tree-row scene-part${selectedPart === key ? ' selected' : ''}`} key={key}>
          <button className="scene-part-select" type="button" onClick={() => setSelectedPart(key)}><Box size={18} /><span>{key === 'body' ? 'Body' : parts[key].label.replace(' and ', ' & ')}</span></button>
          <button className="scene-part-visibility" type="button" title={parts[key].visible ? 'Hide component in preview' : 'Show component in preview'} aria-label={`${parts[key].visible ? 'Hide' : 'Show'} ${parts[key].label}`} onClick={() => setParts((current) => ({ ...current, [key]: { ...current[key], visible: !current[key].visible } }))}>{parts[key].visible ? <Eye size={15} /> : <EyeOff size={15} />}</button>
        </div>)}
      </> : project
        ? <div className="scene-empty-row"><span className="scene-empty-indent" /><span>Draft character preview · not assembled</span></div>
        : <div className="scene-empty-row"><span className="scene-empty-indent" /><span>No model in scene</span></div>}
    </div>
  );

  const characterProperties = <>
    <div className="property-summary">
      <span className="property-thumbnail">{hasCharacter ? <UserRound size={29} /> : <FolderOpen size={26} />}</span>
      <div><strong>{selectedPart ? parts[selectedPart].label : project?.name ?? 'Workspace'}</strong><span>{hasCharacter ? activeModelName : project ? 'Character project' : 'No project selected'}</span><span>{project ? `Scene version ${project.scene_version}` : 'Create a project to get started'}</span></div>
    </div>
    {hasCharacter && <div className="inspector-morphs">
      <div className="cc3-morph-heading">
        <div><strong>Character morphs</strong><small>{morphsBaked ? 'Baked into mesh' : morphsDirty || bodyPresetDirty ? 'Preview only · unsaved' : 'Saved in Blender'}</small></div>
        <button type="button" disabled={!hasNonNeutralMorphs || morphControlsDisabled} onClick={resetMorphs}>Reset all</button>
      </div>
      <small className="cc3-morph-note">Use the Body editor to search and adjust anatomically grouped controls.</small>
      <button
        className="inspector-morph-editor-link"
        type="button"
        onClick={() => { setStudioSection('models'); setCustomizationCategory('body'); if (hasCharacter) setMorphPreviewEnabled(true); }}
      >Open Body morph editor <ChevronRight size={15} /></button>
    </div>}
    {!project && apiError && <div className="inspector-api-error" role="alert">
      <span>{apiError}. Check that the local API is running.</span>
      <button className="initial-data-retry" type="button" disabled={initialDataLoading} onClick={() => setInitialDataRetry((retry) => retry + 1)}>{initialDataLoading ? 'Retrying…' : 'Retry connection'}</button>
    </div>}
    <div className="properties-note">{project && !hasCharacter
      ? 'This character is a saved browser draft. Blender geometry is created only when you build the editable character.'
      : 'Changes are saved through the Blender project. No placeholder geometry.'}</div>
  </>;

  const projectWorkflow = !project ? <div className="workflow-empty">Create a project to view its workflow.</div> : (
    <div className="inspector-workflow">
      <div className="workflow-status"><span className={referencePlan?.status === 'approved' ? 'workflow-status-dot approved' : 'workflow-status-dot'} />{referencePlan?.status === 'approved' ? 'Plan approved' : referencePlan?.status === 'awaiting_review' ? 'Plan awaiting approval' : 'Plan not started'}</div>
      <section className="workflow-references" aria-label="Reference images">
        <div className="workflow-references-heading">
          <strong>Reference images</strong>
          <span>{project.references?.length ?? 0}</span>
        </div>
        <p>Stored with this project; images are not visually analyzed or used to infer character details.</p>
        {referenceActionError && <p className="workflow-reference-error" role="alert">{referenceActionError}</p>}
        {uploading && <p className="workflow-reference-progress" role="status">Uploading and validating reference image…</p>}
        {removingReferenceId && <p className="workflow-reference-progress" role="status">Removing reference image…</p>}
        {(project.references?.length ?? 0) > 0 && <ul>
          {(project.references ?? []).map((reference) => (
            <li key={reference.id}>
              <span className="workflow-reference-file">
                <strong title={reference.display_name}>{reference.display_name}</strong>
                <small>{reference.width} × {reference.height}</small>
              </span>
              <button
                type="button"
                aria-label={`Remove reference ${reference.display_name}`}
                title={`Remove ${reference.display_name}`}
                aria-busy={removingReferenceId === reference.id}
                disabled={running || uploading || removingReferenceId !== null}
                onClick={() => void runAction(() => removeReference(reference))}
              ><X size={14} /></button>
            </li>
          ))}
        </ul>}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          id="workflow-reference-upload"
          aria-label="Choose reference image"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void uploadReference(file);
            event.currentTarget.value = '';
          }}
        />
        <button
          className="workflow-reference-add"
          type="button"
          disabled={uploading || running || removingReferenceId !== null}
          onClick={() => document.getElementById('workflow-reference-upload')?.click()}
        ><Paperclip size={14} />{uploading ? 'Uploading image…' : 'Add reference image'}</button>
      </section>
      {project.planning_metadata?.summary && <p className="workflow-summary">{project.planning_metadata.summary}</p>}
      {project.planning_metadata?.warnings?.map((warning) => <p className="workflow-warning" key={warning}>{warning}</p>)}
      {project.component_plan?.length > 0 && <div className="planned-components">
        <span className="property-field-label">Planned components</span>
        {project.component_plan.map((item, index) => <div key={item.id ?? index}><Box size={15} /><span>{item.display_name}</span></div>)}
      </div>}
      {referencePlan?.status === 'awaiting_review' && <button className="inspector-primary-action" type="button" disabled={running || (!hasCharacter && (draftSaveStatus !== 'saved' || morphsDirty))} onClick={() => void runAction(approvePhase)}>Approve plan <ChevronRight size={16} /></button>}
      {referencePlan?.status === 'approved' && !hasCharacter && <button
        className="inspector-primary-action"
        type="button"
        disabled={running || !blenderAvailable || draftSaveStatus !== 'saved' || morphsDirty}
        onClick={() => void runAction(buildEditableCharacter)}
      >{importingCharacter ? `Compiling ${activeModelName}...` : 'Save / compile project in Blender'} {!importingCharacter && <ChevronRight size={16} />}</button>}
      {referencePlan?.status === 'awaiting_review' && !hasCharacter && <p className="workflow-footnote">Approval is required before final save. All edits stay in the browser preview and persisted draft; Blender is not used until you explicitly compile.</p>}
      {!hasCharacter && !blenderAvailable && <p className="workflow-footnote" role="status">
        Blender is unavailable, so compilation is disabled. Your browser draft and saved choices remain available.
        {blenderError ? ` ${blenderError}` : ''}
      </p>}
      {referencePlan?.status === 'approved' && !hasCharacter && blenderAvailable && <p className="workflow-footnote">Eye, preset, and morph choices are previewed and saved as draft data. Save / compile builds them together in Blender.</p>}
    </div>
  );

  useEffect(() => {
    try {
      localStorage.setItem('c3canvas.dashboard-card-order', JSON.stringify(landingCardOrder));
      setLandingCardStorageError('');
    } catch {
      setLandingCardStorageError('Dashboard layout could not be saved in this browser.');
    }
  }, [landingCardOrder]);

  const reorderLandingCard = (source: LandingCardId, target: LandingCardId) => {
    setLandingCardOrder((current) => {
      const sourceIndex = current.indexOf(source);
      const targetIndex = current.indexOf(target);
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return current;
      const next = [...current];
      next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, source);
      return next;
    });
  };

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = landingCardDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
      if (!drag.moved) {
        drag.moved = true;
        setDraggingLandingCard(drag.cardId);
      }
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-dashboard-card]');
      const targetId = target && isLandingCardId(target.dataset.dashboardCard) ? target.dataset.dashboardCard : null;
      if (drag.target !== targetId) {
        drag.target = targetId;
        setLandingDropTarget(targetId);
      }
    };

    const finishPointerDrag = (event: PointerEvent) => {
      const drag = landingCardDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (drag.moved) {
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-dashboard-card]');
        const targetId = target && isLandingCardId(target.dataset.dashboardCard) ? target.dataset.dashboardCard : null;
        if (targetId) reorderLandingCard(drag.cardId, targetId);
      }
      landingCardDragRef.current = null;
      setDraggingLandingCard(null);
      setLandingDropTarget(null);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', finishPointerDrag);
    window.addEventListener('pointercancel', finishPointerDrag);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', finishPointerDrag);
      window.removeEventListener('pointercancel', finishPointerDrag);
    };
  }, []);

  const moveLandingCard = (cardId: LandingCardId, offset: -1 | 1) => {
    const index = landingCardOrder.indexOf(cardId);
    const target = landingCardOrder[index + offset];
    if (target) reorderLandingCard(cardId, target);
  };

  const getLandingCardProps = (cardId: LandingCardId) => ({
    style: { order: landingCardOrder.indexOf(cardId) },
    'data-dashboard-card': cardId,
    'data-dragging': draggingLandingCard === cardId ? 'true' : undefined,
    'data-drop-target': draggingLandingCard !== cardId && landingDropTarget === cardId ? 'true' : undefined,
  });

  const showWorkflowInChat = () => {
    setMessage('Explain the draft, preview, approval, and compile workflow.');
    setChatOpen(true);
  };

  if (authLoading) {
    return <main className="account-gate" role="status"><p>Checking your account…</p></main>;
  }
  if (!account) {
    return <AccountGate
      initialError={authError}
      onAuthenticated={acceptAccountSession}
      onRetry={() => setAuthRetry((retry) => retry + 1)}
    />;
  }
  if (objectWorkshopOpen) {
    return <Suspense fallback={<div className="preview-status" role="status">Loading Object Workshop…</div>}><ObjectWorkshop onExit={() => setObjectWorkshopOpen(false)} /></Suspense>;
  }

  const renderLandingCardControls = (cardId: LandingCardId) => {
    const index = landingCardOrder.indexOf(cardId);
    const label = landingCardLabels[cardId];
    return <div className="landing-card-controls" aria-label={`Rearrange ${label} card`}>
      <span
        className="landing-card-drag-handle"
        title={`Drag to move ${label}`}
        aria-hidden="true"
        onPointerDown={(event: ReactPointerEvent<HTMLSpanElement>) => {
          if (!event.isPrimary || event.button !== 0) return;
          event.preventDefault();
          landingCardDragRef.current = {
            cardId,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            moved: false,
            target: null,
          };
        }}
      ><GripVertical size={15} /></span>
      <button type="button" aria-label={`Move ${label} earlier`} title="Move earlier" disabled={index === 0} onClick={() => moveLandingCard(cardId, -1)}><ArrowUp size={13} /></button>
      <button type="button" aria-label={`Move ${label} later`} title="Move later" disabled={index === landingCardOrder.length - 1} onClick={() => moveLandingCard(cardId, 1)}><ArrowDown size={13} /></button>
    </div>;
  };

  return (
    <div
      className={`app-shell${project ? ` studio-shell${chatOpen ? ' chat-open' : ' chat-collapsed'}${zoomFitViewport ? ' is-zoom-fit' : ''}` : ' landing-shell'}`}
      style={project && zoomFitViewport ? {
        '--landing-visual-width': `${zoomFitViewport.width}px`,
        '--landing-visual-height': `${zoomFitViewport.height}px`,
      } as CSSProperties : undefined}
    >
      {project ? <>
      <aside className="studio-sidebar">
        <nav className="studio-nav" aria-label="Main navigation">
          <button type="button" className={`studio-nav-item${studioSection === 'models' ? ' active' : ''}`} title="Models" aria-current={studioSection === 'models' ? 'page' : undefined} onClick={() => setStudioSection('models')}><UserRound size={19} /><span>Models</span></button>
          <button type="button" className={`studio-nav-item${studioSection === 'scene' ? ' active' : ''}`} title="Scene" aria-current={studioSection === 'scene' ? 'page' : undefined} onClick={() => setStudioSection('scene')}><Layers3 size={19} /><span>Scene</span></button>
          <button type="button" className="studio-nav-item" disabled title="Materials editing is not available yet"><Palette size={19} /><span>Materials</span></button>
          <button type="button" className="studio-nav-item" disabled title="Lighting controls are not available yet"><Sun size={19} /><span>Lighting</span></button>
          <button type="button" className="studio-nav-item" disabled title="Settings are not available yet"><Settings size={19} /><span>Settings</span></button>
        </nav>
      </aside>
      <header className="topbar">
        <div className="topbar-project-actions" aria-label="Project actions">
          <button
            className="project-icon-button"
            type="button"
            aria-label="Return to welcome screen"
            title={draftSaveStatus !== 'saved' || morphsDirty || bodyPresetDirty ? 'Wait for draft changes to save before leaving this project.' : 'Return to welcome screen'}
            disabled={running || draftSaveStatus !== 'saved' || morphsDirty || bodyPresetDirty}
            onClick={returnToWelcome}
          ><Home size={18} /></button>
          <button className="project-icon-button" type="button" aria-label="New project" title="New project" disabled={!apiReady || running || skinDefinitionDirty || skinDefinitionSaving} onClick={openNewProject}><Plus size={19} /></button>
          <div className="saved-project-picker">
            <button
              className="project-icon-button"
              type="button"
              aria-label="Open project"
              title="Open project"
              aria-expanded={savedProjectsOpen}
              aria-controls="saved-project-list"
              disabled={!apiReady || (otherSavedProjects.length === 0 && !savedProjectsLoading && !savedProjectsError) || running || skinDefinitionDirty || skinDefinitionSaving}
              onClick={() => setSavedProjectsOpen((open) => !open)}
            ><FolderOpen size={18} /></button>
            {savedProjectsOpen && <div className="saved-project-list" id="saved-project-list" aria-label="Open saved project">
              <strong>Open project</strong>
              {savedProjectsLoading && <p role="status">Loading saved projects…</p>}
              {savedProjectsError && <div className="saved-project-load-error" role="alert">
                <span>{savedProjectsError}</span>
                <button className="initial-data-retry" type="button" disabled={initialDataLoading} onClick={() => setInitialDataRetry((retry) => retry + 1)}>{initialDataLoading ? 'Retrying…' : 'Retry projects'}</button>
              </div>}
              {otherSavedProjects.length > 0 ? otherSavedProjects.map((item) => {
                const assetId = item.base_model_asset_id;
                const modelName = availableBaseModels.find((model) => model.asset_id === assetId)?.name
                  ?? (assetId === 'character_cc5_rlcc3plus_all_morphs_v1' ? 'RL CC3+ Full Morphs' : 'CC3 Character');
                return <div className="saved-project-row" key={item.id}>
                  <button
                    type="button"
                    className="saved-project-open"
                    disabled={skinDefinitionDirty || skinDefinitionSaving}
                    onClick={() => { setSavedProjectsOpen(false); void runAction(() => openProject(item.id)); }}
                  >
                    <FolderOpen size={15} />
                    <span><strong>{item.name}</strong><small>{modelName} · {item.has_character ? 'Imported' : 'Setup only'}</small></span>
                  </button>
                  <button
                    type="button"
                    className="saved-project-delete"
                    aria-label={`Delete ${item.name}`}
                    title={`Delete ${item.name}`}
                    disabled={running || skinDefinitionDirty || skinDefinitionSaving}
                    onClick={() => void runAction(() => deleteProject(item.id, item.name))}
                  ><Trash2 size={15} /></button>
                </div>;
              }) : <p>No saved projects.</p>}
            </div>}
          </div>
        </div>
        <div className="top-actions">
          <button
            className="topbar-utility"
            type="button"
            disabled={!project || morphControlsDisabled || morphHistory.past.length === 0 || running}
            aria-label="Undo morph edit"
            title="Undo the latest morph slider, reset, ear preset, or assistant morph edit."
            onClick={undoMorphEdit}
          ><RotateCcw size={17} /></button>
          <button
            className="topbar-utility"
            type="button"
            disabled={!project || morphControlsDisabled || morphHistory.future.length === 0 || running}
            aria-label="Redo morph edit"
            title="Redo the latest undone morph edit."
            onClick={redoMorphEdit}
          ><RotateCcw className="redo-icon" size={17} /></button>
          <button
            type="button"
            className="topbar-utility account-signout"
            aria-label={`Sign out ${account.username}`}
            title={`Sign out ${account.username}`}
            disabled={running || draftSaveStatus !== 'saved' || morphsDirty || bodyPresetDirty || skinDefinitionDirty || skinDefinitionSaving || appearanceSaving}
            onClick={() => void runAction(signOut)}
          ><UserRound size={16} /></button>
          <span className="topbar-divider" />
          <button
            className="export-button"
            type="button"
            disabled={!project || hasCharacter || referencePlan?.status !== 'approved' || !blenderAvailable || running || appearanceSaving || skinDefinitionSaving || skinDefinitionDirty || draftSaveStatus !== 'saved' || morphsDirty}
            title={hasCharacter
              ? 'This project has already been compiled.'
              : !blenderAvailable
                ? `Blender is unavailable. ${blenderError || 'Compilation is disabled.'}`
                : referencePlan?.status !== 'approved'
                  ? 'Approve the plan before compiling.'
                  : draftSaveStatus !== 'saved' || morphsDirty || skinDefinitionDirty || skinDefinitionSaving
                    ? 'Wait for draft changes to finish saving before compiling.'
                    : 'Compile the saved browser draft in Blender.'}
            onClick={() => void runAction(buildEditableCharacter)}
          ><Download size={18} />{importingCharacter ? 'Compiling…' : hasCharacter ? 'Compiled' : 'Save / Compile'}</button>
          <button className="topbar-utility preview-action" type="button" disabled aria-label="Preview is not available yet" title="Preview is not available yet"><Play size={19} fill="currentColor" /></button>
        </div>
      </header>
      <main
        className={`workspace fixed-workspace${characterDockResizing ? ' is-resizing-character-dock' : ''}`}
        ref={workspaceRef}
        style={{
          '--character-dock-width': `${characterDockWidth}px`,
          '--character-dock-height': `${characterDockHeight}%`,
        } as CSSProperties}
      >
        <section className={`viewport-area${skinPaintEnabled ? ' is-skin-painting' : ''}`} aria-label="3D workspace">
          <div
            className={`canvas-wrap${skinPaintEnabled ? ' is-skin-painting' : ''}${skinPaintEnabled && skinPaintPointerOnModel ? ' is-skin-painting-on-model' : ''}`}
            ref={viewportRef}
          >
            <Suspense fallback={<div className="preview-status" role="status">Loading interactive 3D workspace…</div>}>
              <CharacterViewportCanvas
                previewUrl={displayPreviewUrl}
                eyePreviewUrl={eyePreviewUrl}
                skinPreview={skinPreview}
                skinDefinition={skinDefinitionPreview}
                morphPreviewUrl={morphPreviewUrl}
                morphDeltaBaseUrl={morphDeltaBaseUrl}
                morphDeltaSha256={morphDeltaSha256}
                morphPresetDeltaBaseUrl={morphPresetDeltaBaseUrl}
                morphPresetDeltaSha256={morphPresetDeltaSha256}
                visible={visibleParts}
                morphs={clientMorphValues}
                controls={clientMorphControls}
                onClientMorphPreviewState={onClientMorphPreviewState}
                onSkinPreviewError={onSkinPreviewError}
                skinPaintEnabled={skinPaintEnabled && !appearanceSaving && !hasCharacter}
                skinPaintColor={skinPaintColor}
                skinPaintTool={skinPaintTool}
                skinPaintSize={skinPaintSize}
                skinPaintOpacity={skinPaintOpacity}
                skinPaintStrokes={skinPaintStrokes}
                onSkinPaintStrokes={(strokes) => void runAction(() => appendSkinPaintStrokes(strokes))}
                onSkinPaintPointerOnModel={setSkinPaintPointerOnModel}
                cameraKey={cameraKey}
                cameraMode={cameraMode}
                cameraProjection={cameraProjection}
                fillLightsEnabled={fillLightsEnabled}
                lightingPreset={lightingPreset}
                onCanvasCreated={notifyCanvasCreated}
                orbitControlsRef={orbitControlsRef}
                skinPaintPointerOnModel={skinPaintPointerOnModel}
              />
            </Suspense>
            <div className="workspace-size-controls" role="group" aria-label="Workspace layout">
              <button
                type="button"
                aria-pressed={viewportLayout === 'viewport'}
                onClick={() => chooseViewportLayout('viewport')}
              >Viewport</button>
              <button
                type="button"
                aria-pressed={viewportLayout === 'balanced'}
                onClick={() => chooseViewportLayout('balanced')}
              >Balanced</button>
              <button
                type="button"
                aria-pressed={viewportLayout === 'editor'}
                onClick={() => chooseViewportLayout('editor')}
              >Editor</button>
            </div>
            {importingCharacter && <div className="preview-importing" role="status" aria-live="polite">
              <span className="preview-loading-spinner" aria-hidden="true" />
              <div><strong>Importing {activeModelName}</strong><span>Blender is preparing the model, materials, and editable morph controls.</span></div>
            </div>}
            {viewportControlError && <div className="viewport-control-error" role="alert">{viewportControlError}</div>}
            {(morphPreviewMode === 'server' ? serverMorphPreviewStatus : clientMorphPreviewStatus) === 'updating' && <div className="preview-status" role="status">{morphPreviewMode === 'server' ? 'Updating character preview from slider values…' : 'Loading cached morph detail…'}</div>}
            {(morphPreviewMode === 'server' ? serverMorphPreviewStatus : clientMorphPreviewStatus) === 'error' && <div className="preview-status is-error" role="alert">{morphPreviewMode === 'server' ? serverMorphPreviewError : clientMorphPreviewError}</div>}
            {!previewUrl && baseModelsLoading && <div className="preview-status" role="status">Loading installed character preview…</div>}
            {!previewUrl && baseModelsError && <div className="preview-status is-error" role="alert">{baseModelsError}</div>}
            <div className="viewport-mode-controls" role="toolbar" aria-label="Viewport navigation mode">
              <button type="button" className={cameraMode === 'orbit' ? 'active' : ''} aria-label="Orbit" title="Orbit" aria-pressed={cameraMode === 'orbit'} onClick={() => setCameraMode('orbit')}><Crosshair size={19} /><span>Orbit</span></button>
              <span className="viewport-mode-divider" aria-hidden="true" />
              <button ref={panModeButtonRef} type="button" className={cameraMode === 'pan' ? 'active' : ''} aria-label="Pan" title="Pan" aria-pressed={cameraMode === 'pan'} onClick={() => setCameraMode('pan')}><Hand size={19} /><span>Pan</span></button>
              <span className="viewport-mode-divider" aria-hidden="true" />
              <button type="button" className={cameraMode === 'zoom' ? 'active' : ''} aria-label="Zoom" title="Zoom" aria-pressed={cameraMode === 'zoom'} onClick={() => setCameraMode('zoom')}><ZoomIn size={19} /><span>Zoom</span></button>
            </div>
            <div className="viewport-bottom">
              <div className="viewport-hint">
                {cameraMode === 'orbit' ? 'Left-drag or MMB to orbit' : cameraMode === 'pan' ? 'Left-drag to pan' : 'Left-drag to zoom'} · Shift+MMB to pan · Ctrl+MMB or scroll to zoom
              </div>
            </div>
            <div className="viewport-bottom-toolbar" role="toolbar" aria-label="Viewport display controls">
              <div className="viewport-bottom-group">
                <button type="button" className="viewport-bottom-button" aria-label="Reset camera view" title="Reset camera view" onClick={() => setCameraKey((key) => key + 1)}>
                  <Camera size={16} />
                </button>
                <button type="button" className="viewport-bottom-button is-unavailable" aria-label="Record viewport (unavailable)" title="Viewport recording is not available yet" disabled>
                  <Video size={16} />
                </button>
                <button
                  type="button"
                  className="viewport-bottom-button"
                  aria-label={viewportFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                  title={viewportFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                  aria-pressed={viewportFullscreen}
                  onClick={() => void toggleViewportFullscreen()}
                >
                  {viewportFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
                </button>
              </div>
              <span className="viewport-bottom-divider" aria-hidden="true" />
              <label className="viewport-projection">
                <span className="sr-only">Camera projection</span>
                <select
                  aria-label="Camera projection"
                  value={cameraProjection}
                  onChange={(event) => {
                    setCameraProjection(event.target.value === 'orthographic' ? 'orthographic' : 'perspective');
                    setCameraKey((key) => key + 1);
                  }}
                >
                  <option value="perspective">Perspective</option>
                  <option value="orthographic">Orthographic</option>
                </select>
                <ChevronDown size={13} aria-hidden="true" />
              </label>
              <span className="viewport-bottom-divider" aria-hidden="true" />
              <div className="viewport-bottom-group" role="group" aria-label="Studio lighting presets">
                <button
                  type="button"
                  className={`viewport-light-button${lightingPreset === 'cool' ? ' active' : ''}`}
                  aria-label="Cool studio lighting"
                  title="Cool studio lighting"
                  aria-pressed={lightingPreset === 'cool'}
                  onClick={() => setLightingPreset('cool')}
                ><span className="viewport-light-swatch cool" /></button>
                <button
                  type="button"
                  className={`viewport-light-button${lightingPreset === 'warm' ? ' active' : ''}`}
                  aria-label="Warm studio lighting"
                  title="Warm studio lighting"
                  aria-pressed={lightingPreset === 'warm'}
                  onClick={() => setLightingPreset('warm')}
                ><span className="viewport-light-swatch warm" /></button>
                <button
                  type="button"
                  className={`viewport-bottom-button${fillLightsEnabled ? ' active' : ''}`}
                  aria-label={fillLightsEnabled ? 'Turn fill lights off' : 'Turn fill lights on'}
                  title={fillLightsEnabled ? 'Turn fill lights off' : 'Turn fill lights on'}
                  aria-pressed={fillLightsEnabled}
                  onClick={() => setFillLightsEnabled((enabled) => !enabled)}
                ><Sun size={16} /></button>
              </div>
            </div>
          </div>
        </section>
        <aside className="character-dock" aria-label="Character customization">
          <div
            className="character-dock-resizer"
            role="separator"
            aria-label="Resize character editor"
            aria-orientation={compactWorkspace ? 'horizontal' : 'vertical'}
            aria-valuemin={compactWorkspace ? 180 : Math.min(420, Math.max(300, (workspaceRef.current?.clientWidth ?? window.innerWidth * 0.848) - 320))}
            aria-valuemax={compactWorkspace
              ? Math.max(180, Math.round((workspaceRef.current?.clientHeight ?? window.innerHeight) - 140))
              : Math.max(300, Math.min(760, (workspaceRef.current?.clientWidth ?? window.innerWidth * 0.848) - 320))}
            aria-valuenow={compactWorkspace
              ? Math.round((workspaceRef.current?.clientHeight ?? window.innerHeight) * characterDockHeight / 100)
              : Math.round(characterDockWidth)}
            tabIndex={0}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              setCharacterDockResizing(true);
            }}
            onPointerMove={(event) => {
              if (!characterDockResizing || event.buttons !== 1) return;
              const workspaceBounds = workspaceRef.current?.getBoundingClientRect();
              if (!workspaceBounds) return;
              if (compactWorkspace) {
                const maxHeight = Math.max(180, workspaceBounds.height - 140);
                const editorHeight = Math.max(180, Math.min(maxHeight, workspaceBounds.bottom - event.clientY));
                setCharacterDockHeight(editorHeight / workspaceBounds.height * 100);
              } else {
                const maxWidth = Math.max(300, Math.min(760, workspaceBounds.width - 320));
                setCharacterDockWidth(Math.min(maxWidth, Math.max(Math.min(420, maxWidth), workspaceBounds.right - event.clientX)));
              }
            }}
            onPointerUp={() => setCharacterDockResizing(false)}
            onPointerCancel={() => setCharacterDockResizing(false)}
            onKeyDown={(event) => {
              const resizeKeys = compactWorkspace ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
              if (!resizeKeys.includes(event.key)) return;
              event.preventDefault();
              if (compactWorkspace) {
                const workspaceHeight = workspaceRef.current?.clientHeight ?? window.innerHeight;
                const maxHeight = Math.max(180, workspaceHeight - 140);
                const heightDelta = (event.key === 'ArrowUp' ? 24 : -24) / workspaceHeight * 100;
                setCharacterDockHeight((height) => Math.min(maxHeight / workspaceHeight * 100, Math.max(180 / workspaceHeight * 100, height + heightDelta)));
              } else {
                const workspaceWidth = workspaceRef.current?.clientWidth ?? window.innerWidth;
                const maxWidth = Math.max(300, Math.min(760, workspaceWidth - 320));
                const widthDelta = event.key === 'ArrowLeft' ? 24 : -24;
                setCharacterDockWidth((width) => Math.min(maxWidth, Math.max(Math.min(420, maxWidth), width + widthDelta)));
              }
            }}
          />
          <nav className="character-dock-tabs" aria-label="Character categories">
            <button type="button" className={`character-dock-tab${customizationCategory === 'body' && morphMode === 'basic' ? ' active' : ''}`} aria-label="Morph" title="Morph" aria-pressed={customizationCategory === 'body' && morphMode === 'basic'} onClick={() => { setCustomizationCategory('body'); setMorphMode('basic'); setStudioSection('models'); if (hasCharacter) setMorphPreviewEnabled(true); }}><SlidersHorizontal size={19} /><span>Morph</span></button>
            <button type="button" className={`character-dock-tab${customizationCategory === 'eyes' ? ' active' : ''}`} aria-label="Eyes" title="Eyes" aria-pressed={customizationCategory === 'eyes'} onClick={() => { setCustomizationCategory('eyes'); setStudioSection('models'); }}><Eye size={19} /><span>Eyes</span></button>
            <button type="button" className={`character-dock-tab${customizationCategory === 'skin' ? ' active' : ''}`} aria-label="Skin" title="Skin" aria-pressed={customizationCategory === 'skin'} onClick={() => { setCustomizationCategory('skin'); setStudioSection('models'); }}><Circle size={19} /><span>Skin</span></button>
            <button type="button" className={`character-dock-tab${customizationCategory === 'clothing' ? ' active' : ''}`} aria-pressed={customizationCategory === 'clothing'} onClick={() => { setCustomizationCategory('clothing'); setStudioSection('models'); }}><Box size={19} /><span>Clothing</span></button>
            <button type="button" className={`character-dock-tab${customizationCategory === 'accessories' ? ' active' : ''}`} aria-label="Extras" title="Extras" aria-pressed={customizationCategory === 'accessories'} onClick={() => { setCustomizationCategory('accessories'); setStudioSection('models'); }}><Star size={19} /><span>Extras</span></button>
            <button type="button" className={`character-dock-tab${customizationCategory === 'body' && morphMode === 'advanced' ? ' active' : ''}`} aria-label="Advanced morphs" title="Advanced morphs" aria-pressed={customizationCategory === 'body' && morphMode === 'advanced'} onClick={() => { setCustomizationCategory('body'); setMorphMode('advanced'); setStudioSection('models'); if (hasCharacter) setMorphPreviewEnabled(true); }}><Settings size={19} /><span>Advanced</span></button>
          </nav>
          <div className="character-dock-scroll">
            {studioSection === 'models' && customizationCategory === 'body' ? <>
              <section className="morph-editor-section" aria-label="Character morphs">
                <header className="morph-editor-heading">
                  <div><strong>Character morphs</strong><small>{visibleMorphControlCount} available controls</small></div>
                  {controls.length > 0 && <span className={`morph-save-status${morphsDirty || draftSaveStatus === 'error' ? ' is-dirty' : ''}`}>{morphsBaked ? 'Baked' : serverMorphsNeedAssembly ? 'Live preview unavailable' : hasCharacter ? morphsDirty ? 'Unsaved' : 'Saved in Blender' : project ? morphInteractionActive ? 'Editing' : draftSaveStatus === 'saving' ? 'Saving draft…' : draftSaveStatus === 'error' ? 'Draft save failed' : morphsDirty ? 'Unsaved' : 'Draft saved' : 'Preview only'}</span>}
                </header>
                {morphControlsLoading && controls.length === 0 && <p className="morph-controls-status" role="status">Loading character controls…</p>}
                {morphControlsError && <div className="morph-controls-status is-error" role="alert">
                  <span>{morphControlsError}</span>
                  <button
                    className="initial-data-retry"
                    type="button"
                    disabled={morphControlsLoading || running}
                    onClick={retryMorphControls}
                  >{morphControlsLoading ? 'Retrying…' : 'Retry character controls'}</button>
                </div>}
                {project && !hasCharacter && <div className="morph-server-save">
                  <small>{bodyPresetDirty
                    ? 'Preset selection is saved in this draft and compiled to Blender only when you save the project.'
                    : morphInteractionActive
                      ? 'Preview updates live; draft saves when you release the slider.'
                      : draftSaveStatus === 'saving'
                        ? 'Saving draft values…'
                        : draftSaveStatus === 'error'
                          ? draftSaveError
                          : morphsDirty
                            ? 'Draft changes waiting to save.'
                            : 'Slider values are saved in this draft automatically.'}</small>
                  {draftSaveStatus === 'error' && <button
                    className="save-cc3-morphs morph-save-button"
                    type="button"
                    onClick={() => { setDraftSaveStatus('saving'); setDraftSaveRetry((attempt) => attempt + 1); }}
                  >Retry draft save</button>}
                  {serverMorphsNeedAssembly && <small>Live draft deformation requires the verified local CC5 proxy. Sliders stay disabled; Blender will not start until final compile.</small>}
                </div>}
                {hasCharacter && (morphPreviewMode === 'server' || hasCc5ClientMorphProxy) && !morphsBaked && <div className="morph-server-save">
                  <button
                  className="save-cc3-morphs morph-save-button"
                  type="button"
                  disabled={running || (!morphsDirty && !bodyPresetDirty)}
                  onClick={() => void runAction(saveMorphs)}
                  >Save changes to Blender</button>
                  <small>{bodyPresetDirty
                    ? 'The preview is temporary. Save applies the character preset and current sliders to Blender.'
                    : hasCc5ClientMorphProxy
                      ? 'Slider changes update a local high-detail proxy. Save applies them to Blender.'
                      : 'Slider changes preview automatically. Save applies them to Blender.'}</small>
                  {(hasCc5ClientMorphProxy ? clientMorphPreviewStatus : serverMorphPreviewStatus) === 'updating' && <small className="morph-preview-progress" role="status">{hasCc5ClientMorphProxy ? 'Updating local proxy…' : 'Updating preview…'}</small>}
                  {(hasCc5ClientMorphProxy ? clientMorphPreviewStatus : serverMorphPreviewStatus) === 'error' && <small className="morph-preview-error" role="alert">{hasCc5ClientMorphProxy ? clientMorphPreviewError : serverMorphPreviewError}</small>}
                </div>}
                {controls.length > 0 ? <>
                  <div className="morph-workspace">
                    <nav className="morph-anatomy-nav" aria-label="Morph anatomy categories">
                      <strong>Categories</strong>
                      {morphAreas.map((area) => {
                        const Icon = area.icon;
                        return <button
                          key={area.id}
                          type="button"
                          className={`morph-anatomy-option${selectedBodyArea === area.id ? ' active' : ''}`}
                          aria-pressed={selectedBodyArea === area.id}
                          onClick={() => {
                            setSelectedBodyArea(area.id);
                            setSelectedBodyMorphGroupId(null);
                            setSelectedEarMorphGroupId(null);
                            setSelectedHeadMorphGroupId(null);
                            setSelectedFaceMorphGroupId(null);
                            setSelectedOtherMorphGroupId(null);
                            setSelectedMorphId(null);
                            setMorphSearch('');
                            setMorphLibraryView('all');
                            setMorphTypeFilter('all');
                          }}
                        >
                          <Icon size={20} aria-hidden="true" />
                          <span>{area.label}</span>
                          <small>{area.count}</small>
                        </button>;
                      })}
                    </nav>
                    <section className="morph-library-pane" aria-label={`${morphSearch.trim() ? 'Search results' : activeBodyArea?.label ?? 'Character'} morph library`} data-ai-guide-target={activeBodyArea?.id === 'presets' ? 'preset-library' : 'morph-library'}>
                      <header className="morph-library-heading">
                        <div>
                          {activeBodyArea?.id === 'body' && activeBodyMorphGroup && !morphSearch.trim()
                            ? <div className="morph-library-breadcrumb">
                              <button type="button" onClick={() => {
                                setSelectedBodyMorphGroupId(null);
                                setSelectedMorphId(null);
                              }}><ArrowLeft size={13} /> Body</button>
                              <ChevronRight size={13} aria-hidden="true" />
                              <h2>{activeBodyMorphGroup.label}</h2>
                            </div>
                            : activeBodyArea?.id === 'head' && activeHeadMorphGroup && !morphSearch.trim()
                            ? <div className="morph-library-breadcrumb">
                              <button type="button" onClick={() => {
                                setSelectedHeadMorphGroupId(null);
                                setSelectedMorphId(null);
                              }}><ArrowLeft size={13} /> Head</button>
                              <ChevronRight size={13} aria-hidden="true" />
                              <h2>{activeHeadMorphGroup.label}</h2>
                            </div>
                            : activeBodyArea?.id === 'face' && activeFaceMorphGroup && !morphSearch.trim()
                            ? <div className="morph-library-breadcrumb">
                              <button type="button" onClick={() => {
                                setSelectedFaceMorphGroupId(null);
                                setSelectedMorphId(null);
                              }}><ArrowLeft size={13} /> Face</button>
                              <ChevronRight size={13} aria-hidden="true" />
                              <h2>{activeFaceMorphGroup.label}</h2>
                            </div>
                            : activeBodyArea?.id === 'eyes' && activeEyeMorphGroup && !morphSearch.trim()
                            ? <div className="morph-library-breadcrumb">
                              <button type="button" onClick={() => {
                                setSelectedEyeMorphGroupId(null);
                                setSelectedMorphId(null);
                              }}><ArrowLeft size={13} /> Eyes</button>
                              <ChevronRight size={13} aria-hidden="true" />
                              <h2>{activeEyeMorphGroup.label}</h2>
                            </div>
                            : activeOtherMorphGroup && isOtherMorphAreaId(activeBodyArea?.id) && !morphSearch.trim()
                            ? <div className="morph-library-breadcrumb">
                              <button type="button" onClick={() => {
                                setSelectedOtherMorphGroupId(null);
                                setSelectedMorphId(null);
                              }}><ArrowLeft size={13} /> {activeBodyArea?.label ?? 'Morphs'}</button>
                              <ChevronRight size={13} aria-hidden="true" />
                              <h2>{activeOtherMorphGroup.label}</h2>
                            </div>
                            : activeBodyArea?.id === 'ears' && activeEarMorphGroup && !morphSearch.trim()
                            ? <div className="morph-library-breadcrumb">
                              <button type="button" onClick={() => {
                                setSelectedEarMorphGroupId(null);
                                setSelectedMorphId(null);
                              }}><ArrowLeft size={13} /> Ears</button>
                              <ChevronRight size={13} aria-hidden="true" />
                              <h2>{activeEarMorphGroup.label}</h2>
                            </div>
                            : <h2>{morphSearch.trim() ? 'Search Results' : activeBodyArea?.id === 'presets' ? 'Presets' : `${activeBodyArea?.label ?? 'Character'} Morphs`}</h2>}
                          <p>{morphSearch.trim()
                            ? `${visibleLibraryControls.length} matching controls across all anatomy categories.`
                            : activeBodyMorphGroup && activeBodyArea?.id === 'body'
                              ? activeBodyMorphGroup.description
                            : activeHeadMorphGroup && activeBodyArea?.id === 'head'
                              ? activeHeadMorphGroup.description
                            : activeFaceMorphGroup && activeBodyArea?.id === 'face'
                              ? activeFaceMorphGroup.description
                            : activeEyeMorphGroup && activeBodyArea?.id === 'eyes'
                              ? activeEyeMorphGroup.description
                            : activeOtherMorphGroup
                              ? activeOtherMorphGroup.description
                            : activeEarMorphGroup && activeBodyArea?.id === 'ears'
                              ? activeEarMorphGroup.description
                            : activeBodyArea?.id === 'presets'
                              ? 'Character presets will be available here.'
                              : `Adjust ${activeBodyArea?.label.toLocaleLowerCase() ?? 'character'} shape, proportions and details.`}</p>
                        </div>
                        <div className="morph-mode-switch" role="group" aria-label="Morph editor mode">
                          <button type="button" className={morphMode === 'basic' ? 'active' : ''} aria-pressed={morphMode === 'basic'} onClick={() => setMorphMode('basic')}><Zap size={14} /> Basic</button>
                          <button type="button" className={morphMode === 'advanced' ? 'active' : ''} aria-pressed={morphMode === 'advanced'} onClick={() => setMorphMode('advanced')}><SlidersHorizontal size={14} /> Advanced</button>
                        </div>
                      </header>
                      <label className="morph-search">
                        <Search size={16} aria-hidden="true" />
                        <input type="search" aria-label="Search morphs" placeholder="Search morphs..." value={morphSearch} onChange={(event) => setMorphSearch(event.target.value)} />
                        {morphSearch && <button type="button" aria-label="Clear morph search" onClick={() => setMorphSearch('')}><X size={14} /></button>}
                      </label>
                      <div className="morph-type-filters" role="group" aria-label="Filter morph type">
                        {MORPH_TYPE_FILTERS.map(({ id, label }) => <button
                          key={id}
                          type="button"
                          className={morphTypeFilter === id ? 'active' : ''}
                          aria-pressed={morphTypeFilter === id}
                          onClick={() => setMorphTypeFilter(id)}
                        >{label}</button>)}
                      </div>
                      <div className="morph-library-filters" role="group" aria-label="Filter morph library">
                        {([
                          ['all', 'All', morphLibraryCounts.all],
                          ['favorites', 'Favorites', morphLibraryCounts.favorites],
                          ['recent', 'Recent', morphLibraryCounts.recent],
                        ] as const).map(([view, label, count]) => <button key={view} type="button" className={morphLibraryView === view ? 'active' : ''} aria-pressed={morphLibraryView === view} onClick={() => setMorphLibraryView(view)}>{label}<small>{count}</small></button>)}
                      </div>
                      <div className="morph-card-grid">
                        {isBodyMorphRoot && visibleBodyMorphGroups.map((group) => {
                          const Icon = BODY_MORPH_GROUP_ICONS[group.id];
                          return <article className="morph-card morph-group-card" key={group.id}>
                            <button
                              className="morph-card-select morph-group-card-select"
                              type="button"
                              aria-label={`Open ${group.label}, ${group.count} morphs`}
                              onClick={() => {
                                setSelectedBodyMorphGroupId(group.id);
                                setSelectedMorphId(null);
                              }}
                            >
                              <span className="morph-group-icon"><Icon size={20} strokeWidth={1.7} aria-hidden="true" /></span>
                              <strong title={group.label}>{group.label}</strong>
                              <small>{group.count} {group.count === 1 ? 'morph' : 'morphs'}</small>
                              <span className="morph-group-description">{group.description}</span>
                            </button>
                          </article>;
                        })}
                        {isHeadMorphRoot && visibleHeadMorphGroups.map((group) => {
                          const Icon = HEAD_MORPH_GROUP_ICONS[group.id];
                          return <article className="morph-card morph-group-card" key={group.id}>
                            <button
                              className="morph-card-select morph-group-card-select"
                              type="button"
                              aria-label={`Open ${group.label}, ${group.count} morphs`}
                              onClick={() => {
                                setSelectedHeadMorphGroupId(group.id);
                                setSelectedMorphId(null);
                              }}
                            >
                              <span className="morph-group-icon"><Icon size={20} strokeWidth={1.7} aria-hidden="true" /></span>
                              <strong title={group.label}>{group.label}</strong>
                              <small>{group.count} {group.count === 1 ? 'morph' : 'morphs'}</small>
                              <span className="morph-group-description">{group.description}</span>
                            </button>
                          </article>;
                        })}
                        {isFaceMorphRoot && visibleFaceMorphGroups.map((group) => {
                          const Icon = FACE_MORPH_GROUP_ICONS[group.id];
                          return <article className="morph-card morph-group-card" key={group.id}>
                            <button
                              className="morph-card-select morph-group-card-select"
                              type="button"
                              aria-label={`Open ${group.label}, ${group.count} morphs`}
                              onClick={() => {
                                setSelectedFaceMorphGroupId(group.id);
                                setSelectedMorphId(null);
                              }}
                            >
                              <span className="morph-group-icon"><Icon size={20} strokeWidth={1.7} aria-hidden="true" /></span>
                              <strong title={group.label}>{group.label}</strong>
                              <small>{group.count} {group.count === 1 ? 'morph' : 'morphs'}</small>
                              <span className="morph-group-description">{group.description}</span>
                            </button>
                          </article>;
                        })}
                        {isEyeMorphRoot && visibleEyeMorphGroups.map((group) => {
                          const Icon = EYE_MORPH_GROUP_ICONS[group.id];
                          return <article className="morph-card morph-group-card" key={group.id}>
                            <button
                              className="morph-card-select morph-group-card-select"
                              type="button"
                              aria-label={`Open ${group.label}, ${group.count} morphs`}
                              onClick={() => {
                                setSelectedEyeMorphGroupId(group.id);
                                setSelectedMorphId(null);
                              }}
                            >
                              <span className="morph-group-icon"><Icon size={20} strokeWidth={1.7} aria-hidden="true" /></span>
                              <strong title={group.label}>{group.label}</strong>
                              <small>{group.count} {group.count === 1 ? 'morph' : 'morphs'}</small>
                              <span className="morph-group-description">{group.description}</span>
                            </button>
                          </article>;
                        })}
                        {isOtherMorphRoot && visibleOtherMorphGroups.map((group) => {
                          const Icon = OTHER_MORPH_GROUP_ICONS[group.id];
                          return <article className="morph-card morph-group-card" key={group.id}>
                            <button
                              className="morph-card-select morph-group-card-select"
                              type="button"
                              aria-label={`Open ${group.label}, ${group.count} morphs`}
                              onClick={() => {
                                setSelectedOtherMorphGroupId(group.id);
                                setSelectedMorphId(null);
                              }}
                            >
                              <span className="morph-group-icon"><Icon size={20} strokeWidth={1.7} aria-hidden="true" /></span>
                              <strong title={group.label}>{group.label}</strong>
                              <small>{group.count} {group.count === 1 ? 'morph' : 'morphs'}</small>
                              <span className="morph-group-description">{group.description}</span>
                            </button>
                          </article>;
                        })}
                        {isEarMorphRoot && visibleEarMorphGroups.map((group) => {
                          const Icon = EAR_MORPH_GROUP_ICONS[group.id];
                          return <article className="morph-card morph-group-card" key={group.id}>
                            <button
                              className="morph-card-select morph-group-card-select"
                              type="button"
                              aria-label={`Open ${group.label}, ${group.count} morphs`}
                              onClick={() => {
                                setSelectedEarMorphGroupId(group.id);
                                setSelectedMorphId(null);
                              }}
                            >
                              <span className="morph-group-icon"><Icon size={20} strokeWidth={1.7} aria-hidden="true" /></span>
                              <strong title={group.label}>{group.label}</strong>
                              <small>{group.count} {group.count === 1 ? 'morph' : 'morphs'}</small>
                              <span className="morph-group-description">{group.description}</span>
                            </button>
                          </article>;
                        })}
                        {activeBodyArea?.id === 'presets' && bodyPresets.map((preset) => {
                          const selected = activeBodyPresetIds[preset.kind] === preset.id;
                          return <article className={`morph-card${selected ? ' selected' : ''} morph-card--custom-art morph-card--labeled-art`} key={preset.id} data-ai-guide-target={`preset:${preset.id}`}>
                            <button
                              className="morph-card-select"
                              type="button"
                              aria-label={`${selected ? 'Undo' : 'Apply'} ${preset.label}`}
                              aria-pressed={selected}
                              disabled={!project || !isCc5FullMorphAsset || hasCharacter || running || appearanceSaving}
                              onClick={() => void runAction(() => selectDraftPreset(preset.kind, selected ? null : preset.id))}
                            >
                              <span className="morph-card-art has-custom-art"><Sparkles size={48} strokeWidth={1.15} aria-hidden="true" /></span>
                              <strong title={preset.label}>{preset.label}</strong>
                              {selected && <small>{bodyPresetDirty ? 'Draft' : 'Saved'}</small>}
                            </button>
                          </article>;
                        })}
                        {!isBodyMorphRoot && !isEarMorphRoot && !isHeadMorphRoot && !isFaceMorphRoot && !isEyeMorphRoot && !isOtherMorphRoot && displayedLibraryControls.map((control) => {
                          const Icon = morphAreas.find(({ id }) => id === morphAreaForControl(control))?.icon ?? PersonStanding;
                          const hasShoulderFrontCreaseArtwork = /shoulder.*front.*crease/i.test(`${control.id} ${control.label}`);
                          const customArtworkSrc = hasShoulderFrontCreaseArtwork
                            ? '/shoulder_front_crease_icon.png'
                            : MORPH_CARD_ARTWORK[control.id];
                          const hasCustomArtwork = Boolean(customArtworkSrc);
                          const value = morphs[control.id] ?? 0;
                          const favorite = favoriteMorphIds.includes(control.id);
                          const label = morphDisplayLabel(control.label);
                          const controlArea = morphAreaForControl(control);
                          const resultGroup = controlArea === 'ears'
                            ? EAR_MORPH_GROUPS.find(({ id }) => id === earMorphGroupForControl(control))?.label
                            : controlArea === 'body'
                              ? BODY_MORPH_GROUPS.find(({ id }) => id === bodyMorphGroupForControl(control))?.label
                              : controlArea === 'head'
                                ? HEAD_MORPH_GROUPS.find(({ id }) => id === headMorphGroupForControl(control))?.label
                              : controlArea === 'face'
                                ? FACE_MORPH_GROUPS.find(({ id }) => id === faceMorphGroupForControl(control))?.label
                              : controlArea === 'eyes'
                                ? EYE_MORPH_GROUPS.find(({ id }) => id === eyeMorphGroupForControl(control))?.label
                              : isOtherMorphAreaId(controlArea)
                                ? OTHER_MORPH_GROUPS[controlArea].find(({ id }) => id === otherMorphGroupForControl(controlArea, control))?.label
                              : morphAreas.find(({ id }) => id === controlArea)?.label;
                          return <article className={`morph-card${selectedMorph?.id === control.id ? ' selected' : ''}${hasCustomArtwork ? ' morph-card--custom-art morph-card--labeled-art' : ''}`} key={control.id}>
                            <button
                              className="morph-card-select"
                              type="button"
                              aria-label={`Select ${label}`}
                              aria-pressed={selectedMorph?.id === control.id}
                              onClick={() => selectMorphControl(control)}
                            >
                              <span className={`morph-card-art morph-area-${morphAreaForControl(control)}${hasCustomArtwork ? ' has-custom-art' : ''}`}>{customArtworkSrc
                                ? <img src={customArtworkSrc} alt="" aria-hidden="true" />
                                : <Icon size={48} strokeWidth={1.15} aria-hidden="true" />}</span>
                              <strong title={label}>{label}</strong>
                              {morphSearch.trim() && <small className="morph-card-group-label">{resultGroup ?? 'Other'}</small>}
                              {value !== 0 && <small>{value > 0 ? '+' : ''}{(value * 100).toFixed(0)}%</small>}
                            </button>
                            <button
                              className={`morph-card-favorite${favorite ? ' active' : ''}`}
                              type="button"
                              aria-label={`${favorite ? 'Remove' : 'Add'} ${label} ${favorite ? 'from' : 'to'} favorites`}
                              aria-pressed={favorite}
                              onClick={() => toggleMorphFavorite(control.id)}
                            ><Star size={15} fill={favorite ? 'currentColor' : 'none'} /></button>
                          </article>;
                        })}
                        {activeBodyArea?.id === 'presets' && bodyPresets.length === 0
                          ? <p className="morph-library-empty">{isCc5FullMorphAsset
                            ? 'CC5/CC3+ presets are not installed or their local proxy needs to be rebuilt.'
                            : 'Select a CC5/CC3+ character to use these presets.'}</p>
                          : activeBodyArea?.id !== 'presets' && visibleLibraryControls.length === 0
                            && <p className="morph-library-empty">{morphLibraryView === 'favorites' ? 'No favorite morphs in this category yet. Star a control to save it here.' : morphLibraryView === 'recent' ? 'Morphs you adjust will appear here.' : 'No matching morph controls.'}</p>}
                        {morphMode === 'basic' && !isBodyMorphRoot && !isEarMorphRoot && !isHeadMorphRoot && !isFaceMorphRoot && !isEyeMorphRoot && !isOtherMorphRoot && visibleLibraryControls.length > displayedLibraryControls.length && <button className="morph-show-advanced" type="button" onClick={() => setMorphMode('advanced')}>Show all {visibleLibraryControls.length} controls <ChevronRight size={15} /></button>}
                      </div>
                      {activeBodyArea?.id !== 'presets' && bodyPresets.length > 0 && <section className="active-presets" aria-label="Active character presets">
                        <header><strong>Active Presets</strong><span>{Number(activeBodyPresetIds.body !== null) + Number(activeBodyPresetIds.head !== null)}</span></header>
                        <div className="active-preset-list">
                          {bodyPresets.filter(({ id, kind }) => activeBodyPresetIds[kind] === id).map((preset) => (
                            <button
                              className="active-preset-card"
                              key={preset.id}
                              type="button"
                              disabled={!project || hasCharacter || running || appearanceSaving}
                              aria-label={`Remove ${preset.label}`}
                              onClick={() => void runAction(() => selectDraftPreset(preset.kind, null))}
                            ><Sparkles size={16} /><span>{preset.label}</span><X size={12} /></button>
                          ))}
                          <button
                            className="active-preset-add"
                            type="button"
                            onClick={() => {
                              setSelectedBodyArea('presets');
                              setSelectedBodyMorphGroupId(null);
                              setSelectedHeadMorphGroupId(null);
                              setSelectedFaceMorphGroupId(null);
                              setSelectedEyeMorphGroupId(null);
                              setSelectedOtherMorphGroupId(null);
                              setSelectedMorphId(null);
                            }}
                          ><Plus size={16} /><span>Add</span></button>
                        </div>
                      </section>}
                    </section>
                    <aside className="morph-detail-pane" aria-label="Selected morph details">
                      {isCc5FullMorphAsset && activeBodyArea?.id === 'ears' && <section className="morph-ear-preset" aria-label="Elven ear preset">
                        <header><strong>Elven Ears</strong><small>CC3+ native morphs</small></header>
                        <p>Applies verified pointed-ear, height, and angle morphs. Adjust the ear sliders below to refine the shape.</p>
                        <button
                          className="morph-reset-category"
                          type="button"
                          disabled={!elvenEarPresetAvailable || morphControlsDisabled || running}
                          onClick={applyElvenEarPresetToDraft}
                        ><Sparkles size={14} /> {elvenEarPresetApplied ? 'Reapply Elven Ears' : 'Apply Elven Ears'}</button>
                        {!elvenEarPresetAvailable && <small className="morph-ear-preset-unavailable" role="status">{controls.length > 0
                          ? 'Required native ear morphs are not available for this CC3+ asset.'
                          : 'Loading the CC3+ ear morph controls…'}</small>}
                      </section>}
                      {activeBodyArea?.id === 'presets' ? <>
                        <header className="morph-detail-heading">
                          <div><Sparkles size={24} aria-hidden="true" /><strong>{bodyPresets
                            .filter(({ id, kind }) => activeBodyPresetIds[kind] === id)
                            .map(({ label }) => label)
                            .join(' + ') || 'Character Presets'}</strong></div>
                        </header>
                        <p className="morph-library-empty">Choose one body and one head shape. Both preview together and compile in Blender when you save the project.</p>
                        {bodyPresetDirty && <button
                          className="morph-reset-category"
                          type="button"
                          disabled={running || appearanceSaving}
                          onClick={() => void runAction(() => clearDraftPresets())}
                        ><RotateCcw size={15} /> Clear presets</button>}
                      </> : isBodyMorphRoot ? <>
                        <header className="morph-detail-heading">
                          <div><PersonStanding size={24} aria-hidden="true" /><strong>Browse body morphs</strong></div>
                        </header>
                        <div className="morph-detail-illustration morph-area-body" aria-hidden="true">
                          <PersonStanding size={92} strokeWidth={0.9} />
                        </div>
                        <p className="morph-library-empty">Choose a body region or function to browse its morphs. Search also finds controls across every body group.</p>
                      </> : isEarMorphRoot ? <>
                        <header className="morph-detail-heading">
                          <div><Ear size={24} aria-hidden="true" /><strong>Browse ear morphs</strong></div>
                        </header>
                        <div className="morph-detail-illustration morph-area-ears" aria-hidden="true">
                          <Ear size={92} strokeWidth={0.9} />
                        </div>
                        <p className="morph-library-empty">Choose an anatomical group to browse its morphs. Search also finds ear controls across every group.</p>
                      </> : isHeadMorphRoot ? <>
                        <header className="morph-detail-heading">
                          <div><ScanFace size={24} aria-hidden="true" /><strong>Browse head morphs</strong></div>
                        </header>
                        <div className="morph-detail-illustration morph-area-head" aria-hidden="true">
                          <ScanFace size={92} strokeWidth={0.9} />
                        </div>
                        <p className="morph-library-empty">Choose a head region or function to browse its morphs. Search also finds controls across all anatomy categories.</p>
                      </> : isFaceMorphRoot ? <>
                        <header className="morph-detail-heading">
                          <div><ScanFace size={24} aria-hidden="true" /><strong>Browse face morphs</strong></div>
                        </header>
                        <div className="morph-detail-illustration morph-area-face" aria-hidden="true">
                          <ScanFace size={92} strokeWidth={0.9} />
                        </div>
                        <p className="morph-library-empty">Choose a face region or function to browse its morphs. Search also finds controls across all anatomy categories.</p>
                      </> : isEyeMorphRoot ? <>
                        <header className="morph-detail-heading">
                          <div><Eye size={24} aria-hidden="true" /><strong>Browse eye morphs</strong></div>
                        </header>
                        <div className="morph-detail-illustration morph-area-eyes" aria-hidden="true">
                          <Eye size={92} strokeWidth={0.9} />
                        </div>
                        <p className="morph-library-empty">Choose an eye region or function to browse its morphs. Search also finds controls across all anatomy categories.</p>
                      </> : isOtherMorphRoot ? <>
                        <header className="morph-detail-heading">
                          <div>
                            {(() => {
                              const Icon = morphAreas.find(({ id }) => id === activeBodyArea?.id)?.icon ?? PersonStanding;
                              return <Icon size={24} aria-hidden="true" />;
                            })()}
                            <strong>Browse {activeBodyArea?.label.toLocaleLowerCase() ?? 'character'} morphs</strong>
                          </div>
                        </header>
                        <div className={`morph-detail-illustration morph-area-${activeBodyArea?.id ?? 'body'}`} aria-hidden="true">
                          {(() => {
                            const Icon = morphAreas.find(({ id }) => id === activeBodyArea?.id)?.icon ?? PersonStanding;
                            return <Icon size={92} strokeWidth={0.9} />;
                          })()}
                        </div>
                        <p className="morph-library-empty">Choose a group to browse its morphs. Search also finds controls across all groups.</p>
                      </> : selectedMorph ? <>
                        <header className="morph-detail-heading">
                          <div>
                            {(() => {
                              const Icon = morphAreas.find(({ id }) => id === morphAreaForControl(selectedMorph))?.icon ?? PersonStanding;
                              return <Icon size={24} aria-hidden="true" />;
                            })()}
                            <strong>{morphDisplayLabel(selectedMorph.label)}</strong>
                          </div>
                          <button type="button" className="morph-reset-button" disabled={morphControlsDisabled || (morphs[selectedMorph.id] ?? 0) === 0} onClick={resetSelectedMorph}><RotateCcw size={13} /> Reset</button>
                        </header>
                        <div className={`morph-detail-illustration morph-area-${morphAreaForControl(selectedMorph)}`} aria-hidden="true">
                          {(() => {
                            const Icon = morphAreas.find(({ id }) => id === morphAreaForControl(selectedMorph))?.icon ?? PersonStanding;
                            return <Icon size={118} strokeWidth={0.8} />;
                          })()}
                        </div>
                        <label className="morph-detail-slider-label" htmlFor={morphInputId(selectedMorph.id, 'selected-morph')}>Morph amount</label>
                        <div className="morph-detail-slider" data-ai-guide-target={`morph:${selectedMorph.id}`}>
                          <input
                            id={morphInputId(selectedMorph.id, 'selected-morph')}
                            aria-label={`${morphDisplayLabel(selectedMorph.label)} amount`}
                            type="range"
                            min={selectedMorph.minimum}
                            max={selectedMorph.maximum}
                            step="0.01"
                            value={morphs[selectedMorph.id] ?? 0}
                            disabled={morphControlsDisabled}
                            onPointerDown={beginMorphInteraction}
                            onPointerUp={endMorphInteraction}
                            onPointerCancel={endMorphInteraction}
                            onKeyDown={beginMorphInteraction}
                            onKeyUp={endMorphInteraction}
                            onBlur={endMorphInteraction}
                            onChange={(event) => updateMorph(selectedMorph.id, Number(event.target.value))}
                          />
                          <output htmlFor={morphInputId(selectedMorph.id, 'selected-morph')}>{((morphs[selectedMorph.id] ?? 0) * 100).toFixed(0)}%</output>
                        </div>
                        <small className="morph-detail-range">Range: {selectedMorph.minimum.toFixed(2)} to {selectedMorph.maximum.toFixed(2)}</small>
                        <section className="morph-related" aria-label="Related morphs">
                          <header><strong>Related Morphs</strong><small>{morphAreas.find(({ id }) => id === morphAreaForControl(selectedMorph))?.label ?? 'Other'}</small></header>
                          {relatedMorphs.length > 0 ? relatedMorphs.map((control) => (
                            <div className="morph-related-control" key={control.id}>
                              <button type="button" onClick={() => setSelectedMorphId(control.id)} title={`Select ${morphDisplayLabel(control.label)}`}>
                                <span>{morphDisplayLabel(control.label)}</span>
                                <small>{((morphs[control.id] ?? 0) * 100).toFixed(0)}%</small>
                              </button>
                              <input
                                aria-label={`${morphDisplayLabel(control.label)} amount`}
                                type="range"
                                min={control.minimum}
                                max={control.maximum}
                                step="0.01"
                                value={morphs[control.id] ?? 0}
                                disabled={morphControlsDisabled}
                                onPointerDown={beginMorphInteraction}
                                onPointerUp={endMorphInteraction}
                                onPointerCancel={endMorphInteraction}
                                onKeyDown={beginMorphInteraction}
                                onKeyUp={endMorphInteraction}
                                onBlur={endMorphInteraction}
                                onChange={(event) => updateMorph(control.id, Number(event.target.value))}
                              />
                            </div>
                          )) : <p className="morph-related-empty">No related controls in this category.</p>}
                        </section>
                      </> : <p className="morph-library-empty">Choose a morph to see its controls.</p>}
                      <button className="morph-reset-category" type="button" disabled={!activeCategoryHasChanges || morphControlsDisabled} onClick={resetMorphArea}><RotateCcw size={15} /> Reset {activeBodyMorphGroup && activeBodyArea?.id === 'body' ? activeBodyMorphGroup.label : activeHeadMorphGroup && activeBodyArea?.id === 'head' ? activeHeadMorphGroup.label : activeFaceMorphGroup && activeBodyArea?.id === 'face' ? activeFaceMorphGroup.label : activeEyeMorphGroup && activeBodyArea?.id === 'eyes' ? activeEyeMorphGroup.label : activeOtherMorphGroup ? activeOtherMorphGroup.label : activeEarMorphGroup && activeBodyArea?.id === 'ears' ? activeEarMorphGroup.label : activeBodyArea?.label ?? 'Category'}</button>
                      <p className="morph-editor-note">{morphsBaked
                        ? 'This shape is baked into the mesh. Restore the pre-bake checkpoint to edit sliders again.'
                        : morphPreviewMode === 'server'
                          ? hasCharacter
                            ? 'Slider adjustments preview automatically. Save changes to keep them in the project.'
                            : 'Live draft deformation requires the verified local CC5 proxy. Draft values can still be saved; Blender starts only when you save / compile the project.'
                          : hasCharacter
                            ? 'Preview changes locally, then save or bake them to Blender.'
                            : 'Preview only · create a project to save or bake changes.'}</p>
                      {morphsBaked
                        ? <button className="save-cc3-morphs morph-save-button" type="button" disabled={running || !body?.bake_checkpoint_id} onClick={() => void runAction(restoreEditableMorphs)}>Restore editable morphs</button>
                        : hasCharacter && <div className={`morph-action-buttons${morphPreviewMode === 'server' ? ' server-morph-action-buttons' : ''}`}>
                          {morphPreviewMode !== 'server' && <button className="save-cc3-morphs morph-save-button" type="button" disabled={running || (!morphsDirty && !bodyPresetDirty)} onClick={() => void runAction(saveMorphs)}>Save changes to Blender</button>}
                          <button className="morph-bake-button" type="button" disabled={running || !hasNonNeutralMorphs} onClick={() => void runAction(bakeMorphs)}>Bake shape into mesh</button>
                        </div>}
                    </aside>
                  </div>
                </> : <p className="character-dock-unavailable">{baseModelsLoading ? 'Loading installed character controls…' : baseModelsError || 'No supported character model is available.'}</p>}
              </section>
            </> : <>
              {studioSection === 'models' ? <section className="character-dock-section category-empty-state" aria-label={`${customizationCategory} assets`}>
                <header className="character-dock-heading"><div><strong>{customizationCategory[0].toUpperCase() + customizationCategory.slice(1)}</strong></div></header>
                  {customizationCategory === 'eyes' ? <>
                    <div className="compatible-assets-heading" data-ai-guide-target="eye-library"><strong>Eye assets</strong><small>{eyeAssets.length} installed</small></div>
                    {eyeAssetsLoading && <p>Loading eye assets…</p>}
                    {eyeAssetsError && <div className="asset-catalog-error" role="alert">
                      <span>{eyeAssetsError}</span>
                      <button className="initial-data-retry" type="button" disabled={eyeAssetsLoading || running} onClick={() => setEyeAssetsRetry((retry) => retry + 1)}>Retry eye assets</button>
                    </div>}
                    {!project && <p className="compatible-assets-note">Create or select a draft project to save eye choices. Selecting an eye loads only its preview geometry in the browser.</p>}
                    {project && !hasCharacter && <p className="compatible-assets-note">Eye selection is a browser-only live preview saved to this draft. Blender loads the chosen eye only when you save / compile.</p>}
                    {project && hasCharacter && <p className="compatible-assets-note">This project is compiled. Create a new draft to preview different eye assets.</p>}
                    {selectedDraftEye && !hasCharacter && <button
                      className="morph-reset-category"
                      type="button"
                      disabled={running || appearanceSaving}
                      onClick={() => void runAction(() => selectDraftEye(null))}
                    ><RotateCcw size={15} /> Clear eye preview</button>}
                    {!eyeAssetsLoading && !eyeAssetsError && eyeAssets.length === 0 && <p>No integrity-verified eye assets are installed.</p>}
                    {!eyeAssetsLoading && <div className="compatible-assets-grid">
                      {eyeAssets.map((asset) => (
                        <article className="compatible-asset-card" key={asset.id} data-ai-guide-target={`eye:${asset.id}`}>
                          <strong>{asset.name}</strong>
                          <small>{asset.variant.replaceAll('_', ' ')}</small>
                          <span>{selectedDraftEye?.id === asset.id ? 'Live draft preview' : 'Preview asset'}</span>
                          <button
                            type="button"
                            disabled={!project || hasCharacter || running || appearanceSaving || selectedDraftEye?.id === asset.id}
                            onClick={() => void runAction(() => selectDraftEye(asset.id))}
                            title={!project ? 'Create or select a draft project first.' : hasCharacter ? 'Create a new draft to preview another eye.' : 'Preview this eye in the browser and save the choice to the draft'}
                          >
                            {appearanceSaving ? 'Saving draft…' : selectedDraftEye?.id === asset.id ? 'Preview selected' : 'Preview eye'}
                          </button>
                        </article>
                      ))}
                    </div>}
                  </> : customizationCategory === 'skin' ? <>
                    <div className="compatible-assets-heading" data-ai-guide-target="skin-library"><strong>Skin assets</strong><small>{skinAssets.length} installed</small></div>
                    {skinAssetsLoading && <p role="status">Loading skin assets…</p>}
                    {skinAssetsError && <div className="asset-catalog-error" role="alert">
                      <span>{skinAssetsError}</span>
                      <button className="initial-data-retry" type="button" disabled={skinAssetsLoading || running} onClick={() => setSkinAssetsRetry((retry) => retry + 1)}>Retry skin assets</button>
                    </div>}
                    {skinPreviewError && <p role="alert">{skinPreviewError}</p>}
                    {!project && <p className="compatible-assets-note">Create a CC3+ draft project to preview and save a skin choice.</p>}
                    {project && !hasCharacter && <p className="compatible-assets-note">Skin maps preview in the browser and are saved with this draft. Blender materials are applied only during Save / Compile.</p>}
                    {project && hasCharacter && <p className="compatible-assets-note">This project is compiled. Create a new draft to preview another skin.</p>}
                    {selectedDraftSkin && !hasCharacter && <button
                      className="morph-reset-category"
                      type="button"
                      disabled={running || appearanceSaving}
                      onClick={() => void runAction(() => selectDraftSkin(null))}
                    ><RotateCcw size={15} /> Clear skin preview</button>}
                    {selectedDraftSkin && <section className="skin-paint-tools" aria-label="Skin paint tools">
                      <header>
                        <div><strong>Paint on character</strong><small>{skinPaintStrokes.length} saved strokes</small></div>
                        <button
                          className={`skin-paint-toggle${skinPaintEnabled ? ' active' : ''}`}
                          type="button"
                          aria-pressed={skinPaintEnabled}
                          disabled={!project || hasCharacter || running || appearanceSaving}
                          onClick={() => {
                            setSkinPaintPointerOnModel(false);
                            setSkinPaintEnabled((enabled) => !enabled);
                          }}
                        ><Palette size={14} />{skinPaintEnabled ? 'Done painting' : 'Paint mode'}</button>
                      </header>
                      <p>Enable paint mode, then drag on the character. Paint across the head, body, arms, or legs. Choose Freckles for scattered marks; pen pressure varies size and opacity.</p>
                      <div className="skin-paint-controls">
                        <div className="skin-paint-tool-switch" role="group" aria-label="Paint tool">
                          <button type="button" className={skinPaintTool === 'paint' ? 'active' : ''} aria-pressed={skinPaintTool === 'paint'} onClick={() => setSkinPaintTool('paint')}>Paint</button>
                          <button type="button" className={skinPaintTool === 'freckles' ? 'active' : ''} aria-pressed={skinPaintTool === 'freckles'} onClick={() => setSkinPaintTool('freckles')}>Freckles</button>
                          <button type="button" className={skinPaintTool === 'erase' ? 'active' : ''} aria-pressed={skinPaintTool === 'erase'} onClick={() => setSkinPaintTool('erase')}>Erase</button>
                        </div>
                        <label className="skin-paint-color"><span>Color</span><input aria-label="Paint color" type="color" value={skinPaintColor} onChange={(event) => setSkinPaintColor(event.target.value)} /></label>
                        <label className="skin-paint-range"><span>Brush <output>{skinPaintSize}px</output></span><input aria-label="Brush size" type="range" min="1" max="96" step="1" value={skinPaintSize} onChange={(event) => setSkinPaintSize(Number(event.target.value))} /></label>
                        <label className="skin-paint-range"><span>Opacity <output>{skinPaintOpacity}%</output></span><input aria-label="Brush opacity" type="range" min="1" max="100" step="1" value={skinPaintOpacity} onChange={(event) => setSkinPaintOpacity(Number(event.target.value))} /></label>
                      </div>
                      <div className="skin-paint-actions">
                        <button type="button" disabled={!skinPaintStrokes.length || running || appearanceSaving || hasCharacter} onClick={() => void runAction(() => saveSkinPaintStrokes(skinPaintStrokes.slice(0, -1)))}><RotateCcw size={13} /> Undo stroke</button>
                        <button type="button" disabled={!skinPaintStrokes.length || running || appearanceSaving || hasCharacter} onClick={() => void runAction(() => saveSkinPaintStrokes([]))}>Clear paint</button>
                        {appearanceSaving && <small role="status">Saving draft…</small>}
                      </div>
                    </section>}
                    {selectedDraftSkin && <section className="semantic-skin-editor" aria-label="Semantic skin properties">
                      <header className="semantic-skin-heading">
                        <div><strong>Skin properties</strong><small>Live preview · saved with the draft</small></div>
                        <span className={`semantic-skin-status${skinDefinitionDirty ? ' is-dirty' : ''}`}>
                          {skinDefinitionSaving ? 'Saving…' : skinDefinitionDirty ? 'Unsaved' : 'Saved'}
                        </span>
                      </header>
                      <p className="compatible-assets-note">Tone, undertone, roughness, and repeatable head-map freckles preview on the selected skin. Precise cheek/nose masks and other advanced skin features are not available yet.</p>
                      <div className="semantic-skin-controls">
                        <label className="skin-paint-range">
                          <span>Tone <output>{skinDefinitionDraft.base.tone.toFixed(2)}</output></span>
                          <input
                            aria-label="Skin tone"
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            value={skinDefinitionDraft.base.tone}
                            disabled={hasCharacter || running || skinDefinitionSaving}
                            onChange={(event) => updateSkinDefinition({ base: { tone: Number(event.target.value) } })}
                          />
                        </label>
                        <label>
                          <span>Undertone</span>
                          <select
                            aria-label="Skin undertone"
                            value={skinDefinitionDraft.base.undertone}
                            disabled={hasCharacter || running || skinDefinitionSaving}
                            onChange={(event) => updateSkinDefinition({
                              base: { undertone: event.target.value as SkinDefinition['base']['undertone'] },
                            })}
                          >
                            <option value="cool">Cool</option>
                            <option value="neutral">Neutral</option>
                            <option value="warm">Warm</option>
                            <option value="olive">Olive</option>
                          </select>
                        </label>
                        <label className="skin-paint-range">
                          <span>Roughness <output>{skinDefinitionDraft.surface.roughness.toFixed(2)}</output></span>
                          <input
                            aria-label="Skin roughness"
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            value={skinDefinitionDraft.surface.roughness}
                            disabled={hasCharacter || running || skinDefinitionSaving}
                            onChange={(event) => updateSkinDefinition({ surface: { roughness: Number(event.target.value) } })}
                          />
                        </label>
                      </div>
                      <div className="semantic-skin-feature">
                        <div className="semantic-skin-feature-heading">
                          <strong>Freckles</strong>
                          <small>Head skin UV map</small>
                        </div>
                        <label className="semantic-skin-toggle">
                          <input
                            aria-label="Enable freckles"
                            type="checkbox"
                            checked={skinDefinitionDraft.features.freckles.enabled}
                            disabled={hasCharacter || running || skinDefinitionSaving}
                            onChange={(event) => updateSkinDefinition({
                              features: { freckles: { enabled: event.target.checked } },
                            })}
                          />
                          <span>Enable procedural freckles</span>
                        </label>
                        <p className="compatible-assets-note">The pattern is repeatable and previews on the head texture. Validated cheek/nose masks are not installed, so marks are distributed over the head UV islands rather than placed anatomically.</p>
                        <div className="semantic-skin-controls">
                          <label className="skin-paint-range">
                            <span>Pattern</span>
                            <select
                              aria-label="Freckle pattern"
                              value={skinDefinitionDraft.features.freckles.pattern ?? 'natural'}
                              disabled={hasCharacter || running || skinDefinitionSaving}
                              onChange={(event) => updateSkinDefinition({
                                features: {
                                  freckles: {
                                    pattern: event.target.value as typeof skinDefinitionDraft.features.freckles.pattern,
                                  },
                                },
                              })}
                            >
                              {FRECKLE_PATTERNS.map((pattern) => (
                                <option key={pattern.value} value={pattern.value}>{pattern.label}</option>
                              ))}
                            </select>
                          </label>
                          <label className="skin-paint-range">
                            <span>Density <output>{skinDefinitionDraft.features.freckles.density.toFixed(2)}</output></span>
                            <input
                              aria-label="Freckle density"
                              type="range"
                              min="0"
                              max="1"
                              step="0.01"
                              value={skinDefinitionDraft.features.freckles.density}
                              disabled={hasCharacter || running || skinDefinitionSaving}
                              onChange={(event) => updateSkinDefinition({
                                features: { freckles: { density: Number(event.target.value) } },
                              })}
                            />
                          </label>
                          <label className="skin-paint-range">
                            <span>Size <output>{skinDefinitionDraft.features.freckles.size.toFixed(2)}</output></span>
                            <input
                              aria-label="Freckle size"
                              type="range"
                              min="0"
                              max="1"
                              step="0.01"
                              value={skinDefinitionDraft.features.freckles.size}
                              disabled={hasCharacter || running || skinDefinitionSaving}
                              onChange={(event) => updateSkinDefinition({
                                features: { freckles: { size: Number(event.target.value) } },
                              })}
                            />
                          </label>
                          <label className="skin-paint-range">
                            <span>Strength <output>{skinDefinitionDraft.features.freckles.strength.toFixed(2)}</output></span>
                            <input
                              aria-label="Freckle strength"
                              type="range"
                              min="0"
                              max="1"
                              step="0.01"
                              value={skinDefinitionDraft.features.freckles.strength}
                              disabled={hasCharacter || running || skinDefinitionSaving}
                              onChange={(event) => updateSkinDefinition({
                                features: { freckles: { strength: Number(event.target.value) } },
                              })}
                            />
                          </label>
                          <label className="skin-paint-color semantic-skin-freckle-color">
                            <span>Freckle color</span>
                            <input
                              aria-label="Freckle color"
                              type="color"
                              value={skinDefinitionDraft.features.freckles.color}
                              disabled={hasCharacter || running || skinDefinitionSaving}
                              onChange={(event) => updateSkinDefinition({
                                features: { freckles: { color: event.target.value.toUpperCase() } },
                              })}
                            />
                          </label>
                        </div>
                      </div>
                      {!hasCharacter && <button
                        className="save-cc3-morphs morph-save-button semantic-skin-save"
                        type="button"
                        disabled={!skinDefinitionDirty || running || skinDefinitionSaving}
                        onClick={() => void runAction(() => saveSkinDefinition(skinDefinitionDraft))}
                      >{skinDefinitionSaving ? 'Saving skin properties…' : 'Save skin properties'}</button>}
                      {hasCharacter && <p className="compatible-assets-note">Compiled skin properties are read-only. Create a new draft to edit them.</p>}
                      <form className="semantic-skin-interpreter" onSubmit={(event) => {
                        event.preventDefault();
                        void runAction(interpretSkinPrompt);
                      }}>
                        <label htmlFor="skin-interpretation-prompt">Describe a skin adjustment</label>
                        <textarea
                          id="skin-interpretation-prompt"
                          value={skinPrompt}
                          maxLength={1200}
                          placeholder="For example: make the skin slightly warmer and less shiny"
                          disabled={hasCharacter || running || skinInterpretationLoading || skinDefinitionDirty}
                          onChange={(event) => setSkinPrompt(event.target.value)}
                        />
                        <button
                          type="submit"
                          disabled={!skinPrompt.trim() || hasCharacter || running || skinInterpretationLoading || skinDefinitionDirty}
                        >{skinInterpretationLoading ? 'Interpreting…' : 'Interpret with AI'}</button>
                      </form>
                      {skinInterpretationError && <p className="semantic-skin-error" role="alert">{skinInterpretationError}</p>}
                      {skinInterpretation && <div className="semantic-skin-proposal" aria-live="polite">
                        <strong>Proposed draft change</strong>
                        <p>{skinInterpretation.explanation}</p>
                        <small>The viewport is previewing this proposal; it is not saved yet.</small>
                        {skinInterpretation.changed_properties.length > 0
                          ? <small>Changes: {skinInterpretation.changed_properties.join(', ')}</small>
                          : <small>No supported properties changed.</small>}
                        <div className="semantic-skin-proposal-actions">
                          <button
                            type="button"
                            disabled={running || skinDefinitionSaving || skinInterpretation.changed_properties.length === 0}
                            onClick={() => void runAction(applySkinInterpretation)}
                          >Apply to draft</button>
                          <button type="button" disabled={running || skinDefinitionSaving} onClick={() => setSkinInterpretation(null)}>Discard proposal</button>
                        </div>
                      </div>}
                    </section>}
                    {!skinAssetsLoading && !skinAssetsError && skinAssets.length === 0 && <p>No integrity-verified skin assets are installed. Prepare the local CC3+ skin package to enable this card.</p>}
                    {!skinAssetsLoading && <div className="compatible-assets-grid">
                      {skinAssets.map((asset) => {
                        const compatible = !project || asset.compatible_asset_ids.includes(project.base_model_asset_id);
                        const selected = selectedDraftSkin?.id === asset.id;
                        const previewUrlForAsset = `${API_BASE}/assets/skins/${encodeURIComponent(asset.id)}/preview?sha256=${encodeURIComponent(asset.preview_sha256)}`;
                        return <article className="compatible-asset-card skin-asset-card" key={asset.id} data-ai-guide-target={`skin:${asset.id}`}>
                          <img src={previewUrlForAsset} alt="" aria-hidden="true" loading="lazy" />
                          <strong>{asset.name}</strong>
                          <small>CC3+ · head, body, arms and legs</small>
                          <span>{selected ? 'Live draft preview' : 'Diffuse and normal maps'}</span>
                          {!compatible && <small>This skin requires the RL CC3+ character.</small>}
                          <button
                            type="button"
                            disabled={!project || hasCharacter || !compatible || running || appearanceSaving || selected}
                            onClick={() => void runAction(() => selectDraftSkin(asset.id))}
                            title={!project ? 'Create a draft project first.' : hasCharacter ? 'Create a new draft to preview another skin.' : !compatible ? 'This skin is only compatible with the RL CC3+ character.' : 'Preview this skin in the browser and save the choice to the draft'}
                          >
                            {appearanceSaving ? 'Saving draft…' : selected ? 'Preview selected' : 'Preview skin'}
                          </button>
                        </article>;
                      })}
                    </div>}
                  </> : <p>No compatible {customizationCategory} assets are installed for this character yet.</p>}
                </section> : <>
              <section className="character-dock-section" aria-label="Scene Hierarchy">
                <header className="character-dock-heading"><div><Layers3 size={19} /><strong>Scene Hierarchy</strong></div></header>
                {sceneHierarchy}
              </section>
              <section className="character-dock-section" aria-label="Properties">
                <header className="character-dock-heading"><div><Info size={19} /><strong>Properties</strong></div></header>
                {characterProperties}
              </section>
              <section className="character-dock-section" aria-label="Workflow" data-ai-guide-target="workflow-review">
                <header className="character-dock-heading"><div><Zap size={19} /><strong>Workflow</strong></div></header>
                {projectWorkflow}
              </section>
              </>}
            </>}
          </div>
        </aside>
      </main>
      </> : <main
        className={`landing-page${zoomFitViewport ? ' is-zoom-fit' : ''}`}
        aria-label="C3Canvas home"
        style={zoomFitViewport ? {
          '--landing-visual-width': `${zoomFitViewport.width}px`,
          '--landing-visual-height': `${zoomFitViewport.height}px`,
        } as CSSProperties : undefined}
      >
        <aside className="landing-sidebar" aria-label="Home navigation">
          <nav className="landing-sidebar-nav" aria-label="Primary">
            <button
              aria-label="Home"
              title="Home"
              className={landingSection === 'home' ? 'active' : ''}
              type="button"
              onClick={() => {
                setLandingSection('home');
                document.getElementById('landing-dashboard')?.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            ><Home size={17} /><span>Home</span></button>
            <button
              aria-label="Projects"
              title="Projects"
              className={landingSection === 'projects' ? 'active' : ''}
              type="button"
              onClick={() => {
                setLandingSection('projects');
                setShowAllLandingProjects(true);
                document.getElementById('landing-projects')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            ><FolderOpen size={17} /><span>Projects</span></button>
            <button type="button" aria-label="Object Workshop" title="Create and edit objects" onClick={() => setObjectWorkshopOpen(true)}><Box size={17} /><span>Objects</span></button>
            <button aria-label="Models, coming soon" title="Models are not available yet" type="button" disabled><Box size={17} /><span>Models</span></button>
            <button aria-label="Tools, coming soon" title="Tools are not available yet" type="button" disabled><Sparkles size={17} /><span>Tools</span></button>
            <button aria-label="Settings, coming soon" title="Settings are not available yet" type="button" disabled><Settings size={17} /><span>Settings</span></button>
          </nav>
          <nav className="landing-sidebar-secondary-nav" aria-label="Support">
            <button aria-label="Help" title="Help" type="button" onClick={() => setMessage('How does the draft-first character workflow work?')}><CircleHelp size={17} /><span>Help</span></button>
          </nav>
          <div className="landing-sidebar-note">
            <Sparkles size={16} aria-hidden="true" />
            <span>Unlock more</span>
            <small>Preview supported character edits before compiling.</small>
            <button type="button" disabled title="Upgrade options are not available yet">Upgrade <ArrowRight size={13} /></button>
          </div>
        </aside>
        <div className="landing-dashboard" id="landing-dashboard">
          <header className="landing-topbar">
            <div className="landing-topbar-status">
              <span className={`landing-connection-state${apiReady ? ' is-ready' : apiError ? ' has-error' : ' is-connecting'}`}><span />{apiReady ? 'Ready' : apiError ? 'Offline' : 'Connecting'}</span>
              {landingCardStorageError && <span className="landing-layout-error" role="status">{landingCardStorageError}</span>}
            </div>
            <div className="landing-topbar-actions">
              <button type="button" className="landing-layout-reset" aria-label="Reset dashboard card positions" title="Reset dashboard card positions" disabled={landingCardOrder.every((id, index) => id === defaultLandingCardOrder[index])} onClick={() => setLandingCardOrder([...defaultLandingCardOrder])}><RotateCcw size={15} /></button>
              <button type="button" aria-label="Settings, coming soon" title="Settings are not available yet" disabled><Settings size={17} /></button>
              <span className="landing-demo-user" aria-label={`Signed in as ${account.username}`}><span>{account.username.slice(0, 1).toUpperCase()}</span><strong>{account.username}</strong></span>
              <button type="button" className="landing-signout" aria-label={`Sign out ${account.username}`} disabled={running} onClick={() => void runAction(signOut)}><UserRound size={15} /></button>
            </div>
          </header>
          <div className="landing-dashboard-content">
            <section {...getLandingCardProps('hero')} className="landing-hero" id="landing-home" aria-labelledby="landing-title">
              {renderLandingCardControls('hero')}
              <div className="landing-hero-copy">
                <p className="landing-eyebrow"><span aria-hidden="true" /> CREATE. COLLABORATE. CRAFT.</p>
                <h1 id="landing-title">An AI-powered <span>creative workspace.</span></h1>
                <p className="landing-description">
                  Start with AI-guided character creation today. Worlds, animation, materials, and more are part of the wider C3Canvas vision.
                </p>
                <div className="landing-hero-actions">
                  <button className="landing-start-button" type="button" disabled={!apiReady || running} onClick={openNewProject}>
                    <Play size={15} fill="currentColor" aria-hidden="true" /> Start a new project <ArrowRight size={15} aria-hidden="true" />
                  </button>
                  <button className="landing-explore-button" type="button" onClick={() => document.getElementById('landing-projects')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                    <Layers3 size={15} aria-hidden="true" /> Explore projects
                  </button>
                </div>
                <p className="landing-hero-note">Your project stays a browser draft until you explicitly compile it in Blender.</p>
              </div>
              <div className="landing-hero-art" aria-hidden="true">
                <span className="landing-art-glow" />
                <img src="/c3canvas_mascot.webp" alt="" />
              </div>
            </section>
            <section {...getLandingCardProps('workflow')} className="landing-projects landing-workflow-card" aria-labelledby="landing-workflow-title">
              {renderLandingCardControls('workflow')}
              <button className="landing-card-click-target" type="button" aria-label="Ask Canvas about the draft-first workflow" onClick={showWorkflowInChat} />
              <span className="landing-workflow-symbol" aria-hidden="true"><span /></span>
              <p className="landing-workflow-kicker">MADE FOR CREATORS</p>
              <h2 id="landing-workflow-title">Draft first.<br />Compile when ready.</h2>
              <p>Preview supported character changes in your browser. Your saved choices are compiled together only when you choose.</p>
              <button type="button" onClick={showWorkflowInChat}>Explore the workflow <ArrowRight size={14} /></button>
            </section>
          </div>
          <div className="landing-home-panels">
            <aside {...getLandingCardProps('assistant')} className={`landing-assistant-column${chatOpen ? '' : ' is-chat-collapsed'}`} aria-label="Create with AI">
              {renderLandingCardControls('assistant')}
              {chatWidget}
            </aside>
            <section {...getLandingCardProps('new-projects')} className="landing-projects landing-concept-card" aria-labelledby="landing-new-projects-title">
              {renderLandingCardControls('new-projects')}
              <button className="landing-card-click-target" type="button" aria-label="Start a new character project" disabled={!apiReady || running} onClick={openNewProject} />
              <header className="landing-section-heading">
                <div><Sparkles size={17} aria-hidden="true" /><h2 id="landing-new-projects-title">New projects</h2></div>
                <span className="landing-concept-label">Visual demo</span>
              </header>
              <div className="landing-concept-art" role="img" aria-label="Illustrative fantasy landscape concept, not a saved project">
                <span className="landing-concept-moon" />
                <span className="landing-concept-mountain landing-concept-mountain-back" />
                <span className="landing-concept-mountain landing-concept-mountain-front" />
                <span className="landing-concept-castle" />
                <div className="landing-concept-caption"><small>ILLUSTRATIVE CONCEPT · NOT A SAVED PROJECT</small><strong>Fantasy Realm</strong></div>
              </div>
              <button className="landing-concept-action" type="button" disabled={!apiReady || running} onClick={openNewProject}>Start a real character project <ArrowRight size={14} /></button>
            </section>
            <section {...getLandingCardProps('recent-projects')} className="landing-projects landing-recent-card" id="landing-projects" aria-labelledby="landing-projects-title">
              {renderLandingCardControls('recent-projects')}
              <button
                className="landing-card-click-target"
                type="button"
                aria-label={savedProjects.length ? 'Open a saved character project' : 'Create a character project'}
                disabled={!apiReady || running || savedProjectsLoading}
                onClick={() => savedProjects[0] ? void runAction(() => openProject(savedProjects[0].id)) : openNewProject()}
              />
              <header className="landing-section-heading">
                <div><Activity size={17} aria-hidden="true" /><h2 id="landing-projects-title">Recent projects</h2></div>
                <span>{savedProjectsLoading ? 'Loading…' : `${savedProjects.length} saved`}</span>
              </header>
              {savedProjectsError && <div className="landing-projects-error" role="alert">
                <span>{savedProjectsError}</span>
                <button className="initial-data-retry" type="button" disabled={initialDataLoading} onClick={() => setInitialDataRetry((retry) => retry + 1)}>{initialDataLoading ? 'Retrying…' : 'Retry projects'}</button>
              </div>}
              {savedProjectsLoading ? <p className="landing-projects-empty" role="status">Loading your saved projects…</p>
                : savedProjects.length > 0 ? <div className="landing-project-list">
                  {savedProjects.slice(0, showAllLandingProjects ? savedProjects.length : 3).map((item, index) => {
                    const modelName = availableBaseModels.find(({ asset_id }) => asset_id === item.base_model_asset_id)?.name ?? 'Character model';
                    return <button
                      className="landing-project-card"
                      type="button"
                      key={item.id}
                      disabled={running}
                      onClick={() => void runAction(() => openProject(item.id))}
                    >
                      <span className={`landing-project-icon landing-project-icon-${index}`}><UserRound size={17} aria-hidden="true" /></span>
                      <span className="landing-project-copy"><strong>{item.name}</strong><small>{modelName} · {item.has_character ? 'Compiled scene' : 'Draft'}</small></span>
                      <ChevronRight size={15} aria-hidden="true" />
                    </button>;
                  })}
                </div> : <div className="landing-projects-empty">
                  <FolderOpen size={20} aria-hidden="true" />
                  <p>Your saved character projects will appear here.</p>
                  <button type="button" disabled={!apiReady || running} onClick={openNewProject}>Create your first draft <ArrowRight size={14} /></button>
                </div>}
              {savedProjects.length > 3 && <button className="landing-view-all" type="button" onClick={() => setShowAllLandingProjects((showAll) => !showAll)}>{showAllLandingProjects ? 'Show less' : 'View all'} <ArrowRight size={13} /></button>}
            </section>
          </div>
        </div>
      </main>}
        {project && chatWidget}
        {project && assistantGuidanceTooltip}
      {newProjectOpen && createPortal(<div className="new-project-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget && !running) setNewProjectOpen(false);
      }}>
        <section className={`new-project-dialog${newProjectStep === 'character-setup' ? ' character-setup-dialog' : ''}`} role="dialog" aria-modal="true" aria-labelledby="new-project-title" aria-describedby="new-project-description">
          <header className={`new-project-header${newProjectStep === 'character-setup' ? ' character-setup-header' : ''}`}>
            <div className="new-project-title-wrap">
              {newProjectStep === 'character-setup' && <button className="new-project-back" type="button" onClick={() => setNewProjectStep('asset-types')}><ArrowLeft size={17} /> Back</button>}
              <h1 id="new-project-title">{newProjectStep === 'asset-types' ? 'Create New Asset' : <><UserRound aria-hidden="true" /> Create New <span>Character</span></>}</h1>
              <p id="new-project-description">{newProjectStep === 'asset-types'
                ? 'Choose what you would like to create'
                : message.trim()
                  ? 'Bring your imagination to life. Choose a starting model; your prompt will be sent after the draft is created.'
                  : 'Create a character draft from an installed base model. Some customization options are not available yet.'}</p>
            </div>
            <button className="new-project-close" type="button" aria-label="Close new project dialog" disabled={running} onClick={() => setNewProjectOpen(false)}><X size={18} /></button>
          </header>
          {newProjectStep === 'asset-types' ? <div className="project-type-grid" aria-label="Asset type">
            <button className="project-type-card character" type="button" onClick={() => { setProjectCreationError(''); setSelectedBaseModel(null); setNewProjectStep('character-setup'); }}>
              <span className="project-type-copy"><span className="project-type-label">CHARACTER</span><strong>Character Model</strong><small>Start with an installed rigged character model.</small></span>
            </button>
            <button className="project-type-card unavailable" type="button" disabled aria-label="Object Model, coming soon">
              <span className="project-type-copy"><span className="project-type-label">OBJECTS</span><strong>Object Model</strong><small>Props, buildings and objects.</small></span>
              <span className="coming-soon">Coming soon</span>
            </button>
            <button className="project-type-card unavailable" type="button" disabled aria-label="Animation, coming soon">
              <span className="project-type-copy"><span className="project-type-label">MOTION</span><strong>Animation</strong><small>Animate your models.</small></span>
              <span className="coming-soon">Coming soon</span>
            </button>
            <button className="project-type-card unavailable" type="button" disabled aria-label="Voice and Sound, coming soon">
              <span className="project-type-copy"><span className="project-type-label">AUDIO</span><strong>Voice / Sound</strong><small>Voice and sound for models.</small></span>
              <span className="coming-soon">Coming soon</span>
            </button>
            <button className="project-type-card unavailable" type="button" disabled aria-label="Rigging, coming soon">
              <span className="project-type-copy"><span className="project-type-label">CHARACTER SETUP</span><strong>Rigging</strong><small>Add a character rig.</small></span>
              <span className="coming-soon">Coming soon</span>
            </button>
          </div> : <>
            <form className="character-setup-form" onSubmit={(event) => { event.preventDefault(); setProjectCreationError(''); void runAction(createProject); }}>
              <label className="character-name-field">
                <span><UserRound size={13} aria-hidden="true" /> Character Name <small>{projectName.length}/120</small></span>
                <input ref={projectNameInput} value={projectName} maxLength={120} required placeholder="Enter a name..." onChange={(event) => setProjectName(event.target.value)} />
              </label>
              <div className="base-model-section">
                <div className="base-model-heading">
                  <div><span className="new-project-kicker"><Box size={12} aria-hidden="true" /> CHARACTER TYPE</span><strong>Choose a starting model</strong></div>
                  <span className="available-count">{baseModelsLoading ? 'Loading…' : `${availableBaseModels.length} available`}</span>
                </div>
                {baseModelsLoading && <p className="base-model-status" role="status">Loading available character models…</p>}
                {baseModelsError && <div className="base-model-error" role="alert">
                  <span>{baseModelsError}</span>
                  <button className="initial-data-retry" type="button" disabled={initialDataLoading} onClick={() => setInitialDataRetry((retry) => retry + 1)}>{initialDataLoading ? 'Retrying…' : 'Retry model catalog'}</button>
                </div>}
                {!baseModelsLoading && !baseModelsError && availableBaseModels.length === 0 && <p className="base-model-error" role="alert">No supported character models are currently available.</p>}
                <div className="base-model-grid" role="group" aria-label="Available character base models">
                  {orderedBaseModels.map((model) => <button
                    className={`base-model-option${selectedBaseModel === model.asset_id ? ' selected' : ''}${model.asset_id === ADVANCED_CHARACTER_ASSET_ID ? ' advanced' : ''}`}
                    type="button"
                    key={model.asset_id}
                    aria-pressed={selectedBaseModel === model.asset_id}
                    aria-label={`${model.asset_id === BASIC_CHARACTER_ASSET_ID
                      ? 'Basic workflow, CC3 Female'
                      : model.asset_id === ADVANCED_CHARACTER_ASSET_ID
                        ? 'Advanced workflow, CC3 Plus Female'
                        : 'CC3 Male model'}: ${model.detail}`}
                    onClick={() => { setSelectedBaseModel(model.asset_id); setProjectCreationError(''); }}
                  >
                    <span className="base-model-copy">
                      <span className="base-model-label">{model.asset_id === BASIC_CHARACTER_ASSET_ID
                        ? 'BASIC · RECOMMENDED'
                        : model.asset_id === ADVANCED_CHARACTER_ASSET_ID
                          ? 'ADVANCED'
                          : 'ADDITIONAL MODEL'}</span>
                      <strong>{model.asset_id === BASIC_CHARACTER_ASSET_ID
                        ? 'CC3 Female'
                        : model.asset_id === ADVANCED_CHARACTER_ASSET_ID
                          ? 'CC3+ Female'
                          : 'CC3 Male'}</strong>
                      <small>{model.asset_id === BASIC_CHARACTER_ASSET_ID
                        ? '137 shaping controls.'
                        : model.asset_id === ADVANCED_CHARACTER_ASSET_ID
                          ? '2,042 controls · more resources.'
                          : '143 shaping controls.'}</small>
                    </span>
                  </button>)}
                </div>
                {availableBaseModels.length > 0 && <p className="approval-note">Draft first. Approve the plan, then Save / Compile when ready.</p>}
              </div>
              <section className="character-style-placeholder" aria-label="Style customization is unavailable">
                <div className="character-placeholder-heading"><span><Palette size={13} aria-hidden="true" /> Style</span><small>Unavailable in this version</small></div>
                <div className="character-placeholder-tiles" aria-label="Style previews unavailable">
                  {Array.from({ length: 6 }, (_, index) => <span className={`character-placeholder-tile tile-${index + 1}`} key={index} aria-hidden="true"><LockKeyhole size={13} /></span>)}
                </div>
              </section>
              <label className="character-personality-placeholder">
                <span><Sparkles size={13} aria-hidden="true" /> Personality <small>Optional · unavailable</small></span>
                <textarea disabled maxLength={500} placeholder="Personality customization is not available yet." />
              </label>
              <div className="new-project-footer">
                <button className="character-advanced-placeholder" type="button" disabled aria-label="Advanced options unavailable" title="Advanced options are not available yet"><Settings size={14} aria-hidden="true" /> Advanced options <small>Unavailable</small><ChevronDown size={12} aria-hidden="true" /></button>
                <div className="new-project-actions">
                  <button className="new-project-cancel" type="button" disabled={running} onClick={() => setNewProjectOpen(false)}>Cancel</button>
                  <button className="new-project-submit" type="submit" disabled={running || !apiReady || baseModelsLoading || !selectedBaseModelInfo}>
                    {running ? 'Creating project…' : 'Create Character'} {!running && <Sparkles size={14} />}
                  </button>
                </div>
                {!apiReady && apiError && <p className="new-project-error" role="alert">{apiError}</p>}
                {projectCreationError && <p className="new-project-error" role="alert">{projectCreationError}</p>}
              </div>
            </form>
            <aside className="character-setup-aside" aria-label="Character workflow overview">
              <div className="character-setup-art" aria-hidden="true">
                <span />
                <img src="/c3canvas_mascot.webp" alt="" />
              </div>
              <section className="character-setup-benefits" aria-labelledby="character-setup-benefits-title">
                <h2 id="character-setup-benefits-title"><Sparkles size={15} aria-hidden="true" /> Your character will include</h2>
                <ul>
                  <li><span aria-hidden="true">✓</span> Browser-first draft preview</li>
                  <li><span aria-hidden="true">✓</span> Controls for the selected model</li>
                  <li><span aria-hidden="true">✓</span> Approval before compiling</li>
                  <li><span aria-hidden="true">✓</span> Save / Compile only when you choose</li>
                </ul>
              </section>
            </aside>
          </>}
        </section>
      </div>, document.body)}
    </div>
  );
}
