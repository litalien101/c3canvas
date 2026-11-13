import { Suspense, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode, type RefObject } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, Grid, Html, OrbitControls, useGLTF, useProgress } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  Armchair, Box, ChevronDown, ChevronRight, Download, Eye, EyeOff, Grid3X3, Hand,
  Layers3, LockKeyhole, Move, MousePointer2, Plus, Redo2, RotateCcw,
  Save, Scaling, Search, Trash2, Undo2, Unlock, Upload, X,
} from 'lucide-react';
import * as THREE from 'three';
import {
  cagePointIndex, cagePointRestPosition, createWorkshopId, createWorkshopObject, createWorkshopScene,
  createDefaultMasonryConfig, createMasonryComponents, deformWorkshopVertex, getComponentGeometry, getPreset,
  normalizeWorkshopScene, placeWorkshopObjectWithoutOverlap, snapMasonryOffsetFromAnchor,
  WORKSHOP_MATERIALS, WORKSHOP_PRESETS,
  type MasonryConfig, type WorkshopComponent, type WorkshopObject, type WorkshopPresetId, type WorkshopScene, type WorkshopVec3,
} from './objectWorkshopModel';
import { getWorkshopAsset } from './objectWorkshopAssets.ts';

const STORAGE_KEY = 'c3canvas.object-workshop.scene.v1';
const pointAxes = ['x', 'y', 'z'] as const;
type Axis = typeof pointAxes[number];
type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  startPosition: WorkshopVec3;
  startHit?: WorkshopVec3;
  startRotation: WorkshopVec3;
  startScale: WorkshopVec3;
  plane: THREE.Plane;
  startOffset: WorkshopVec3;
  axis: WorkshopScene['axis'];
  kind: 'cage' | 'component' | 'object';
  pointKey?: string;
  pointCoordinates?: [number, number, number];
  startWorldHit?: WorkshopVec3;
  startObjectPosition?: WorkshopVec3;
  before: WorkshopScene;
};

export function ObjectWorkshop({ onExit }: { onExit: () => void }) {
  const [scene, setScene] = useState<WorkshopScene>(() => loadSavedScene());
  const sceneRef = useRef(scene);
  const historyRef = useRef<{ past: WorkshopScene[]; future: WorkshopScene[] }>({ past: [], future: [] });
  const [dragging, setDragging] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState<string | null>(null);
  const [presetFilter, setPresetFilter] = useState('');
  const [activeCategory, setActiveCategory] = useState('Furniture');
  const [expandedBackups, setExpandedBackups] = useState<Record<string, boolean>>({});
  const [expandedMasonry, setExpandedMasonry] = useState<Record<string, boolean>>({});
  const [masonryDrafts, setMasonryDrafts] = useState<Record<string, MasonryConfig>>({});
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const dragState = useRef<DragState | null>(null);
  const objectGroup = useRef<THREE.Group | null>(null);
  const orbitControls = useRef<OrbitControlsImpl | null>(null);
  const importInput = useRef<HTMLInputElement | null>(null);
  const [collapsedLeft, setCollapsedLeft] = useState(false);
  const [collapsedRight, setCollapsedRight] = useState(false);

  const selectedObject = scene.objects.find(({ id }) => id === scene.selectedObjectId);
  const selectedComponent = selectedObject?.components.find(({ id }) => id === scene.selectedComponentId);
  const preset = selectedObject ? getPreset(selectedObject.presetId) : null;
  const selectedAsset = selectedObject ? getWorkshopAsset(selectedObject.presetId) : null;
  const masonryDraft = selectedObject?.masonry
    ? masonryDrafts[selectedObject.id] ?? selectedObject.masonry
    : null;
  const selectedComponentGeometry = selectedObject && selectedComponent
    ? getComponentGeometry(selectedObject, selectedComponent)
    : null;
  const componentOffsets = selectedObject && selectedComponent
    ? selectedObject.cageOffsets[selectedComponent.id] ?? {}
    : {};

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(scene));
    } catch (reason) {
      setError(`Autosave failed: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  }, [scene]);

  function setSceneDirect(next: WorkshopScene) {
    sceneRef.current = next;
    setScene(next);
  }

  function changeCageResolution(value: number) {
    const nextResolution = clamp(value, 2, 4);
    if (nextResolution === sceneRef.current.cageResolution) return;
    const oldResolution = sceneRef.current.cageResolution;
    const nextScene = {
      ...sceneRef.current,
      cageResolution: nextResolution,
      objects: sceneRef.current.objects.map((object) => ({
        ...object,
        cageOffsets: Object.fromEntries(Object.entries(object.cageOffsets).map(([componentId, offsets]) => [
          componentId,
          remapOffsets(offsets, oldResolution, nextResolution),
        ])),
      })),
    };
    commitScene(nextScene);
  }

  function commitScene(next: WorkshopScene) {
    const current = sceneRef.current;
    historyRef.current = {
      past: [...historyRef.current.past.slice(-49), current],
      future: [],
    };
    setSceneDirect(next);
    setError('');
    setStatus('');
  }

  function updateObject(objectId: string, update: (object: WorkshopObject) => WorkshopObject) {
    const next = {
      ...sceneRef.current,
      objects: sceneRef.current.objects.map((object) => object.id === objectId ? update(object) : object),
    };
    commitScene(next);
  }

  function updateComponent(componentId: string, update: (component: WorkshopComponent) => WorkshopComponent) {
    if (!selectedObject || selectedObject.assemblyLocked) return;
    updateObject(selectedObject.id, (object) => ({
      ...object,
      components: object.components.map((component) => component.id === componentId ? update(component) : component),
    }));
  }

  function setParameter(id: string, value: number) {
    if (!selectedObject || !Number.isFinite(value)) return;
    updateObject(selectedObject.id, (object) => ({ ...object, parameters: { ...object.parameters, [id]: value } }));
  }

  function selectPreset(id: WorkshopPresetId) {
    const object = placeWorkshopObjectWithoutOverlap(createWorkshopObject(id), sceneRef.current.objects);
    const component = object.components.find((item) => item.semanticType === 'masonry-brick' || item.semanticType === 'masonry-paver')
      ?? object.components[0];
    commitScene({
      ...sceneRef.current,
      objects: [...sceneRef.current.objects, object],
      selectedObjectId: object.id,
      selectedComponentId: component.id,
      mode: 'object',
    });
    setActiveCategory(getPreset(id).category);
  }

  function updateMasonryDraft(update: (config: MasonryConfig) => MasonryConfig) {
    if (!selectedObject || !masonryDraft) return;
    setMasonryDrafts((drafts) => ({ ...drafts, [selectedObject.id]: update(masonryDraft) }));
  }

  function regenerateMasonry() {
    if (!selectedObject || !masonryDraft || selectedObject.assemblyLocked) return;
    try {
      const components = createMasonryComponents(masonryDraft);
      const generatedTypes = new Set(['masonry-base', 'masonry-return-bed', 'masonry-brick', 'masonry-paver']);
      const previousGeneratedIds = new Set(selectedObject.components
        .filter((component) => generatedTypes.has(component.semanticType))
        .map((component) => component.id));
      const replacementBaseId = components[0].id;
      const customComponents = selectedObject.components.filter((component) => !generatedTypes.has(component.semanticType))
        .map((component) => ({
          ...component,
          parentId: component.parentId && previousGeneratedIds.has(component.parentId)
            ? component.parentId === selectedObject.components[0]?.id ? replacementBaseId : null
            : component.parentId,
        }));
      const nextComponents = [...components, ...customComponents];
      const otherComponentCount = sceneRef.current.objects
        .filter((object) => object.id !== selectedObject.id)
        .reduce((total, object) => total + object.components.length, 0);
      if (otherComponentCount + nextComponents.length > 500) {
        throw new Error('The scene component limit is 500. Remove some objects or reduce the masonry layout.');
      }
      const nextComponent = components.find((component) =>
        component.semanticType === 'masonry-brick' || component.semanticType === 'masonry-paver') ?? components[0];
      commitScene({
        ...sceneRef.current,
        objects: sceneRef.current.objects.map((object) => object.id === selectedObject.id
          ? {
            ...object,
            masonry: masonryDraft,
            components: nextComponents,
            cageOffsets: Object.fromEntries(Object.entries(object.cageOffsets)
              .filter(([componentId]) => customComponents.some((component) => component.id === componentId))),
          }
          : object),
        selectedComponentId: nextComponent.id,
      });
      setExpandedMasonry((expanded) => ({ ...expanded, [selectedObject.id]: false }));
      setError('');
      setStatus(`Generated ${components.filter((component) => component.semanticType === 'masonry-brick' || component.semanticType === 'masonry-paver').length} editable ${masonryDraft.kind === 'wall' ? 'bricks' : 'pavers'}.`);
    } catch (reason) {
      setError(`Could not generate masonry: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  }

  function selectComponent(objectId: string, componentId: string) {
    setSceneDirect({ ...sceneRef.current, selectedObjectId: objectId, selectedComponentId: componentId });
    setSelectedPoint(null);
  }

  function finishDrag() {
    const drag = dragState.current;
    if (drag) {
      historyRef.current = { past: [...historyRef.current.past.slice(-49), drag.before], future: [] };
    }
    dragState.current = null;
    setDragging(false);
  }

  function undo() {
    const history = historyRef.current;
    const previous = history.past.at(-1);
    if (!previous) return;
    historyRef.current = {
      past: history.past.slice(0, -1),
      future: [...history.future, sceneRef.current],
    };
    setSceneDirect(previous);
  }

  function redo() {
    const history = historyRef.current;
    const next = history.future.at(-1);
    if (!next) return;
    historyRef.current = {
      past: [...history.past, sceneRef.current],
      future: history.future.slice(0, -1),
    };
    setSceneDirect(next);
  }

  function duplicateObject(objectId = sceneRef.current.selectedObjectId) {
    const source = sceneRef.current.objects.find((object) => object.id === objectId);
    if (!source) return;
    const clone = structuredClone(source);
    const id = createWorkshopId();
    const remapped = new Map(clone.components.map((component) => [component.id, createWorkshopId()]));
    const cageOffsets: WorkshopObject['cageOffsets'] = {};
    clone.id = id;
    clone.name = `${clone.name} Copy`;
    clone.position = [clone.position[0] + 0.35, clone.position[1], clone.position[2] + 0.25];
    for (const component of clone.components) {
      cageOffsets[remapped.get(component.id)!] = clone.cageOffsets[component.id] ?? {};
    }
    clone.components = clone.components.map((component) => ({
      ...component,
      id: remapped.get(component.id)!,
      parentId: component.parentId ? remapped.get(component.parentId) ?? null : null,
    }));
    clone.cageOffsets = cageOffsets;
    const first = clone.components[0];
    commitScene({ ...sceneRef.current, objects: [...sceneRef.current.objects, clone], selectedObjectId: id, selectedComponentId: first.id });
  }

  function removeObject(objectId: string) {
    const objects = sceneRef.current.objects.filter(({ id }) => id !== objectId);
    const nextObject = objects[0];
    commitScene({
      ...sceneRef.current,
      objects,
      selectedObjectId: nextObject?.id ?? '',
      selectedComponentId: nextObject?.components[0]?.id ?? '',
    });
    setSelectedPoint(null);
  }

  function addComponent() {
    if (!selectedObject) return;
    const id = createWorkshopId();
    const component: WorkshopComponent = {
      id,
      name: 'Custom component',
      semanticType: 'custom-primitive',
      ...(selectedObject.presetId === 'masonry' ? { geometrySize: [0.35, 0.2, 0.35] as WorkshopVec3 } : {}),
      parentId: selectedComponent?.id ?? null,
      offset: [0, 0.3, 0],
      rotation: [0, 0, 0],
      scale: [0.35, 0.35, 0.35],
      visible: true,
      locked: false,
      materialId: selectedObject.materialId,
      creationPhase: 'draft',
      validationStatus: 'unvalidated',
    };
    updateObject(selectedObject.id, (object) => ({ ...object, components: [...object.components, component] }));
    setSceneDirect({ ...sceneRef.current, selectedObjectId: selectedObject.id, selectedComponentId: id, mode: 'component' });
  }

  function removeComponent(componentId: string) {
    if (!selectedObject || selectedObject.components.length <= 1) return;
    const remaining = selectedObject.components.filter(({ id }) => id !== componentId);
    const removed = selectedObject.components.find(({ id }) => id === componentId);
    updateObject(selectedObject.id, (object) => ({
      ...object,
      components: object.components.filter(({ id }) => id !== componentId)
        .map((component) => component.parentId === removed?.id ? { ...component, parentId: null } : component),
      cageOffsets: Object.fromEntries(Object.entries(object.cageOffsets).filter(([id]) => id !== componentId)),
    }));
    if (sceneRef.current.selectedComponentId === componentId) {
      setSceneDirect({ ...sceneRef.current, selectedComponentId: remaining[0].id });
    }
  }

  function saveScene() {
    try {
      const serialized = JSON.stringify(sceneRef.current, null, 2);
      localStorage.setItem(STORAGE_KEY, serialized);
      downloadFile(`${selectedObject?.name || 'object-workshop'}.json`, serialized, 'application/json');
      setError('');
      setStatus('Saved locally and downloaded editable project JSON.');
    } catch (reason) {
      setError(`Could not save this object: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  }

  async function exportScene() {
    if (sceneRef.current.objects.length === 0) return;
    try {
      const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
      const exporter = new GLTFExporter();
      const object3D = await buildExportObject(sceneRef.current);
      const result = await exporter.parseAsync(object3D, { binary: true });
      if (!(result instanceof ArrayBuffer)) throw new Error('The glTF exporter did not return a binary GLB file.');
      downloadBlob(`${selectedObject?.name || 'object-workshop'}.glb`, new Blob([result], { type: 'model/gltf-binary' }));
      setStatus('Exported the current scene as a binary glTF (GLB).');
      setError('');
    } catch (reason) {
      setError(`Could not export GLB: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  }

  async function importScene(file?: File) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError('Project JSON must be 10 MB or smaller.');
      return;
    }
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const normalized = normalizeWorkshopScene(parsed);
      if (!normalized) throw new Error('This file is not a supported Object Workshop project.');
      commitScene(normalized);
      setStatus('Loaded editable Object Workshop project.');
    } catch (reason) {
      setError(`Could not import project: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      if (importInput.current) importInput.current.value = '';
    }
  }

  const filteredPresets = WORKSHOP_PRESETS.filter((item) =>
    item.category === activeCategory && item.name.toLowerCase().includes(presetFilter.toLowerCase()));
  const categories = [...new Set(WORKSHOP_PRESETS.map(({ category }) => category))];

  return (
    <main className="object-workshop" aria-label="Object Workshop">
      <header className="object-workshop-header">
        <div className="ow-brand"><span className="ow-brand-mark"><Box size={19} /></span><strong>OBJECT WORKSHOP</strong><span className="ow-header-divider" />
          <input aria-label="Object name" value={selectedObject?.name ?? ''} disabled={!selectedObject} onChange={(event) => {
            if (selectedObject) updateObject(selectedObject.id, (object) => ({ ...object, name: event.target.value }));
          }} />
        </div>
        <div className="ow-mode-tabs" role="tablist" aria-label="Editing mode">
          {([
            ['object', 'OBJECT'],
            ['component', 'COMPONENT'],
            ['cage', 'CAGE EDIT'],
          ] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={scene.mode === id}
            className={scene.mode === id ? 'active' : ''} onClick={() => commitScene({ ...sceneRef.current, mode: id })}>{label}</button>)}
        </div>
        <div className="ow-header-actions">
          <button type="button" aria-label="Undo" title="Undo" disabled={!historyRef.current.past.length} onClick={undo}><Undo2 size={18} /></button>
          <button type="button" aria-label="Redo" title="Redo" disabled={!historyRef.current.future.length} onClick={redo}><Redo2 size={18} /></button>
          <span className="ow-header-divider" />
          <button type="button" className="ow-header-action" onClick={saveScene}><Save size={16} /> Save</button>
          <button type="button" className="ow-header-action" onClick={() => void exportScene()} disabled={scene.objects.length === 0}><Download size={16} /> Export GLB</button>
          <button type="button" aria-label="Import project JSON" title="Import project JSON" onClick={() => importInput.current?.click()}><Upload size={16} /></button>
          <button type="button" aria-label="Return to C3Canvas" title="Return to C3Canvas" onClick={onExit}><X size={17} /></button>
          <input ref={importInput} type="file" accept="application/json,.json" hidden onChange={(event) => void importScene(event.target.files?.[0])} />
        </div>
      </header>

      <section className="ow-workspace">
        {!collapsedLeft && <aside className="ow-left-panel">
          <header className="ow-panel-header"><strong>Presets</strong><button type="button" aria-label="Collapse presets" onClick={() => setCollapsedLeft(true)}><X size={14} /></button></header>
          <label className="ow-search"><Search size={14} /><input value={presetFilter} onChange={(event) => setPresetFilter(event.target.value)} placeholder="Search presets..." /></label>
          <div className="ow-categories" aria-label="Preset categories">
            {categories.map((category) => <button type="button" key={category} className={activeCategory === category ? 'active' : ''}
              onClick={() => setActiveCategory(category)}><ChevronRight size={13} />{category}<span>{WORKSHOP_PRESETS.filter((item) => item.category === category).length}</span></button>)}
          </div>
          <div className="ow-preset-grid">
            {filteredPresets.map((item) => <button type="button" key={item.id} className={selectedObject?.presetId === item.id ? 'active' : ''}
              onClick={() => selectPreset(item.id)}><PresetGlyph preset={item.id} /><span>{item.name}</span></button>)}
            {filteredPresets.length === 0 && <p className="ow-empty">No presets match this search.</p>}
          </div>
          <div className="ow-hierarchy">
            <header><strong>Hierarchy</strong><button type="button" aria-label="Add component" title="Add component" disabled={!selectedObject || selectedObject.assemblyLocked} onClick={addComponent}><Plus size={15} /></button></header>
            {scene.objects.map((object) => <div key={object.id}>
              <div className="ow-tree-object-row">
                <button type="button" className={`ow-tree-object${object.id === scene.selectedObjectId ? ' active' : ''}`} onClick={() => selectComponent(object.id, object.components[0]?.id ?? '')}>
                  <Box size={14} /><span>{object.name}</span>
                </button>
                <button type="button" aria-label={`${object.assemblyLocked ? 'Unlock' : 'Lock'} ${object.name} assembly`}
                  title={`${object.assemblyLocked ? 'Unlock' : 'Lock'} assembly`}
                  onClick={() => updateObject(object.id, (current) => ({ ...current, assemblyLocked: !current.assemblyLocked }))}>
                  {object.assemblyLocked ? <LockKeyhole size={12} /> : <Unlock size={12} />}
                </button>
                <button type="button" aria-label={`Duplicate ${object.name}`} title="Duplicate object" onClick={() => duplicateObject(object.id)}><Layers3 size={13} /></button>
              </div>
              {object.components.filter((component) => (!component.sourceBackup || expandedBackups[object.id])
                && ((component.semanticType !== 'masonry-brick' && component.semanticType !== 'masonry-paver')
                  || expandedMasonry[object.id]))
                .map((component) => <div className={`ow-tree-component${object.id === scene.selectedObjectId && component.id === scene.selectedComponentId ? ' active' : ''}`} key={component.id}>
                <button type="button" style={{ paddingLeft: component.parentId ? 30 : 19 }} onClick={() => selectComponent(object.id, component.id)} disabled={component.locked}>
                  <Box size={13} /><span>{component.name}</span>
                </button>
                <button type="button" aria-label={`${component.visible ? 'Hide' : 'Show'} ${component.name}`} onClick={() => {
                  updateObject(object.id, (current) => ({ ...current, components: current.components.map((item) => item.id === component.id
                    ? { ...item, visible: !item.visible, sourceBackup: false }
                    : item) }));
                }}>{component.visible ? <Eye size={13} /> : <EyeOff size={13} />}</button>
                <button type="button" aria-label={`${component.locked ? 'Unlock' : 'Lock'} ${component.name}`} onClick={() => {
                  updateObject(object.id, (current) => ({ ...current, components: current.components.map((item) => item.id === component.id ? { ...item, locked: !item.locked } : item) }));
                }}>{component.locked ? <LockKeyhole size={12} /> : <Unlock size={12} />}</button>
              </div>)}
              {object.components.some((component) => component.sourceBackup) && <button className="ow-backup-toggle" type="button"
                aria-expanded={Boolean(expandedBackups[object.id])} onClick={() => setExpandedBackups((current) => ({
                  ...current,
                  [object.id]: !current[object.id],
                }))}>
                <ChevronRight size={12} className={expandedBackups[object.id] ? 'expanded' : ''} />
                Previous procedural parts ({object.components.filter((component) => component.sourceBackup).length})
              </button>}
              {object.presetId === 'masonry' && <button className="ow-backup-toggle" type="button"
                aria-expanded={Boolean(expandedMasonry[object.id])} onClick={() => setExpandedMasonry((current) => ({
                  ...current,
                  [object.id]: !current[object.id],
                }))}>
                <ChevronRight size={12} className={expandedMasonry[object.id] ? 'expanded' : ''} />
                {object.masonry?.kind === 'road' ? 'Pavers' : 'Bricks'} ({object.components.filter((component) =>
                  component.semanticType === 'masonry-brick' || component.semanticType === 'masonry-paver').length})
              </button>}
            </div>)}
            <footer>
              <button type="button" title="Duplicate selected object" aria-label="Duplicate selected object" disabled={!selectedObject} onClick={() => duplicateObject()}><Layers3 size={14} /></button>
              <button type="button" title="Remove selected component" aria-label="Remove selected component" disabled={!selectedObject || selectedObject.components.length <= 1} onClick={() => selectedComponent && removeComponent(selectedComponent.id)}><Trash2 size={14} /></button>
              <button type="button" title="Delete selected object" aria-label="Delete selected object" disabled={!selectedObject} onClick={() => selectedObject && removeObject(selectedObject.id)}><X size={14} /></button>
            </footer>
          </div>
        </aside>}
        {collapsedLeft && <button className="ow-panel-reopen ow-panel-reopen-left" type="button" title="Show presets and hierarchy" onClick={() => setCollapsedLeft(false)}><ChevronRight size={16} /></button>}

        <section className="ow-viewport" aria-label="3D object viewport">
          <Canvas shadows dpr={[1, 1.75]} camera={{ position: [4.1, 3.2, 5.2], fov: 40 }}>
            <color attach="background" args={['#1b1e23']} />
            <ambientLight intensity={0.75} />
            <directionalLight position={[4, 7, 4]} intensity={2.2} castShadow shadow-mapSize={[1024, 1024]} />
            <directionalLight position={[-4, 3, -3]} intensity={0.65} color="#a8d7ff" />
            {scene.gridVisible && <Grid position={[0, -0.015, 0]} args={[14, 14]} cellSize={0.5} cellThickness={0.55} cellColor="#343a41" sectionSize={2} sectionThickness={0.9} sectionColor="#454c54" fadeDistance={16} infiniteGrid />}
            <axesHelper args={[0.8]} />
            <Suspense fallback={<AssetLoadingFallback />}>
              {scene.objects.map((object) => <WorkshopObjectView key={object.id} object={object} scene={scene} selected={object.id === scene.selectedObjectId}
                selectedComponentId={scene.selectedComponentId} groupRef={object.id === scene.selectedObjectId ? objectGroup : undefined}
                dragging={dragging} setDragging={setDragging} setSceneDirect={setSceneDirect} commitScene={commitScene}
                sceneRef={sceneRef} finishDrag={finishDrag} dragState={dragState} setSelectedPoint={setSelectedPoint} selectedPoint={selectedPoint} />)}
            </Suspense>
            <ContactShadows position={[0, -0.02, 0]} opacity={0.32} scale={12} blur={2.4} far={4} />
            <OrbitControls ref={orbitControls} makeDefault enabled={!dragging} enableDamping dampingFactor={0.085} minDistance={2.5} maxDistance={12}
              target={[selectedObject?.position[0] ?? 0, (selectedObject?.position[1] ?? 0) + 0.9, selectedObject?.position[2] ?? 0]} />
          </Canvas>
          {!selectedObject && <div className="ow-viewport-empty"><Box size={30} /><strong>Scene is empty</strong><span>Choose an object preset to begin.</span></div>}
          <div className="ow-viewport-top-hint">{scene.mode === 'cage' ? 'Drag cage points to deform the selected component' : scene.mode === 'component' ? 'Select a component, then use Move, Rotate, or Scale' : 'Orbit: drag · Pan: right-drag · Zoom: scroll'}</div>
          <div className="ow-bottom-toolbar">
            <div className="ow-tool-group">
              <ToolButton label="Select" active={scene.tool === 'select'} onClick={() => commitScene({ ...sceneRef.current, tool: 'select' })}><MousePointer2 size={17} /></ToolButton>
              <ToolButton label="Move" active={scene.tool === 'move'} onClick={() => { setSceneDirect({ ...sceneRef.current, mode: 'component', tool: 'move' }); }}><Move size={17} /></ToolButton>
              <ToolButton label="Rotate" active={scene.tool === 'rotate'} onClick={() => { setSceneDirect({ ...sceneRef.current, mode: 'component', tool: 'rotate' }); }}><RotateCcw size={16} /></ToolButton>
              <ToolButton label="Scale" active={scene.tool === 'scale'} onClick={() => { setSceneDirect({ ...sceneRef.current, mode: 'component', tool: 'scale' }); }}><Scaling size={17} /></ToolButton>
              <ToolButton label="Cage edit" active={scene.mode === 'cage'} onClick={() => commitScene({ ...sceneRef.current, mode: 'cage' })}><Grid3X3 size={17} /></ToolButton>
            </div>
            <div className="ow-tool-group ow-bottom-options">
              <label title="Constrain point and component edits to an axis"><span>Axis</span><select value={scene.axis} onChange={(event) => setSceneDirect({ ...sceneRef.current, axis: event.target.value as WorkshopScene['axis'] })}>
                <option value="free">Free</option><option value="x">X</option><option value="y">Y</option><option value="z">Z</option>
              </select></label>
              <button type="button" className={scene.gridVisible ? 'active' : ''} title="Toggle grid" aria-label="Toggle grid" onClick={() => commitScene({ ...sceneRef.current, gridVisible: !sceneRef.current.gridVisible })}><Grid3X3 size={15} /></button>
              <button type="button" className={scene.wireframe ? 'active' : ''} title="Toggle wireframe" aria-label="Toggle wireframe" onClick={() => commitScene({ ...sceneRef.current, wireframe: !sceneRef.current.wireframe })}><Box size={15} /></button>
              <button type="button" title="Reset view" aria-label="Reset view" onClick={() => orbitControls.current?.reset()}><Hand size={15} /></button>
            </div>
          </div>
        </section>

        {!collapsedRight && <aside className="ow-right-panel">
          <header className="ow-panel-header"><strong>Inspector</strong><button type="button" aria-label="Collapse inspector" onClick={() => setCollapsedRight(true)}><X size={14} /></button></header>
          {!selectedObject || !selectedComponent || !selectedComponentGeometry || !preset ? <p className="ow-empty">Select or create an object to edit it.</p> : <>
            <InspectorSection title="Transform">
              <div className="ow-transform-grid"><span>Position</span>{(['x', 'y', 'z'] as Axis[]).map((axis, index) => <NumberField key={axis} label={axis.toUpperCase()} value={selectedComponent.offset[index]} step={0.01} disabled={selectedObject.assemblyLocked || selectedComponent.locked} onChange={(value) => updateComponent(selectedComponent.id, (component) => ({ ...component, offset: withAxis(component.offset, index, value) }))} />)}</div>
              <div className="ow-transform-grid"><span>Rotation</span>{(['x', 'y', 'z'] as Axis[]).map((axis, index) => <NumberField key={axis} label={axis.toUpperCase()} value={selectedComponent.rotation[index] * 57.2958} step={1} disabled={selectedObject.assemblyLocked || selectedComponent.locked} onChange={(value) => updateComponent(selectedComponent.id, (component) => ({ ...component, rotation: withAxis(component.rotation, index, value / 57.2958) }))} />)}</div>
              <div className="ow-transform-grid"><span>Scale</span>{(['x', 'y', 'z'] as Axis[]).map((axis, index) => <NumberField key={axis} label={axis.toUpperCase()} value={selectedComponent.scale[index]} step={0.01} min={0.05} disabled={selectedObject.assemblyLocked || selectedComponent.locked} onChange={(value) => updateComponent(selectedComponent.id, (component) => ({ ...component, scale: withAxis(component.scale, index, Math.max(0.05, value)) }))} />)}</div>
            </InspectorSection>
            {masonryDraft && <InspectorSection title="Masonry Generator">
              <div className="ow-masonry-controls">
                <label className="ow-parameter"><span>Assembly</span><select aria-label="Masonry assembly type" value={masonryDraft.kind}
                  disabled={selectedObject.assemblyLocked} onChange={(event) => {
                    const kind = event.target.value as MasonryConfig['kind'];
                    const defaults = createDefaultMasonryConfig(kind);
                    setMasonryDrafts((drafts) => ({ ...drafts, [selectedObject.id]: { ...defaults, width: masonryDraft.width } }));
                  }}>
                  <option value="wall">Brick wall</option><option value="road">Paved road</option>
                </select></label>
                <label className="ow-parameter"><span>Bond pattern</span><select aria-label="Masonry bond pattern" value={masonryDraft.bond}
                  disabled={selectedObject.assemblyLocked} onChange={(event) => updateMasonryDraft((config) => ({
                    ...config, bond: event.target.value as MasonryConfig['bond'],
                  }))}>
                  <option value="running">Running bond</option><option value="stack">Stack bond</option>
                </select></label>
                <label className="ow-parameter"><span>{masonryDraft.kind === 'road' ? 'Joint fill' : 'Joint material'}</span><select aria-label="Masonry joint fill" value={masonryDraft.jointFill}
                  disabled={selectedObject.assemblyLocked} onChange={(event) => updateMasonryDraft((config) => ({
                    ...config, jointFill: event.target.value as MasonryConfig['jointFill'],
                  }))}>
                  <option value="mortar">Mortar</option><option value="sand">Sand</option>
                </select></label>
                {masonryDraft.kind === 'wall' && <label className="ow-cage-toggle ow-masonry-corner-option">
                  <input aria-label="Add wall corner returns" type="checkbox" checked={masonryDraft.cornerReturns}
                    disabled={selectedObject.assemblyLocked}
                    onChange={(event) => updateMasonryDraft((config) => ({ ...config, cornerReturns: event.target.checked }))} />
                  <span>Add returns at wall ends</span>
                </label>}
                {(masonryDraft.kind === 'wall'
                  ? [
                    ['width', 'Wall width', 0.3, 10, 0.05],
                    ['height', 'Wall height', 0.03, 6, 0.05],
                    ['depth', 'Wall thickness', 0.3, 10, 0.01],
                    ['unitLength', 'Brick length', 0.06, 1, 0.005],
                    ['unitHeight', 'Brick height', 0.03, 1, 0.005],
                    ['unitDepth', 'Brick depth', 0.03, 1, 0.01],
                  ] as const
                  : [
                    ['width', 'Road width', 0.3, 10, 0.05],
                    ['depth', 'Road length', 0.3, 10, 0.05],
                    ['height', 'Sand bed thickness', 0.03, 6, 0.005],
                    ['unitLength', 'Paver width', 0.06, 1, 0.005],
                    ['unitHeight', 'Paver length', 0.03, 1, 0.005],
                    ['unitDepth', 'Paver thickness', 0.03, 1, 0.005],
                  ] as const).map(([id, label, min, max, step]) => <div className="ow-masonry-dimension" key={id}>
                  <NumberField label={label} value={masonryDraft[id]} step={step} min={min} max={max} disabled={selectedObject.assemblyLocked}
                    onChange={(value) => updateMasonryDraft((config) => ({ ...config, [id]: clamp(value, min, max) }))} />
                </div>)}
                {masonryDraft.kind === 'wall' && masonryDraft.cornerReturns && <div className="ow-masonry-dimension">
                  <NumberField label="Return length" value={masonryDraft.returnLength} step={0.05} min={0.1} max={3}
                    disabled={selectedObject.assemblyLocked}
                    onChange={(value) => updateMasonryDraft((config) => ({ ...config, returnLength: clamp(value, 0.1, 3) }))} />
                </div>}
                <div className="ow-masonry-dimension">
                  <NumberField label="Joint width" value={masonryDraft.jointWidth} step={0.001} min={0.003} max={0.04}
                    disabled={selectedObject.assemblyLocked}
                    onChange={(value) => updateMasonryDraft((config) => ({ ...config, jointWidth: clamp(value, 0.003, 0.04) }))} />
                </div>
                <button className="ow-reset-button" type="button" disabled={selectedObject.assemblyLocked} onClick={regenerateMasonry}>
                  <Grid3X3 size={13} /> Generate {masonryDraft.kind === 'wall' ? 'brick wall' : 'paved road'}
                </button>
                <p className="ow-masonry-note">{selectedObject.assemblyLocked
                  ? 'Unlock the assembly to regenerate or edit individual pieces.'
                  : 'Generated bricks stay individually selectable. Move them in component mode to snap to the bond grid.'}</p>
              </div>
            </InspectorSection>}
            {selectedObject.presetId !== 'masonry' && <InspectorSection title={selectedComponent.assetMeshName ? 'Dimensions' : 'Procedural Parameters'}>
              <div className="ow-parameter-list">
                {preset.parameters.map((definition) => <label className="ow-parameter" key={definition.id}>
                  <span>{definition.label}</span>
                  <input aria-label={definition.label} type="range" min={definition.min} max={definition.max} step={definition.step}
                    value={selectedObject.parameters[definition.id]} onChange={(event) => setParameter(definition.id, Number(event.target.value))} />
                  <NumberField label={`${definition.label} value`} value={selectedObject.parameters[definition.id]} step={definition.step} min={definition.min}
                    onChange={(value) => setParameter(definition.id, clamp(value, definition.min, definition.max))} />
                </label>)}
                <button className="ow-reset-button" type="button" onClick={() => updateObject(selectedObject.id, (object) => ({ ...object, parameters: { ...preset.defaults } }))}><RotateCcw size={13} /> Reset parameters</button>
              </div>
            </InspectorSection>}
            {!selectedComponent.assetMeshName && <InspectorSection title="Modifiers">
              <label className="ow-parameter">
                <span>Edge bevel</span>
                <input aria-label="Edge bevel" type="range" min={0} max={0.12} step={0.001} value={selectedObject.bevel ?? 0.035}
                  onChange={(event) => updateObject(selectedObject.id, (object) => ({ ...object, bevel: Number(event.target.value) }))} />
                <output>{(selectedObject.bevel ?? 0.035).toFixed(3)} m</output>
              </label>
            </InspectorSection>}
            <InspectorSection title="Deformation Cage">
              <label className="ow-parameter"><span>Resolution</span><input aria-label="Cage resolution" type="range" min={2} max={4} step={1} value={scene.cageResolution}
                onChange={(event) => commitScene({ ...sceneRef.current, cageResolution: Number(event.target.value) })} /><output>{scene.cageResolution}</output></label>
              <label className="ow-parameter"><span>Influence</span><input aria-label="Deformation influence" type="range" min={0.25} max={1.5} step={0.01} value={scene.cageInfluence}
                onChange={(event) => commitScene({ ...sceneRef.current, cageInfluence: Number(event.target.value) })} /><output>{scene.cageInfluence.toFixed(2)}</output></label>
              <label className="ow-cage-toggle"><input type="checkbox" checked={scene.cageSymmetry} onChange={(event) => commitScene({ ...sceneRef.current, cageSymmetry: event.target.checked })} /> X symmetry</label>
              <div className="ow-cage-actions">              <button type="button" onClick={() => changeCageResolution(sceneRef.current.cageResolution + 1)} disabled={scene.cageResolution >= 4}><Plus size={13} /> Add points</button>
                <button type="button" onClick={() => changeCageResolution(sceneRef.current.cageResolution - 1)} disabled={scene.cageResolution <= 2}><X size={13} /> Reduce points</button></div>
              <div className="ow-small-copy">{selectedPoint ? `Control point ${selectedPoint} selected. Drag a handle to move it.` : 'Cage offsets apply to the selected component geometry.'}</div>
              <button className="ow-reset-button" type="button" disabled={!Object.keys(componentOffsets).length} onClick={() => {
                updateObject(selectedObject.id, (object) => ({ ...object, cageOffsets: { ...object.cageOffsets, [selectedComponent.id]: {} } }));
                setSelectedPoint(null);
              }}><RotateCcw size={13} /> Reset selected cage</button>
            </InspectorSection>
            <InspectorSection title="Material">
              <div className="ow-material-grid">
                {Object.entries(WORKSHOP_MATERIALS).map(([id, material]) => <button type="button" key={id} className={selectedComponent.materialId === id ? 'active' : ''}
                  title={`Assign ${material.name}`} aria-label={`Assign ${material.name}`} onClick={() => updateComponent(selectedComponent.id, (component) => ({ ...component, materialId: id }))}>
                  <span style={{ backgroundColor: material.color }} />{material.name}
                </button>)}
              </div>
            </InspectorSection>
            {selectedComponent.assetMeshName && selectedAsset && <InspectorSection title="Source Asset">
              <div className="ow-asset-source">
                <a href={selectedAsset.sourceUrl} target="_blank" rel="noreferrer">{selectedAsset.sourceName}</a>
                <span>By {selectedAsset.author}</span>
                <a href={selectedAsset.licenseUrl} target="_blank" rel="noreferrer">{selectedAsset.license}</a>
                <span>Bundled locally · 1K PBR · {selectedAsset.downloadedAt}</span>
              </div>
            </InspectorSection>}
          </>}
        </aside>}
        {collapsedRight && <button className="ow-panel-reopen ow-panel-reopen-right" type="button" title="Show inspector" onClick={() => setCollapsedRight(false)}><ChevronDown size={16} /></button>}
      </section>
      <footer className="ow-status-bar"><span className={error ? 'error' : ''}>{error || status || (dragging ? 'Editing geometry…' : `${scene.objects.length} object${scene.objects.length === 1 ? '' : 's'} · Autosaved in this browser`)}</span>
        <span>{selectedComponent?.name ?? 'No component selected'}{selectedObject ? ` · ${selectedObject.presetId}` : ''}</span></footer>
    </main>
  );
}

function WorkshopObjectView(props: {
  object: WorkshopObject;
  scene: WorkshopScene;
  selected: boolean;
  selectedComponentId: string;
  groupRef?: RefObject<THREE.Group | null>;
  dragging: boolean;
  setDragging: (dragging: boolean) => void;
  setSceneDirect: (scene: WorkshopScene) => void;
  commitScene: (scene: WorkshopScene) => void;
  sceneRef: MutableRefObject<WorkshopScene>;
  finishDrag: () => void;
  dragState: RefObject<DragState | null>;
  setSelectedPoint: (key: string | null) => void;
  selectedPoint: string | null;
}) {
  const { object } = props;
  return <group ref={props.groupRef} position={object.position} rotation={object.rotation} scale={object.scale}>
    {object.components.filter((item) => item.visible).map((item) => {
      return <WorkshopComponentView key={item.id} object={object} component={item} scene={props.scene}
        selected={props.selected && item.id === props.selectedComponentId}
        parentGroupRef={props.groupRef}
        sceneRef={props.sceneRef} dragState={props.dragState}
        setSceneDirect={props.setSceneDirect} finishDrag={props.finishDrag}
        setDragging={props.setDragging} setSelectedPoint={props.setSelectedPoint} selectedPoint={props.selectedPoint} />;
    })}
  </group>;
}

function WorkshopComponentView(props: {
  object: WorkshopObject;
  component: WorkshopComponent;
  scene: WorkshopScene;
  selected: boolean;
  parentGroupRef?: RefObject<THREE.Group | null>;
  sceneRef: MutableRefObject<WorkshopScene>;
  dragState: RefObject<DragState | null>;
  setSceneDirect: (scene: WorkshopScene) => void;
  finishDrag: () => void;
  setDragging: (dragging: boolean) => void;
  setSelectedPoint: (key: string | null) => void;
  selectedPoint: string | null;
}) {
  const { object, component, scene } = props;
  const camera = useThree((state) => state.camera);
  const componentGroup = useRef<THREE.Group>(null);
  const geometry = getComponentGeometry(object, component);
  const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (!props.selected) {
      props.setSceneDirect({ ...props.sceneRef.current, selectedObjectId: object.id, selectedComponentId: component.id });
      return;
    }
    if (scene.mode === 'cage' || scene.tool === 'select') return;
    const moveAssembly = object.assemblyLocked && scene.tool === 'move';
    if ((object.assemblyLocked && !moveAssembly) || (!moveAssembly && component.locked)) return;
    event.stopPropagation();
    const worldPoint = moveAssembly ? event.point.clone() : componentGroup.current!.localToWorld(new THREE.Vector3());
    const normal = camera.getWorldDirection(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, worldPoint);
    props.dragState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPosition: component.offset,
      startHit: moveAssembly ? undefined : props.parentGroupRef!.current!.worldToLocal(event.point.clone()).toArray() as WorkshopVec3,
      startWorldHit: moveAssembly ? event.point.toArray() as WorkshopVec3 : undefined,
      startObjectPosition: moveAssembly ? [...object.position] : undefined,
      startOffset: component.offset,
      startRotation: component.rotation,
      startScale: component.scale,
      plane,
      axis: scene.axis,
      kind: moveAssembly ? 'object' : 'component',
      before: props.sceneRef.current,
    };
    capturePointer(event);
    props.setDragging(true);
  };
  const onPointerMove = (event: ThreeEvent<PointerEvent>) => {
    const drag = props.dragState.current;
    if (!drag || drag.pointerId !== event.pointerId || (drag.kind !== 'component' && drag.kind !== 'object')) return;
    const currentScene = props.sceneRef.current;
    if (drag.kind === 'object') {
      const hit = event.ray.intersectPlane(drag.plane, new THREE.Vector3());
      if (!hit || !drag.startWorldHit || !drag.startObjectPosition) return;
      const position: WorkshopVec3 = [
        drag.startObjectPosition[0] + hit.x - drag.startWorldHit[0],
        drag.startObjectPosition[1] + hit.y - drag.startWorldHit[1],
        drag.startObjectPosition[2] + hit.z - drag.startWorldHit[2],
      ];
      props.setSceneDirect({
        ...currentScene,
        objects: currentScene.objects.map((item) => item.id === object.id ? { ...item, position } : item),
      });
      return;
    }
    if (scene.tool === 'move') {
      const hit = event.ray.intersectPlane(drag.plane, new THREE.Vector3());
      if (!hit || !props.parentGroupRef?.current) return;
      const local = props.parentGroupRef.current.worldToLocal(hit);
      const next = [
        drag.startOffset[0] + local.x - (drag.startHit?.[0] ?? geometry.position[0]),
        drag.startOffset[1] + local.y - (drag.startHit?.[1] ?? geometry.position[1]),
        drag.startOffset[2] + local.z - (drag.startHit?.[2] ?? geometry.position[2]),
      ] as WorkshopVec3;
      const snapped = object.masonry && (component.semanticType === 'masonry-brick' || component.semanticType === 'masonry-paver')
        ? snapMasonryOffsetFromAnchor(next, object.masonry, drag.startOffset)
        : next;
      props.setSceneDirect(replaceComponent(currentScene, object.id, component.id, (current) => ({
        ...current,
        offset: constrainAxis(drag.startOffset, snapped, drag.axis),
      })));
    } else {
      const dx = (event.clientX - drag.startX) * 0.008;
      const dy = (event.clientY - drag.startY) * 0.008;
      props.setSceneDirect(replaceComponent(currentScene, object.id, component.id, (current) => ({
        ...current,
        rotation: scene.tool === 'rotate' ? [drag.startRotation[0] + dy, drag.startRotation[1] + dx, drag.startRotation[2]] : current.rotation,
        scale: scene.tool === 'scale' ? drag.startScale.map((value) => clamp(value + dx, 0.05, 5)) as WorkshopVec3 : current.scale,
      })));
    }
  };
  const onPointerUp = (event: ThreeEvent<PointerEvent>) => {
    const drag = props.dragState.current;
    if (drag?.pointerId !== event.pointerId || (drag.kind !== 'component' && drag.kind !== 'object')) return;
    releasePointer(event);
    props.finishDrag();
  };
  const onPointerCancel = () => props.finishDrag();

  const asset = component.assetMeshName ? getWorkshopAsset(object.presetId) : null;
  return <group ref={componentGroup} position={geometry.position} rotation={geometry.rotation}>
    {asset && component.assetMeshName
      ? <ImportedComponentMesh src={getWorkshopAssetUrl(asset.fileName)} object={object} component={component}
        scene={scene} dimensions={geometry.size} meshName={component.assetMeshName} selected={props.selected}
        onSelect={() => props.setSceneDirect({ ...props.sceneRef.current, selectedObjectId: object.id, selectedComponentId: component.id })}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} />
      : <ComponentMesh object={object} component={component} scene={scene} selected={props.selected}
        onSelect={() => props.setSceneDirect({ ...props.sceneRef.current, selectedObjectId: object.id, selectedComponentId: component.id })}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} />}
    {props.selected && scene.mode === 'cage' && !component.locked && <CageEditor
      component={component} size={geometry.size} offsets={object.cageOffsets[component.id] ?? {}} scene={scene}
      selectedPoint={props.selectedPoint} setSelectedPoint={props.setSelectedPoint} groupRef={componentGroup}
      camera={camera} dragState={props.dragState} setDragging={props.setDragging} setSceneDirect={props.setSceneDirect}
      sceneRef={props.sceneRef} finishDrag={props.finishDrag} object={object} />}
  </group>;
}

function ComponentMesh({ object, component, scene, selected, onSelect, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }: {
  object: WorkshopObject; component: WorkshopComponent; scene: WorkshopScene; selected: boolean; onSelect: () => void;
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
  onPointerMove: (event: ThreeEvent<PointerEvent>) => void;
  onPointerUp: (event: ThreeEvent<PointerEvent>) => void;
  onPointerCancel: () => void;
}) {
  const descriptor = getComponentGeometry(object, component);
  const dimensions = descriptor.size;
  const geometry = useMemo(() => {
    return createWorkshopMeshGeometry(object, component, dimensions, descriptor.shape, scene);
  }, [component.id, component.semanticType, dimensions[0], dimensions[1], dimensions[2], descriptor.shape, object.bevel, object.cageOffsets, scene.cageInfluence, scene.cageResolution]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = WORKSHOP_MATERIALS[component.materialId] ?? WORKSHOP_MATERIALS[object.materialId];
  return <mesh castShadow receiveShadow geometry={geometry} onClick={(event) => { event.stopPropagation(); onSelect(); }}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}>
    <meshStandardMaterial color={material.color} roughness={material.roughness} metalness={material.metalness} wireframe={scene.wireframe} />
    {selected && scene.mode !== 'cage' && <mesh scale={[1.008, 1.008, 1.008]} geometry={geometry} raycast={() => null}>
      <meshBasicMaterial color="#55c9e8" wireframe transparent opacity={0.34} depthTest />
    </mesh>}
  </mesh>;
}

function ImportedComponentMesh({ src, object, component, scene, dimensions, meshName, selected, onSelect, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }: {
  src: string;
  object: WorkshopObject;
  component: WorkshopComponent;
  scene: WorkshopScene;
  dimensions: WorkshopVec3;
  meshName: string;
  selected: boolean;
  onSelect: () => void;
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
  onPointerMove: (event: ThreeEvent<PointerEvent>) => void;
  onPointerUp: (event: ThreeEvent<PointerEvent>) => void;
  onPointerCancel: () => void;
}) {
  const gltf = useGLTF(src);
  const sourceMesh = useMemo(() => findAssetMesh(gltf.scene, meshName), [gltf.scene, meshName]);
  const geometry = useMemo(() => createWorkshopAssetGeometry(
    sourceMesh.geometry,
    object.cageOffsets[component.id] ?? {},
    scene,
  ), [sourceMesh.geometry, object.cageOffsets, component.id, scene.cageResolution, scene.cageInfluence]);
  const material = useMemo(() => cloneAssetMaterial(sourceMesh.material, component.materialId, scene.wireframe),
    [sourceMesh.material, component.materialId, scene.wireframe]);
  useEffect(() => () => {
    geometry.dispose();
    disposeMaterial(material);
  }, [geometry, material]);

  return <mesh name={meshName} geometry={geometry} material={material} scale={dimensions} castShadow receiveShadow
    onClick={(event) => { event.stopPropagation(); onSelect(); }}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}>
    {selected && scene.mode !== 'cage' && <mesh scale={[1.008, 1.008, 1.008]} geometry={geometry} raycast={() => null}>
      <meshBasicMaterial color="#55c9e8" wireframe transparent opacity={0.34} depthTest />
    </mesh>}
  </mesh>;
}

function createWorkshopAssetGeometry(
  source: THREE.BufferGeometry,
  offsets: Record<string, WorkshopVec3>,
  scene: WorkshopScene,
) {
  const geometry = source.clone();
  const position = geometry.getAttribute('position');
  for (let index = 0; index < position.count; index += 1) {
    const deformed = deformWorkshopVertex(
      [position.getX(index), position.getY(index), position.getZ(index)],
      offsets,
      scene.cageResolution,
      scene.cageInfluence,
    );
    position.setXYZ(index, ...deformed);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function cloneAssetMaterial(
  source: THREE.Material | THREE.Material[],
  materialId: string,
  wireframe: boolean,
): THREE.Material | THREE.Material[] {
  const definition = WORKSHOP_MATERIALS[materialId] ?? WORKSHOP_MATERIALS.original;
  const clone = (material: THREE.Material) => {
    const copy = material.clone();
    if (copy instanceof THREE.MeshStandardMaterial) {
      if (materialId !== 'original') {
        copy.color.multiply(new THREE.Color(definition.color));
        copy.roughness = definition.roughness;
        copy.metalness = definition.metalness;
      }
      copy.wireframe = wireframe;
    }
    return copy;
  };
  return Array.isArray(source) ? source.map(clone) : clone(source);
}

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  for (const item of Array.isArray(material) ? material : [material]) item.dispose();
}

function findAssetMesh(scene: THREE.Object3D, meshName: string): THREE.Mesh {
  let result: THREE.Mesh | null = null;
  scene.traverse((child) => {
    if (!result && child instanceof THREE.Mesh && child.name === meshName) result = child;
  });
  if (!result) throw new Error(`The downloaded model is missing the expected component "${meshName}".`);
  return result;
}

function createWorkshopMeshGeometry(
  object: WorkshopObject,
  component: WorkshopComponent,
  dimensions: WorkshopVec3,
  shape: 'box' | 'shield',
  scene: WorkshopScene,
) {
  const cushionBoost = component.semanticType === 'cushion' || component.semanticType === 'backrest' ? 0.025
    : component.semanticType === 'armrest-left' || component.semanticType === 'armrest-right' ? 0.012 : 0;
  const bevel = Math.min(object.bevel + cushionBoost, Math.min(...dimensions) * 0.45);
  const geometry = bevel > 0
    ? new RoundedBoxGeometry(...dimensions, Math.max(10, scene.cageResolution * 5), bevel)
    : new THREE.BoxGeometry(...dimensions, scene.cageResolution * 5, scene.cageResolution * 5, scene.cageResolution * 5);
  if (shape === 'shield') applyShieldShape(geometry, dimensions);
  if (component.semanticType === 'cushion' || component.semanticType === 'backrest') {
    applyUpholsteryShape(geometry, dimensions, component.semanticType);
  }

  const offsets = object.cageOffsets[component.id] ?? {};
  if (Object.keys(offsets).length) {
    const position = geometry.getAttribute('position');
    for (let index = 0; index < position.count; index += 1) {
      const original = [position.getX(index) / dimensions[0], position.getY(index) / dimensions[1], position.getZ(index) / dimensions[2]] as WorkshopVec3;
      const deformed = deformWorkshopVertex(original, offsets, scene.cageResolution, scene.cageInfluence);
      position.setXYZ(index, deformed[0] * dimensions[0], deformed[1] * dimensions[1], deformed[2] * dimensions[2]);
    }
    position.needsUpdate = true;
  }
  geometry.computeVertexNormals();
  return geometry;
}

function CageEditor(props: {
  component: WorkshopComponent; size: WorkshopVec3; offsets: Record<string, WorkshopVec3>;
  scene: WorkshopScene; selectedPoint: string | null; setSelectedPoint: (key: string | null) => void;
  groupRef: RefObject<THREE.Group | null>; camera: THREE.Camera; dragState: RefObject<DragState | null>;
  setDragging: (dragging: boolean) => void; setSceneDirect: (scene: WorkshopScene) => void;
  sceneRef: MutableRefObject<WorkshopScene>; finishDrag: () => void; object: WorkshopObject;
}) {
  const resolution = props.scene.cageResolution;
  const handles: Array<{ key: string; coords: [number, number, number]; position: WorkshopVec3 }> = [];
  for (let x = 0; x <= resolution; x += 1) {
    for (let y = 0; y <= resolution; y += 1) {
      for (let z = 0; z <= resolution; z += 1) {
        const key = cagePointIndex(x, y, z, resolution);
        const rest = cagePointRestPosition(x, y, z, resolution);
        const offset = props.offsets[key] ?? [0, 0, 0];
        handles.push({
          key,
          coords: [x, y, z],
          position: [(rest[0] + offset[0]) * props.size[0], (rest[1] + offset[1]) * props.size[1], (rest[2] + offset[2]) * props.size[2]],
        });
      }
    }
  }
  const wirePositions = useMemo(() => {
    const positions: number[] = [];
    for (let x = 0; x <= resolution; x += 1) {
      for (let y = 0; y <= resolution; y += 1) {
        for (let z = 0; z <= resolution; z += 1) {
          const point = handles.find((item) => item.key === cagePointIndex(x, y, z, resolution))!.position;
          for (const [nx, ny, nz] of [[x + 1, y, z], [x, y + 1, z], [x, y, z + 1]]) {
            if (nx > resolution || ny > resolution || nz > resolution) continue;
            const neighbor = handles.find((item) => item.key === cagePointIndex(nx, ny, nz, resolution))!.position;
            positions.push(...point, ...neighbor);
          }
        }
      }
    }
    return new Float32Array(positions);
  }, [resolution, props.offsets, props.size]);

  const handlePointerDown = (event: ThreeEvent<PointerEvent>, handle: typeof handles[number]) => {
    event.stopPropagation();
    const worldPoint = props.groupRef.current!.localToWorld(new THREE.Vector3(...handle.position));
    const planeNormal = props.camera.getWorldDirection(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, worldPoint);
    const offset = props.offsets[handle.key] ?? [0, 0, 0];
    props.dragState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPosition: handle.position,
      startRotation: [0, 0, 0],
      startScale: [1, 1, 1],
      startOffset: offset,
      plane,
      axis: props.scene.axis,
      kind: 'cage',
      pointKey: handle.key,
      pointCoordinates: handle.coords,
      before: props.sceneRef.current,
    };
    props.setSelectedPoint(handle.key);
    capturePointer(event);
    props.setDragging(true);
  };
  const handlePointerMove = (event: ThreeEvent<PointerEvent>) => {
    const drag = props.dragState.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.kind !== 'cage' || !drag.pointKey || !drag.pointCoordinates) return;
    const world = event.ray.intersectPlane(drag.plane, new THREE.Vector3());
    if (!world || !props.groupRef.current) return;
    const local = props.groupRef.current.worldToLocal(world);
    const [x, y, z] = drag.pointCoordinates;
    const rest = cagePointRestPosition(x, y, z, resolution);
    const next: WorkshopVec3 = [local.x / props.size[0] - rest[0], local.y / props.size[1] - rest[1], local.z / props.size[2] - rest[2]];
    const constrained = constrainAxis(drag.startOffset, next, drag.axis);
    const offsets: Record<string, WorkshopVec3> = { ...props.offsets, [drag.pointKey]: constrained };
    if (props.scene.cageSymmetry) {
      const mirrorKey = cagePointIndex(resolution - x, y, z, resolution);
      if (mirrorKey !== drag.pointKey) offsets[mirrorKey] = [-constrained[0], constrained[1], constrained[2]];
    }
    props.setSceneDirect({
      ...props.sceneRef.current,
      objects: props.sceneRef.current.objects.map((object) => object.id === props.object.id
        ? { ...object, cageOffsets: { ...object.cageOffsets, [props.component.id]: offsets } }
        : object),
    });
  };
  const handlePointerUp = (event: ThreeEvent<PointerEvent>) => {
    const drag = props.dragState.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.kind !== 'cage') return;
    releasePointer(event);
    props.finishDrag();
  };

  return <group>
    <lineSegments raycast={() => null}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[wirePositions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color="#76dff3" transparent opacity={0.78} depthTest />
    </lineSegments>
    {handles.map((handle) => <mesh key={handle.key} position={handle.position}
      onPointerDown={(event) => handlePointerDown(event, handle)}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}>
      <sphereGeometry args={[props.selectedPoint === handle.key ? 0.045 : 0.029, 12, 12]} />
      <meshBasicMaterial color={props.selectedPoint === handle.key ? '#ffffff' : '#52d2e8'}
        toneMapped={false} />
    </mesh>)}
  </group>;
}

function ToolButton({ children, label, active, onClick }: { children: ReactNode; label: string; active: boolean; onClick: () => void }) {
  return <button type="button" className={active ? 'active' : ''} aria-label={label} title={label} onClick={onClick}>{children}<span>{label}</span></button>;
}

function InspectorSection({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return <section className="ow-inspector-section"><button className="ow-inspector-heading" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
    <ChevronDown size={14} className={open ? '' : 'collapsed'} /><strong>{title}</strong></button>{open && <div className="ow-inspector-content">{children}</div>}</section>;
}

function NumberField({ label, value, step, min, max, disabled, onChange }: {
  label: string;
  value: number;
  step: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return <label className="ow-number-field"><span>{label}</span><input aria-label={label} type="number" step={step} min={min} max={max} disabled={disabled} value={Number(value.toFixed(3))} onChange={(event) => {
    const parsed = Number(event.target.value);
    if (event.target.value !== '' && Number.isFinite(parsed)) onChange(parsed);
  }} /></label>;
}

function PresetGlyph({ preset }: { preset: WorkshopPresetId }) {
  return <span className={`ow-preset-glyph ${preset}`}>{preset === 'masonry' ? <Grid3X3 size={23} /> : <Armchair size={23} />}</span>;
}

function AssetLoadingFallback() {
  const { active, progress } = useProgress();
  return active ? <Html center><div className="ow-asset-loading">Loading model {Math.round(progress)}%</div></Html> : null;
}

function getWorkshopAssetUrl(fileName: string) {
  const baseUrl = import.meta.env.BASE_URL;
  return `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}assets/object-workshop/${fileName}`;
}

function loadSavedScene(): WorkshopScene {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return createWorkshopScene();
    const parsed: unknown = JSON.parse(saved);
    return normalizeWorkshopScene(parsed) ?? createWorkshopScene();
  } catch {
    return createWorkshopScene();
  }
}

async function buildExportObject(scene: WorkshopScene): Promise<THREE.Group> {
  const root = new THREE.Group();
  root.name = 'Object Workshop Scene';
  const loader = new GLTFLoader();
  const assetScenes = new Map<string, THREE.Object3D>();
  for (const object of scene.objects) {
    const objectGroup = new THREE.Group();
    objectGroup.name = object.name;
    objectGroup.position.set(...object.position);
    objectGroup.rotation.set(...object.rotation);
    objectGroup.scale.set(...object.scale);
    const asset = getWorkshopAsset(object.presetId);
    const assetUrl = asset ? getWorkshopAssetUrl(asset.fileName) : null;
    if (assetUrl && object.components.some((component) => component.assetMeshName)) {
      if (!assetScenes.has(assetUrl)) assetScenes.set(assetUrl, (await loader.loadAsync(assetUrl)).scene);
    }
    for (const component of object.components.filter((item) => item.visible)) {
      const descriptor = getComponentGeometry(object, component);
      let mesh: THREE.Mesh;
      if (component.assetMeshName && assetUrl) {
        const source = findAssetMesh(assetScenes.get(assetUrl)!, component.assetMeshName);
        const geometry = createWorkshopAssetGeometry(source.geometry, object.cageOffsets[component.id] ?? {}, scene);
        const material = cloneAssetMaterial(source.material, component.materialId, false);
        mesh = new THREE.Mesh(geometry, material);
        mesh.scale.set(...descriptor.size);
      } else {
        const geometry = createWorkshopMeshGeometry(object, component, descriptor.size, descriptor.shape, scene);
        const definition = WORKSHOP_MATERIALS[component.materialId] ?? WORKSHOP_MATERIALS[object.materialId];
        mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
          color: definition.color,
          roughness: definition.roughness,
          metalness: definition.metalness,
        }));
      }
      mesh.name = component.name;
      mesh.position.set(...descriptor.position);
      mesh.rotation.set(...descriptor.rotation);
      objectGroup.add(mesh);
    }
    root.add(objectGroup);
  }
  return root;
}

function downloadFile(filename: string, text: string, type: string) {
  downloadBlob(filename, new Blob([text], { type }));
}

function applyShieldShape(geometry: THREE.BufferGeometry, dimensions: WorkshopVec3) {
  const position = geometry.getAttribute('position');
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const taper = 1 - Math.max(0, -y / dimensions[1]) * 0.42;
    position.setX(index, x * taper);
    position.setZ(index, position.getZ(index) + Math.max(0, 1 - Math.abs(y / (dimensions[1] * 0.5))) * 0.05);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

function applyUpholsteryShape(geometry: THREE.BufferGeometry, dimensions: WorkshopVec3, semanticType: string) {
  const position = geometry.getAttribute('position');
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index) / (dimensions[0] * 0.5);
    if (semanticType === 'backrest') {
      const y = position.getY(index) / (dimensions[1] * 0.5);
      const centerBulge = Math.max(0, 1 - x * x) * Math.max(0, 1 - y * y) * 0.035;
      position.setZ(index, position.getZ(index) + centerBulge);
    } else {
      const z = position.getZ(index) / (dimensions[2] * 0.5);
      const crown = Math.max(0, 1 - x * x) * Math.max(0, 1 - z * z) * 0.025;
      position.setY(index, position.getY(index) + crown);
    }
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.replace(/[\\/:*?"<>|]+/g, '-');
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function withAxis(vector: WorkshopVec3, index: number, value: number): WorkshopVec3 {
  return vector.map((item, axis) => axis === index ? value : item) as WorkshopVec3;
}

function constrainAxis(start: WorkshopVec3, next: WorkshopVec3, axis: WorkshopScene['axis']): WorkshopVec3 {
  if (axis === 'free') return next;
  return next.map((value, index) => pointAxes[index] === axis ? value : start[index]) as WorkshopVec3;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function capturePointer(event: ThreeEvent<PointerEvent>) {
  const target = event.nativeEvent.target;
  if (target instanceof Element) target.setPointerCapture(event.pointerId);
}

function releasePointer(event: ThreeEvent<PointerEvent>) {
  const target = event.nativeEvent.target;
  if (target instanceof Element && target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
}

function replaceComponent(scene: WorkshopScene, objectId: string, componentId: string, update: (component: WorkshopComponent) => WorkshopComponent) {
  return { ...scene, objects: scene.objects.map((object) => object.id === objectId
    ? { ...object, components: object.components.map((component) => component.id === componentId ? update(component) : component) }
    : object) };
}

function remapOffsets(offsets: Record<string, WorkshopVec3>, oldResolution: number, nextResolution: number) {
  const result: Record<string, WorkshopVec3> = {};
  for (const [key, offset] of Object.entries(offsets)) {
    const [x, y, z] = key.split(':').map(Number);
    if (![x, y, z].every(Number.isFinite)) continue;
    const next = [
      Math.round(x / oldResolution * nextResolution),
      Math.round(y / oldResolution * nextResolution),
      Math.round(z / oldResolution * nextResolution),
    ] as const;
    result[cagePointIndex(next[0], next[1], next[2], nextResolution)] = offset;
  }
  return result;
}
