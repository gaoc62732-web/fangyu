import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { clusterScreenMarkers } from '../packages/map-renderer/src/marker-clusters.js';
import { CanvasMapRenderer } from '../packages/map-renderer/src/canvas-renderer.js';
import {
  VISITED_MARKER_PATHS,
  drawVisitedMarker,
} from '../packages/map-renderer/src/visited-marker-icons.js';
import { createMapStyle, VISITED_MARKER_LAYER_IDS } from '../apps/web/src/features/maps/style.js';

const point = (id: string, x: number, y = 0) => ({ id, x, y, value: { id } });
const coincident = [point('airport-record', 0), point('heritage-record', 0)];
assert.deepEqual(
  clusterScreenMarkers(coincident).map((group) => group.members.length),
  [2],
);
assert.deepEqual(
  clusterScreenMarkers([point('a', 39), point('b', 41)]).map((group) => group.members.length),
  [2],
  'Cluster across cell edges',
);
assert.deepEqual(
  clusterScreenMarkers([point('a', -1), point('b', 1)]).map((group) => group.members.length),
  [2],
  'Cluster across negative screen coordinates',
);
assert.equal(clusterScreenMarkers([point('a', 0), point('b', 41)]).length, 2);
assert.equal(
  clusterScreenMarkers([point('a', 0), point('b', 20)]).length,
  1,
  'Low zoom clusters nearby records',
);
assert.equal(
  clusterScreenMarkers([point('a', 0), point('b', 80)]).length,
  2,
  'Zoom separates distinct positions',
);
const mixed = [point('c', 52), point('a', 0), point('b', 20), point('d', 120)];
assert.deepEqual(
  clusterScreenMarkers(mixed),
  clusterScreenMarkers([...mixed].reverse()),
  'Stable record ordering',
);
assert.equal(
  clusterScreenMarkers([point('a', 0), point('a', 0)])[0]!.members.length,
  1,
  'Defensive ID deduplication',
);
assert.equal(clusterScreenMarkers([point('a', Number.NaN)]).length, 0);
assert.throws(() => clusterScreenMarkers([], 0));
const many = Array.from({ length: 2000 }, (_, i) => point(String(i), i % 100, Math.floor(i / 100)));
assert.equal(
  clusterScreenMarkers(many).flatMap((group) => group.members).length,
  2000,
  'No members lost in dense clusters',
);

// Drive the real Canvas drawing/hit/focus methods with a minimal drawing context.
// This verifies path identity and selection semantics, not raster appearance.
const strokes: string[] = [];
const textCalls: { text: string; x: number; y: number }[] = [];
const imageCalls: unknown[][] = [];
const originalPath = globalThis.Path2D;
const originalRatio = globalThis.devicePixelRatio;
const originalDocument = globalThis.document;
const originalResizeObserver = globalThis.ResizeObserver;
(globalThis as any).Path2D = class {
  constructor(public d: string) {}
};
(globalThis as any).devicePixelRatio = 1;
const context: any = {
  save() {},
  restore() {},
  translate() {},
  scale() {},
  setTransform() {},
  setLineDash() {},
  beginPath() {},
  arc() {},
  fill() {},
  fillRect() {},
  fillText(text: string, x: number, y: number) {
    textCalls.push({ text, x, y });
  },
  drawImage(...args: unknown[]) {
    imageCalls.push(args);
  },
  isPointInPath: () => true,
  stroke(path?: { d?: string }) {
    if (path?.d) strokes.push(path.d);
  },
};
try {
  drawVisitedMarker(context, 'airport', 0, 0);
  drawVisitedMarker(context, 'world-heritage', 0, 0);
  drawVisitedMarker(context, 'project-reference', 0, 0);
  assert.deepEqual(
    strokes,
    [
      VISITED_MARKER_PATHS.airport,
      VISITED_MARKER_PATHS['world-heritage'],
      VISITED_MARKER_PATHS['world-heritage'],
    ],
    'SVG legend and Canvas/MapLibre image paths share exact original artwork',
  );
  assert.notEqual(VISITED_MARKER_PATHS.airport, VISITED_MARKER_PATHS['world-heritage']);
  const canvas = Object.create(CanvasMapRenderer.prototype) as any;
  canvas.context = context;
  canvas.shapes = [];
  canvas.scale = 1;
  canvas.fullScale = 1;
  canvas.x = 0;
  canvas.y = 0;
  canvas.width = 400;
  canvas.height = 300;
  canvas.project = (p: [number, number]) => p;
  canvas.unproject = (p: [number, number]) => p;
  canvas.scene = {
    features: [],
    allowsRegionHit: () => false,
    points: [
      {
        id: 'airport-record',
        name: 'Airport',
        coords: [100, 100],
        marked: true,
        markerKind: 'airport',
      },
      {
        id: 'heritage-record',
        name: 'Heritage',
        coords: [100, 100],
        marked: true,
        markerKind: 'world-heritage',
      },
      { id: 'ordinary-point', name: 'Ordinary', coords: [300, 200], marked: false },
    ],
  };
  canvas.draw();
  assert.deepEqual(
    canvas.hit(100, 100).markerIds,
    ['airport-record', 'heritage-record'],
    'A coincident cluster exposes both real record IDs',
  );
  assert.equal(canvas.hit(100, 100).markerCount, 2);
  const listeners = new Map<string, (event: any) => void>();
  const pointerSelections: unknown[] = [];
  (globalThis as any).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  (globalThis as any).document = {
    createElement: () => ({
      style: {},
      setAttribute() {},
      setPointerCapture() {},
      getContext: () => context,
      addEventListener: (name: string, handler: (event: any) => void) =>
        listeners.set(name, handler),
    }),
  };
  const pointerCanvas = new CanvasMapRenderer(
    { append() {}, clientWidth: 0, clientHeight: 0 } as any,
    (...args) => pointerSelections.push(args),
  ) as any;
  for (const key of [
    'context',
    'shapes',
    'scale',
    'fullScale',
    'x',
    'y',
    'width',
    'height',
    'project',
    'unproject',
    'scene',
  ])
    pointerCanvas[key] = canvas[key];
  pointerCanvas.draw();
  const send = (name: string, x = 100, y = 100, pointerType = 'touch') =>
    listeners.get(name)!({ offsetX: x, offsetY: y, pointerId: 1, pointerType });
  for (const pointerType of ['touch', 'mouse']) {
    const previous = pointerSelections.length;
    send('pointerdown', 100, 100, pointerType);
    send('pointerup', 100, 100, pointerType);
    assert.equal(
      pointerSelections.length,
      previous,
      'No detail DOM mutation before native click target is fixed',
    );
    // The selected records are the release-time hit, even if a draw occurs before click.
    pointerCanvas.markerGroups = [];
    send('click', 100, 100, pointerType);
    assert.deepEqual(pointerSelections.at(-1), [
      'airport-record',
      true,
      ['airport-record', 'heritage-record'],
    ]);
    send('click', 100, 100, pointerType);
    assert.equal(pointerSelections.length, previous + 1, 'A pointer sequence selects exactly once');
    pointerCanvas.draw();
  }
  const selectionsBeforeCancel = pointerSelections.length;
  send('pointerdown');
  send('pointerup');
  send('pointercancel');
  send('click');
  assert.equal(
    pointerSelections.length,
    selectionsBeforeCancel,
    'Cancellation clears pending selection',
  );
  send('pointerdown');
  send('pointerup');
  send('pointerdown', 200, 200);
  send('click');
  assert.equal(
    pointerSelections.length,
    selectionsBeforeCancel,
    'New pointer sequence cannot reuse an earlier hit',
  );
  send('pointerdown');
  send('pointermove', 120, 100);
  send('pointerup', 120, 100);
  send('click', 120, 100);
  assert.equal(
    pointerSelections.length,
    selectionsBeforeCancel,
    'Dragging does not activate points',
  );
  send('pointercancel');

  pointerCanvas.x = pointerCanvas.y = 0;
  pointerCanvas.draw();
  send('pointerdown', 300, 200);
  send('pointerup', 300, 200);
  send('click', 300, 200);
  assert.deepEqual(
    pointerSelections.at(-1),
    ['ordinary-point', true, undefined],
    'Ordinary point selection uses the complete click sequence',
  );
  pointerCanvas.scene = { features: [], points: [], allowsRegionHit: () => false };
  pointerCanvas.shapes = [{ id: 'region', name: 'Region', bounds: [0, 0, 400, 300], path: {} }];
  pointerCanvas.markerGroups = [];
  const beforeBlocked = pointerSelections.length;
  send('pointerdown');
  send('pointerup');
  send('click');
  assert.equal(
    pointerSelections.length,
    beforeBlocked,
    'Blocked administrative hit does not become a click selection',
  );
  pointerCanvas.scene.allowsRegionHit = undefined;
  send('pointerdown');
  send('pointerup');
  send('click');
  assert.deepEqual(
    pointerSelections.at(-1),
    ['region', false, undefined],
    'Allowed administrative selection uses the complete click sequence',
  );
  assert.equal(canvas.hit(300, 200).id, 'ordinary-point', 'Ordinary point hit is preserved');
  canvas.focusPoints(['airport-record', 'heritage-record']);
  const camera = [canvas.scale, canvas.x, canvas.y];
  canvas.focusPoints(['airport-record', 'heritage-record']);
  assert.deepEqual(
    [canvas.scale, canvas.x, canvas.y],
    camera,
    'Repeated same-position cluster clicks cannot zoom indefinitely',
  );
  assert.equal(canvas.hit(200, 150).markerCount, 2);
  canvas.focusPoints(['heritage-record'], 2);
  assert(canvas.scale <= canvas.fullScale * 2, 'Project reference focus stays broad');
  canvas.scene.points = [
    {
      id: 'heritage-record',
      name: 'Heritage',
      coords: [100, 100],
      marked: true,
      markerKind: 'world-heritage',
    },
  ];
  canvas.draw();
  assert.equal(
    canvas.markerGroups[0].members.length,
    1,
    'Removing one record immediately dissolves the cluster',
  );
  let exported: any;
  (globalThis as any).document = {
    createElement(tag: string) {
      assert.equal(tag, 'canvas');
      exported = {
        width: 0,
        height: 0,
        getContext: () => context,
        toBlob(callback: (blob: Blob) => void) {
          callback(new Blob(['synthetic-canvas-output']));
        },
      };
      return exported;
    },
  };
  canvas.canvas = { width: 640, height: 480 };
  canvas.scene.points = [
    { id: 'ordinary', name: 'Ordinary visited point', coords: [0, 0], marked: true },
  ];
  canvas.markerGroups = [];
  textCalls.length = imageCalls.length = strokes.length = 0;
  await canvas.png('Map', [{ label: '到达', color: '#123456' }]);
  assert.equal(exported.width, 720);
  assert.equal(exported.height, 640, 'No overlay preserves the original 160px PNG allowance');
  assert.deepEqual(
    imageCalls,
    [[canvas.canvas, 40, 90]],
    'PNG map pixels retain their original position',
  );
  assert(textCalls.some((call) => call.text === '到达' && call.y === 596));
  assert.equal(textCalls.at(-1)!.y, 628, 'No-overlay footer position is unchanged');
  assert.equal(strokes.length, 0, 'No unsolicited icon legend without overlay markers');

  canvas.scene.points = [
    { id: 'airport', name: 'Airport', coords: [100, 100], marked: true, markerKind: 'airport' },
    {
      id: 'heritage',
      name: 'Heritage',
      coords: [100, 100],
      marked: true,
      markerKind: 'world-heritage',
    },
    {
      id: 'reference',
      name: 'Project',
      coords: [300, 200],
      marked: true,
      markerKind: 'project-reference',
    },
  ];
  canvas.draw();
  textCalls.length = imageCalls.length = strokes.length = 0;
  await canvas.png('Map', [{ label: '到达', color: '#123456' }]);
  assert.equal(
    exported.height,
    768,
    'Three kinds and one cluster explanation receive four extra rows',
  );
  assert.deepEqual(
    imageCalls,
    [[canvas.canvas, 40, 90]],
    'Overlay legends do not move the map canvas',
  );
  assert.deepEqual(
    strokes,
    [
      VISITED_MARKER_PATHS.airport,
      VISITED_MARKER_PATHS['world-heritage'],
      VISITED_MARKER_PATHS['world-heritage'],
    ],
    'PNG legend uses the same original icon paths',
  );
  assert(textCalls.some((call) => call.text === '已到访机场'));
  assert(
    textCalls.some(
      (call) => call.text.includes('世遗组成地点') && call.text.includes('不表示整个项目完成'),
    ),
  );
  assert(
    textCalls.some(
      (call) => call.text.includes('项目代表位置') && call.text.includes('不表示全部组成地点到访'),
    ),
  );
  assert(
    textCalls.some(
      (call) => call.text.includes('聚合数字') && call.text.includes('不代表项目完成数'),
    ),
  );

  canvas.scene.points = [canvas.scene.points[0]];
  canvas.draw();
  textCalls.length = 0;
  await canvas.png('Map');
  assert.equal(exported.height, 678, 'Only actual marker kinds produce legend rows');
  assert(!textCalls.some((call) => /世遗组成地点|项目代表位置|聚合数字/.test(call.text)));
} finally {
  (globalThis as any).Path2D = originalPath;
  (globalThis as any).devicePixelRatio = originalRatio;
  (globalThis as any).document = originalDocument;
  (globalThis as any).ResizeObserver = originalResizeObserver;
}

const style = createMapStyle(
  { scopes: { china: { layers: [] } } } as any,
  'china',
  'county',
  null,
  '/',
  'https://example.invalid/',
);
const source = style.sources['visited-markers'] as any;
assert.equal(source.cluster, true);
assert.equal(source.clusterMaxZoom, 15, 'Native clusters remain available at the map max zoom');
assert.equal(source.maxzoom, 16);
assert.equal(
  style.glyphs,
  undefined,
  'Cluster labels use local raster artwork without font-server requests',
);
assert(style.sources.points, 'Ordinary points source preserved');
for (const id of VISITED_MARKER_LAYER_IDS) assert(style.layers.some((layer) => layer.id === id));
const result = {
  status: 'pass',
  checks: [
    'cell-edge clusters',
    'zoom separation',
    'same-coordinate member access',
    'stable IDs',
    '2000-member preservation',
    'original shared icon paths',
    'real Canvas draw/hit/focus methods',
    'ordinary points preserved',
    'Canvas selection waits for native click target; touch/mouse/drag/cancel sequence checks',
    'finite repeated focus',
    'broad project-reference focus',
    'native maxzoom clustering',
    'no remote glyph dependency',
    'PNG no-overlay height and 90px map offset preserved',
    'PNG dynamic same-source marker legend and project-reference caveat',
    'PNG cluster count meaning',
  ],
  browserChecksRemaining: [
    'MapLibre cluster leaves and click events',
    'Canvas pointer events',
    'actual icon appearance',
    'PNG image pixels',
    'checkbox preferences and record persistence',
  ],
};
mkdirSync('data/generated/visited-marker-renderer', { recursive: true });
writeFileSync(
  'data/generated/visited-marker-renderer/pure-results.json',
  JSON.stringify(result, null, 2) + '\n',
);
console.log(
  'PASS visited marker clustering, record identities, original shared icon paths, Canvas selection/focus, and native cluster style configuration.',
);
