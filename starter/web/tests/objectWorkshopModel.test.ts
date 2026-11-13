import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cagePointIndex,
  createDefaultMasonryConfig,
  createMasonryComponents,
  createWorkshopObject,
  createWorkshopScene,
  deformWorkshopVertex,
  getComponentGeometry,
  isWorkshopScene,
  normalizeWorkshopScene,
  placeWorkshopObjectWithoutOverlap,
  snapMasonryOffsetFromAnchor,
  WORKSHOP_PRESETS,
} from '../src/objectWorkshopModel.ts';

test('all supported presets create valid component scenes', () => {
  for (const preset of WORKSHOP_PRESETS) {
    const object = createWorkshopObject(preset.id, preset.name, `test-${preset.id}`);
    const scene = {
      ...createWorkshopScene(),
      objects: [object],
      selectedObjectId: object.id,
      selectedComponentId: object.components[0].id,
    };

    assert.equal(isWorkshopScene(scene), true, `${preset.id} scene should validate`);
    assert.equal(new Set(object.components.map(({ id }) => id)).size, object.components.length);
    assert.ok(object.components.every((component) => component.parentId === null
      || object.components.some(({ id }) => id === component.parentId)));
  }
});

test('masonry generator creates bounded selectable bricks with running and stack bonds', () => {
  const config = createDefaultMasonryConfig();
  const running = createMasonryComponents(config);
  const stack = createMasonryComponents({ ...config, bond: 'stack' });
  const wall = createWorkshopObject('masonry', 'Test wall', 'test-masonry');
  wall.components = running;

  assert.ok(isWorkshopScene({
    ...createWorkshopScene(),
    objects: [wall],
    selectedObjectId: wall.id,
    selectedComponentId: running[1].id,
  }));
  assert.equal(running[0].semanticType, 'masonry-base');
  assert.ok(running.length > 2 && running.length <= 351);
  assert.equal(new Set(running.map(({ id }) => id)).size, running.length);
  assert.ok(running.slice(1).every((component) => component.semanticType === 'masonry-brick'
    && component.parentId === running[0].id
    && component.geometrySize
    && Math.abs(component.offset[0]) + component.geometrySize[0] / 2 <= config.width / 2 + 0.005
    && component.offset[1] - component.geometrySize[1] / 2 >= -0.005
    && component.offset[1] + component.geometrySize[1] / 2 <= config.height + 0.005));

  const runningRows = new Map<number, number[]>();
  for (const component of running.slice(1)) {
    const row = Math.round(component.offset[1] / (config.unitHeight + config.jointWidth));
    runningRows.set(row, [...(runningRows.get(row) ?? []), component.offset[0]]);
  }
  const stackRows = new Map<number, number[]>();
  for (const component of stack.slice(1)) {
    const row = Math.round(component.offset[1] / (config.unitHeight + config.jointWidth));
    stackRows.set(row, [...(stackRows.get(row) ?? []), component.offset[0]]);
  }
  assert.notDeepEqual(runningRows.get(0), runningRows.get(1));
  assert.equal(stackRows.get(0)?.[0], stackRows.get(1)?.[0]);
  assert.ok(running[0].materialId === 'mortar');
  assert.ok(new Set(running.slice(1).map(({ materialId }) => materialId)).size > 1);

  const cornerConfig = { ...config, cornerReturns: true, returnLength: 0.6 };
  const corners = createMasonryComponents(cornerConfig);
  const cornerBricks = corners.filter((component) => component.name.includes('corner brick'));
  const courses = Math.floor((config.height + config.jointWidth) / (config.unitHeight + config.jointWidth));
  assert.equal(cornerBricks.length, courses * 2);
  assert.ok(cornerBricks.every((component) => component.rotation[1] === Math.PI / 2));
  assert.equal(corners.filter((component) => component.semanticType === 'masonry-return-bed').length, 2);
});

test('paved road generator creates sand-backed pavers and snaps edits to the bond grid', () => {
  const config = createDefaultMasonryConfig('road');
  const road = createMasonryComponents(config);
  assert.equal(road[0].materialId, 'sand');
  assert.ok(road.slice(1).every((component) => component.semanticType === 'masonry-paver'
    && component.offset[1] - component.geometrySize![1] / 2 >= config.height - 0.003));
  const roadObject = createWorkshopObject('masonry', 'Test road', 'test-road');
  roadObject.masonry = config;
  roadObject.components = road;
  assert.ok(isWorkshopScene({
    ...createWorkshopScene(),
    objects: [roadObject],
    selectedObjectId: roadObject.id,
    selectedComponentId: road[1].id,
  }));
  assert.deepEqual(snapMasonryOffsetFromAnchor(
    [0.46, 0.2, -0.08],
    config,
    [0.2, 0.1, -0.2],
  ), [
    0.2 + config.unitLength + config.jointWidth,
    0.1 + config.unitDepth + config.jointWidth,
    -0.2 + config.unitHeight + config.jointWidth,
  ]);
  assert.throws(() => createMasonryComponents({ ...config, width: 10, depth: 10 }), /350 masonry pieces/);
});

test('masonry settings and generated component dimensions are validated', () => {
  const masonry = createWorkshopObject('masonry', 'Masonry', 'valid-masonry');
  const scene = {
    ...createWorkshopScene(),
    objects: [masonry],
    selectedObjectId: masonry.id,
    selectedComponentId: masonry.components[1].id,
  };
  assert.equal(isWorkshopScene(scene), true);

  const invalidConfig = structuredClone(scene);
  invalidConfig.objects[0].masonry!.jointWidth = 0.2;
  assert.equal(isWorkshopScene(invalidConfig), false);

  const invalidGeometry = structuredClone(scene);
  invalidGeometry.objects[0].components[1].geometrySize![0] = -1;
  assert.equal(isWorkshopScene(invalidGeometry), false);
});

test('procedural dimensions and chair attachments respond to parameter values', () => {
  const chair = createWorkshopObject('chair', 'Test chair', 'test-chair');
  const [frame, upholstery] = chair.components;
  const seat = { ...frame, name: 'Seat', semanticType: 'seat', assetMeshName: undefined };
  const leg = { ...frame, id: 'legacy-leg', name: 'Front left leg', semanticType: 'leg-front-left', assetMeshName: undefined };
  const backrest = { ...upholstery, id: 'legacy-backrest', name: 'Backrest', semanticType: 'backrest', assetMeshName: undefined };
  const support = { ...frame, id: 'legacy-support', name: 'Backrest support', semanticType: 'backrest-support-left', assetMeshName: undefined };
  const originalSeat = getComponentGeometry(chair, seat);
  chair.parameters.width += 0.4;
  const widerSeat = getComponentGeometry(chair, seat);
  assert.ok(Math.abs((widerSeat.size[0] - originalSeat.size[0]) - 0.4) < 1e-9);

  const legGeometry = getComponentGeometry(chair, leg);
  const backrestGeometry = getComponentGeometry(chair, backrest);
  assert.ok(Math.abs((legGeometry.position[1] + legGeometry.size[1] / 2)
    - chair.parameters.legHeight) < 1e-9);
  assert.ok(Math.abs((backrestGeometry.position[1] - backrestGeometry.size[1] / 2)
    - (chair.parameters.legHeight + 0.06)) < 1e-9);
  const supportGeometry = getComponentGeometry(chair, support);
  assert.ok(Math.abs((supportGeometry.position[1] - supportGeometry.size[1] / 2)
    - chair.parameters.legHeight) < 1e-9);
});

test('downloaded model bases preserve component identities and resize with preset dimensions', () => {
  for (const preset of WORKSHOP_PRESETS.filter(({ id }) => ['chair', 'stool', 'table', 'wall', 'shield'].includes(id))) {
    const object = createWorkshopObject(preset.id, preset.name, `asset-${preset.id}`);
    assert.ok(object.components.every(({ assetMeshName }) => typeof assetMeshName === 'string'));
    assert.ok(object.components.every(({ materialId }) => materialId === 'original'));
    assert.ok(object.components.every((component) => component.parentId === null
      || object.components.some(({ id }) => id === component.parentId)));
  }

  const chair = createWorkshopObject('chair', 'Asset chair', 'asset-chair-resize');
  const frame = chair.components.find(({ semanticType }) => semanticType === 'asset-frame')!;
  const original = getComponentGeometry(chair, frame);
  chair.parameters.width += 0.3;
  const wider = getComponentGeometry(chair, frame);
  assert.ok(Math.abs((wider.size[0] - original.size[0]) - 0.3) < 1e-9);
  assert.ok(Math.abs(wider.size[1] - (chair.parameters.legHeight + chair.parameters.backrestHeight + 0.12)) < 1e-9);
});

test('new presets receive positions clear of existing objects', () => {
  const chair = createWorkshopObject('chair', 'Chair', 'place-chair');
  const table = placeWorkshopObjectWithoutOverlap(createWorkshopObject('table', 'Table', 'place-table'), [chair]);
  const chairRadius = Math.max(...chair.components.map((component) => {
    const geometry = getComponentGeometry(chair, component);
    return Math.hypot(
      Math.abs(geometry.position[0]) + geometry.size[0] / 2,
      Math.abs(geometry.position[2]) + geometry.size[2] / 2,
    );
  }));
  const tableRadius = Math.max(...table.components.map((component) => {
    const geometry = getComponentGeometry(table, component);
    return Math.hypot(
      Math.abs(geometry.position[0]) + geometry.size[0] / 2,
      Math.abs(geometry.position[2]) + geometry.size[2] / 2,
    );
  }));

  assert.ok(Math.hypot(table.position[0] - chair.position[0], table.position[2] - chair.position[2])
    > chairRadius + tableRadius);
});

test('cage influence increases the local effect of a moved control point', () => {
  const offsets = { [cagePointIndex(1, 1, 1, 2)]: [0.2, 0, 0] as [number, number, number] };
  const vertex: [number, number, number] = [0.5, 0, 0];
  const lowInfluence = deformWorkshopVertex(vertex, offsets, 2, 0.25);
  const highInfluence = deformWorkshopVertex(vertex, offsets, 2, 1.5);

  assert.ok(highInfluence[0] - vertex[0] > lowInfluence[0] - vertex[0]);
  assert.deepEqual(deformWorkshopVertex([-0.5, -0.5, -0.5], offsets, 2, 0.25), [-0.5, -0.5, -0.5]);
});

test('project import validation rejects malformed bounds, parent cycles, and cage keys', () => {
  const valid = createWorkshopScene();
  assert.equal(isWorkshopScene(valid), true);

  const outOfBounds = structuredClone(valid);
  outOfBounds.objects[0].parameters.width = 100;
  assert.equal(isWorkshopScene(outOfBounds), false);

  const cyclic = structuredClone(valid);
  cyclic.objects[0].components[0].parentId = cyclic.objects[0].components[1].id;
  assert.equal(isWorkshopScene(cyclic), false);

  const invalidCage = structuredClone(valid);
  invalidCage.objects[0].cageOffsets[invalidCage.objects[0].components[0].id] = { '9:9:9:2': [1, 0, 0] };
  assert.equal(isWorkshopScene(invalidCage), false);
});

test('an empty scene with cleared selection remains importable', () => {
  const scene = { ...createWorkshopScene(), objects: [], selectedObjectId: '', selectedComponentId: '' };
  assert.equal(isWorkshopScene(scene), true);
});

test('legacy chair projects preserve their edits while adding the sourced base', () => {
  const legacy = JSON.parse(JSON.stringify(createWorkshopScene())) as Record<string, unknown>;
  const objects = legacy.objects as Array<Record<string, unknown>>;
  const object = objects[0];
  const originalId = 'legacy-chair-seat';
  object.components = [{
    id: originalId,
    name: 'Seat',
    semanticType: 'seat',
    parentId: null,
    offset: [0.12, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    visible: true,
    locked: false,
    materialId: 'oak',
    creationPhase: 'draft',
    validationStatus: 'valid',
  }, {
    id: 'legacy-chair-supports',
    name: 'Backrest supports',
    semanticType: 'backrest-supports',
    parentId: originalId,
    offset: [0, 0.08, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    visible: true,
    locked: false,
    materialId: 'oak',
    creationPhase: 'draft',
    validationStatus: 'unvalidated',
  }, {
    id: 'legacy-user-box',
    name: 'Custom box',
    semanticType: 'custom-box',
    parentId: null,
    offset: [0.4, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    visible: true,
    locked: false,
    materialId: 'blue',
    creationPhase: 'draft',
    validationStatus: 'unvalidated',
  }];
  object.cageOffsets = { [originalId]: { '1:1:1:2': [0.1, 0, 0] } };
  legacy.formatRevision = 4;
  delete object.bevel;
  object.parameters = { width: 1.55, depth: 1.28, legHeight: 0.8, backrestHeight: 1.18 };

  const normalized = normalizeWorkshopScene(legacy);
  assert.ok(normalized);
  assert.equal(normalized.formatRevision, 8);
  assert.equal(normalized.objects[0].assemblyLocked, false);
  assert.equal(normalized.objects[0].bevel, 0.035);
  assert.equal(normalized.objects[0].parameters.width, 0.72);
  assert.equal(normalized.objects[0].parameters.depth, 0.72);
  const migrated = normalized.objects[0];
  assert.equal(migrated.components.filter(({ semanticType }) =>
    String(semanticType).startsWith('backrest-support-')).length, 2);
  assert.equal(migrated.components.filter(({ semanticType }) =>
    String(semanticType).startsWith('armrest-support-')).length, 4);
  assert.equal(migrated.components.filter(({ semanticType }) =>
    String(semanticType).startsWith('apron-')).length, 4);
  const oldSeat = migrated.components.find(({ id }) => id === originalId)!;
  assert.equal(oldSeat.visible, false);
  assert.equal(oldSeat.sourceBackup, true);
  assert.deepEqual(oldSeat.offset, [0.12, 0, 0]);
  assert.deepEqual(migrated.cageOffsets[originalId]['1:1:1:2'], [0.1, 0, 0]);
  assert.ok(migrated.components.some(({ semanticType }) => semanticType === 'asset-upholstery'));
  const customBox = migrated.components.find(({ id }) => id === 'legacy-user-box')!;
  assert.equal(customBox.visible, true);
  assert.equal(customBox.sourceBackup, undefined);
  assert.notEqual(normalized.selectedComponentId, originalId);
});

test('legacy scenes with origin-stacked objects are spread apart on load', () => {
  const legacy = createWorkshopScene();
  legacy.formatRevision = 5;
  const table = createWorkshopObject('table', 'Table', 'legacy-table');
  legacy.objects.push(table);
  const normalized = normalizeWorkshopScene(legacy);

  assert.ok(normalized);
  assert.equal(normalized.objects[0].position[0], 0);
  assert.notDeepEqual(normalized.objects[1].position, [0, 0, 0]);
  assert.ok(Math.hypot(
    normalized.objects[1].position[0] - normalized.objects[0].position[0],
    normalized.objects[1].position[2] - normalized.objects[0].position[2],
  ) > 1);
});
