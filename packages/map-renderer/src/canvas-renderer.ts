import { geoNaturalEarth1, geoPath } from 'd3-geo';
import type { MapScene, RenderFeature, RenderPoint } from './types.js';
import { projectionGeometry } from './projection-geometry.js';
import { clusterScreenMarkers, type ScreenMarkerCluster } from './marker-clusters.js';
import { drawVisitedCluster, drawVisitedMarker } from './visited-marker-icons.js';
import { POINT_MAP_APPEARANCE } from './point-map-appearance.js';

type Bounds = [number, number, number, number];
type Shape = RenderFeature & { path?: Path2D; bounds: Bounds };
type ProjectedPoint = { point: RenderPoint; x: number; y: number };
export type MapHover = {
  id: string;
  name: string;
  point: boolean;
  x: number;
  y: number;
  markerIds?: string[];
  markerCount?: number;
};
const mercator = ([x, y]: number[]): [number, number] => [
  x!,
  (-Math.log(Math.tan(Math.PI / 4 + (Math.max(-80, Math.min(80, y!)) * Math.PI) / 360)) * 180) /
    Math.PI,
];

/** Owns drawing, projection, pointer hit testing and viewport; contains no record rules. */
export class CanvasMapRenderer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private observer: ResizeObserver;
  private scene: MapScene = { features: [], points: [] };
  private shapes: Shape[] = [];
  private visibleShapes: Shape[] = [];
  private projectedPoints: ProjectedPoint[] = [];
  private markerGroups: ScreenMarkerCluster<RenderPoint>[] = [];
  private pathCache = new WeakMap<
    GeoJSON.Geometry,
    { world: boolean; path: Path2D; bounds: Bounds }
  >();
  private project = mercator;
  private unproject: (point: [number, number]) => [number, number] | null = ([x, y]) => [
    x,
    ((2 * Math.atan(Math.exp((-y * Math.PI) / 180)) - Math.PI / 2) * 180) / Math.PI,
  ];
  private width = 1;
  private height = 1;
  private scale = 1;
  private fullScale = 1;
  private x = 0;
  private y = 0;
  private drag: { x: number; y: number; startX: number; startY: number } | undefined;
  private pendingClick: { id: string; point: boolean; markerIds?: string[] } | undefined;
  private animationFrame: number | undefined;
  private drawFrame: number | undefined;
  private hoverFrame: number | undefined;
  private pendingHover: { x: number; y: number } | undefined;
  private abort = new AbortController();

  constructor(
    host: HTMLElement,
    private select: (id: string, point: boolean, markerIds?: string[]) => void,
    private hover: (item: MapHover | undefined) => void = () => {},
    private viewChanged: () => void = () => {},
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-label', '可拖动和缩放的旅行地图；也可通过旁边的列表选择地点');
    this.canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none';
    host.append(this.canvas);
    const context = this.canvas.getContext('2d');
    if (!context) throw Error('当前浏览器不支持 Canvas');
    this.context = context;
    const options = { signal: this.abort.signal };
    this.canvas.addEventListener(
      'pointerdown',
      (event) => {
        this.stop();
        this.pendingClick = undefined;
        this.drag = {
          x: event.offsetX,
          y: event.offsetY,
          startX: event.offsetX,
          startY: event.offsetY,
        };
        this.canvas.setPointerCapture(event.pointerId);
      },
      options,
    );
    this.canvas.addEventListener(
      'pointermove',
      (event) => {
        if (this.drag) {
          this.hover(undefined);
          this.x += event.offsetX - this.drag.x;
          this.y += event.offsetY - this.drag.y;
          this.drag.x = event.offsetX;
          this.drag.y = event.offsetY;
          this.scheduleDraw();
        } else {
          this.pendingHover = { x: event.offsetX, y: event.offsetY };
          if (this.hoverFrame === undefined)
            this.hoverFrame = requestAnimationFrame(() => {
              this.hoverFrame = undefined;
              const point = this.pendingHover;
              this.pendingHover = undefined;
              if (!point) return;
              const hit = this.hit(point.x, point.y);
              this.hover(hit ? { ...hit, x: point.x, y: point.y } : undefined);
            });
        }
      },
      options,
    );
    this.canvas.addEventListener(
      'pointerup',
      (event) => {
        if (
          this.drag &&
          Math.hypot(event.offsetX - this.drag.startX, event.offsetY - this.drag.startY) < 5
        ) {
          this.pendingClick = this.hit(event.offsetX, event.offsetY);
        }
        this.drag = undefined;
      },
      options,
    );
    // Wait for native click to fix its target before selection inserts details.
    // Selecting on touch pointerup can retarget the following compatibility
    // click to a newly inserted detail button and replace the cluster selection.
    this.canvas.addEventListener(
      'click',
      () => {
        const hit = this.pendingClick;
        this.pendingClick = undefined;
        if (hit) this.select(hit.id, hit.point, hit.markerIds);
      },
      options,
    );
    this.canvas.addEventListener(
      'pointercancel',
      () => {
        this.pendingClick = undefined;
        this.drag = undefined;
        this.hover(undefined);
      },
      options,
    );
    this.canvas.addEventListener(
      'pointerleave',
      () => {
        this.pendingHover = undefined;
        if (this.hoverFrame !== undefined) cancelAnimationFrame(this.hoverFrame);
        this.hoverFrame = undefined;
        this.hover(undefined);
      },
      options,
    );
    this.canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const delta = Math.max(-120, Math.min(120, event.deltaY));
        this.zoom(Math.exp(-delta * 0.0009), event.offsetX, event.offsetY);
      },
      { ...options, passive: false },
    );
    const resize = () => {
      if (!host.clientWidth || !host.clientHeight) return;
      const first = this.width === 1,
        oldWidth = this.width,
        oldHeight = this.height;
      this.width = host.clientWidth;
      this.height = host.clientHeight;
      const ratio = devicePixelRatio || 1;
      this.canvas.width = Math.round(this.width * ratio);
      this.canvas.height = Math.round(this.height * ratio);
      if (first) this.fit();
      else {
        this.x += (this.width - oldWidth) / 2;
        this.y += (this.height - oldHeight) / 2;
        this.draw();
      }
    };
    this.observer = new ResizeObserver(resize);
    this.observer.observe(host);
    // Export renderers may be used before the first ResizeObserver delivery.
    resize();
  }

  setScene(scene: MapScene, reset = false) {
    const previous = this.scene;
    this.scene = scene;
    const projection = geoNaturalEarth1()
      .scale(180 / Math.PI)
      .translate([0, 0]);
    this.project = scene.world
      ? (point) => projection(point as [number, number]) || [0, 0]
      : mercator;
    this.unproject = scene.world
      ? (point) => projection.invert?.(point) || null
      : ([x, y]) => [
          x,
          ((2 * Math.atan(Math.exp((-y * Math.PI) / 180)) - Math.PI / 2) * 180) / Math.PI,
        ];
    const path = geoPath(projection);
    this.shapes = scene.features.map((feature) => {
      const cached = this.pathCache.get(feature.geometry);
      if (cached && cached.world === Boolean(scene.world)) {
        return { ...feature, path: cached.path, bounds: cached.bounds };
      }
      if (feature.bounds && !scene.world) {
        const [, south, , north] = feature.bounds;
        const bounds: Bounds = [
          feature.bounds[0],
          mercator([feature.bounds[0], north])[1],
          feature.bounds[2],
          mercator([feature.bounds[2], south])[1],
        ];
        return { ...feature, bounds };
      }
      const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
      let shape: Path2D;
      if (scene.world) {
        const f = {
          type: 'Feature' as const,
          geometry: projectionGeometry(feature.geometry),
          properties: {},
        };
        shape = new Path2D(path(f) || '');
        const b = path.bounds(f);
        bounds.splice(0, 4, b[0][0], b[0][1], b[1][0], b[1][1]);
      } else {
        shape = new Path2D();
        const { type } = feature.geometry;
        const geometry = feature.geometry;
        const rings =
          geometry.type === 'MultiPolygon'
            ? geometry.coordinates.flat()
            : geometry.type === 'Polygon' || geometry.type === 'MultiLineString'
              ? geometry.coordinates
              : geometry.type === 'LineString'
                ? [geometry.coordinates]
                : [];
        for (const ring of rings) {
          ring.forEach((point: number[], i: number) => {
            const [x, y] = mercator(point);
            bounds[0] = Math.min(bounds[0], x);
            bounds[1] = Math.min(bounds[1], y);
            bounds[2] = Math.max(bounds[2], x);
            bounds[3] = Math.max(bounds[3], y);
            if (i) shape.lineTo(x, y);
            else shape.moveTo(x, y);
          });
          if (type.includes('Polygon')) shape.closePath();
        }
      }
      this.pathCache.set(feature.geometry, { world: Boolean(scene.world), path: shape, bounds });
      return { ...feature, path: shape, bounds };
    });
    this.projectedPoints = scene.points.map((point) => {
      const [x, y] = this.project(point.coords);
      return { point, x, y };
    });
    if (reset || !previous.features.length) this.fit();
    else this.draw();
  }
  private scheduleDraw() {
    if (this.drawFrame !== undefined) return;
    this.drawFrame = requestAnimationFrame(() => {
      this.drawFrame = undefined;
      this.draw();
    });
  }
  private pathFor(shape: Shape): Path2D {
    if (shape.path) return shape.path;
    const world = Boolean(this.scene.world);
    const cached = this.pathCache.get(shape.geometry);
    if (cached && cached.world === world) {
      shape.path = cached.path;
      return cached.path;
    }
    let path: Path2D;
    if (world) {
      const projection = geoNaturalEarth1()
        .scale(180 / Math.PI)
        .translate([0, 0]);
      const generator = geoPath(projection);
      const feature = {
        type: 'Feature' as const,
        geometry: projectionGeometry(shape.geometry),
        properties: {},
      };
      path = new Path2D(generator(feature) || '');
      const bounds = generator.bounds(feature);
      shape.bounds = [bounds[0][0], bounds[0][1], bounds[1][0], bounds[1][1]];
    } else {
      path = new Path2D();
      const type = shape.geometry.type;
      const geometry = shape.geometry;
      const rings =
        geometry.type === 'MultiPolygon'
          ? geometry.coordinates.flat()
          : geometry.type === 'Polygon' || geometry.type === 'MultiLineString'
            ? geometry.coordinates
            : geometry.type === 'LineString'
              ? [geometry.coordinates]
              : [];
      for (const ring of rings) {
        ring.forEach((point: number[], index: number) => {
          const [x, y] = mercator(point);
          if (index) path.lineTo(x, y);
          else path.moveTo(x, y);
        });
        if (type.includes('Polygon')) path.closePath();
      }
    }
    shape.path = path;
    this.pathCache.set(shape.geometry, { world, path, bounds: shape.bounds });
    return path;
  }
  fit(ids?: string[], selectionScale = 1, duration = 0) {
    const selected = ids?.length ? this.shapes.filter((f) => ids.includes(f.id)) : this.shapes;
    if (!selected.length) return;
    const b = selected.reduce<Bounds>(
      (a, f) => [
        Math.min(a[0], f.bounds[0]),
        Math.min(a[1], f.bounds[1]),
        Math.max(a[2], f.bounds[2]),
        Math.max(a[3], f.bounds[3]),
      ],
      [Infinity, Infinity, -Infinity, -Infinity],
    );
    if (!Number.isFinite(b[0])) return;
    const targetScale = Math.min(
      Math.max(1, (this.canvas.clientWidth || this.width) - 36) / (b[2] - b[0] || 1),
      Math.max(1, (this.canvas.clientHeight || this.height) - 36) / (b[3] - b[1] || 1),
    );
    if (!ids?.length) this.fullScale = targetScale;
    const scale =
      Math.min(targetScale, this.fullScale * (this.scene.world ? 20 : 36)) * selectionScale;
    const center = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
    this.stop();
    if (duration <= 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.scale = scale;
      this.x = this.width / 2 - center[0]! * scale;
      this.y = this.height / 2 - center[1]! * scale;
      this.draw();
      return;
    }
    const startScale = this.scale;
    const startCenter = [
      (this.width / 2 - this.x) / startScale,
      (this.height / 2 - this.y) / startScale,
    ];
    const startedAt = performance.now();
    const frame = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - startedAt) / duration));
      const eased = progress * progress * (3 - 2 * progress);
      this.scale = startScale * Math.pow(scale / startScale, eased);
      this.x =
        this.width / 2 - (startCenter[0]! + (center[0]! - startCenter[0]!) * eased) * this.scale;
      this.y =
        this.height / 2 - (startCenter[1]! + (center[1]! - startCenter[1]!) * eased) * this.scale;
      this.draw();
      this.animationFrame = progress < 1 ? requestAnimationFrame(frame) : undefined;
    };
    this.animationFrame = requestAnimationFrame(frame);
  }
  stop() {
    if (this.animationFrame !== undefined) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = undefined;
  }
  zoom(factor: number, x = this.width / 2, y = this.height / 2) {
    this.stop();
    const next = Math.max(
      this.scene.pointExploration ? 512 / 360 : this.fullScale * 0.75,
      Math.min(
        this.scene.pointExploration
          ? (512 * Math.pow(2, 15)) / 360
          : this.fullScale * (this.scene.world ? 20 : 36),
        this.scale * factor,
      ),
    );
    const scaleRatio = next / this.scale;
    this.x = x - (x - this.x) * scaleRatio;
    this.y = y - (y - this.y) * scaleRatio;
    this.scale = next;
    this.scheduleDraw();
  }
  projectPoint(coordinates: [number, number]): [number, number] {
    const [x, y] = this.project(coordinates);
    return [x * this.scale + this.x, y * this.scale + this.y];
  }
  camera() {
    const center = this.unproject([
      (this.width / 2 - this.x) / this.scale,
      (this.height / 2 - this.y) / this.scale,
    ]);
    return center ? { center, zoom: Math.log2((this.scale * 360) / 512) } : undefined;
  }
  setCamera(camera: { center: [number, number]; zoom: number }) {
    this.stop();
    this.scale = (512 * Math.pow(2, camera.zoom)) / 360;
    const [x, y] = this.project(camera.center);
    this.x = this.width / 2 - x * this.scale;
    this.y = this.height / 2 - y * this.scale;
    this.draw();
  }
  focusPoints(ids: readonly string[], maxRelativeZoom = 24) {
    this.stop();
    const wanted = new Set(ids);
    const points = this.scene.points.filter((point) => point.markerKind && wanted.has(point.id));
    if (!points.length) return;
    const bounds = points.reduce<Bounds>(
      (b, point) => {
        const [x, y] = this.project(point.coords);
        return [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
      },
      [Infinity, Infinity, -Infinity, -Infinity],
    );
    const maxScale = this.fullScale * Math.min(maxRelativeZoom, this.scene.world ? 20 : 36);
    this.scale = Math.min(
      maxScale,
      Math.max(1, this.width - 80) / (bounds[2] - bounds[0] || 1e-6),
      Math.max(1, this.height - 80) / (bounds[3] - bounds[1] || 1e-6),
    );
    this.x = this.width / 2 - ((bounds[0] + bounds[2]) / 2) * this.scale;
    this.y = this.height / 2 - ((bounds[1] + bounds[3]) / 2) * this.scale;
    this.draw();
  }
  private hit(x: number, y: number) {
    for (let index = this.markerGroups.length - 1; index >= 0; index--) {
      const group = this.markerGroups[index]!;
      if (Math.hypot(group.x - x, group.y - y) <= (group.members.length > 1 ? 19 : 16)) {
        return {
          id: group.members[0]!.id,
          name:
            group.members.length > 1
              ? `${group.members.length} 个已到访地点`
              : group.members[0]!.name,
          point: true,
          markerIds: group.members.map((point) => point.id),
          markerCount: group.members.length,
        };
      }
    }
    for (let index = this.projectedPoints.length - 1; index >= 0; index--) {
      const { point, x: px, y: py } = this.projectedPoints[index]!;
      if (
        !point.markerKind &&
        Math.hypot(px * this.scale + this.x - x, py * this.scale + this.y - y) < 7
      )
        return { id: point.id, name: point.name, point: true };
    }
    if (this.scene.pointExploration) return;
    const px = (x - this.x) / this.scale;
    const py = (y - this.y) / this.scale;
    const coordinates = this.scene.allowsRegionHit ? this.unproject([px, py]) : null;
    if (this.scene.allowsRegionHit) {
      if (!coordinates || !this.scene.allowsRegionHit(coordinates)) return;
    }
    const ctx = this.context;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    let found: Shape | undefined;
    for (let index = this.shapes.length - 1; index >= 0; index--) {
      const shape = this.shapes[index]!;
      if (
        shape.interactive !== false &&
        px >= shape.bounds[0] &&
        px <= shape.bounds[2] &&
        py >= shape.bounds[1] &&
        py <= shape.bounds[3] &&
        ctx.isPointInPath(this.pathFor(shape), px, py, 'evenodd') &&
        (!this.scene.allowsRegionHit ||
          (coordinates && this.scene.allowsRegionHit(coordinates, shape.geometry)))
      ) {
        found = shape;
        break;
      }
    }
    ctx.restore();
    return found ? { id: found.id, name: found.name, point: false } : undefined;
  }
  draw() {
    const ctx = this.context;
    const ratio = devicePixelRatio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = this.scene.dark ? '#17272e' : '#eef4f3';
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.translate(this.x, this.y);
    ctx.scale(this.scale, this.scale);
    const viewport: Bounds = [
      -this.x / this.scale,
      -this.y / this.scale,
      (this.width - this.x) / this.scale,
      (this.height - this.y) / this.scale,
    ];
    this.visibleShapes.length = 0;
    for (const shape of this.shapes) {
      if (
        shape.bounds[0] <= viewport[2] &&
        shape.bounds[2] >= viewport[0] &&
        shape.bounds[1] <= viewport[3] &&
        shape.bounds[3] >= viewport[1]
      )
        this.visibleShapes.push(shape);
    }
    const boundaryWidth =
      this.scene.detailLevel === 'province' ? 1.4 : this.scene.detailLevel === 'city' ? 0.9 : 0.5;
    const boundaryColor = this.scene.dark
      ? '#91b0bb'
      : this.scene.detailLevel === 'county'
        ? '#8ca49d'
        : '#57726b';
    if (this.scene.pointExploration) {
      // Mute only the background; highlights and points are painted afterwards.
      ctx.save();
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.fillStyle = POINT_MAP_APPEARANCE.maskColor;
      ctx.globalAlpha = POINT_MAP_APPEARANCE.maskOpacity;
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.restore();
      ctx.save();
      ctx.fillStyle = POINT_MAP_APPEARANCE.highlightColor;
      ctx.globalAlpha = POINT_MAP_APPEARANCE.highlightOpacity;
      for (const f of this.visibleShapes)
        if (f.selected && f.geometry.type.includes('Polygon')) ctx.fill(this.pathFor(f), 'evenodd');
      ctx.restore();
    }
    for (const f of this.visibleShapes) {
      if (f.boundary === false) continue;
      if (!this.scene.pointExploration && f.geometry.type.includes('Polygon')) {
        ctx.fillStyle = f.fill;
        ctx.fill(this.pathFor(f), 'evenodd');
      }
      const countryOutline = ['LineString', 'MultiLineString'].includes(f.geometry.type);
      ctx.setLineDash(f.dashed ? [10 / this.scale, 6 / this.scale] : []);
      if (this.scene.pointExploration) {
        ctx.strokeStyle = countryOutline
          ? POINT_MAP_APPEARANCE.borderColor
          : POINT_MAP_APPEARANCE.boundaryColor;
        ctx.globalAlpha = POINT_MAP_APPEARANCE.boundaryOpacity;
        ctx.lineWidth = (countryOutline ? 1.4 : boundaryWidth) / this.scale;
        ctx.stroke(this.pathFor(f));
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.strokeStyle = countryOutline
        ? this.scene.dark
          ? '#e2d7ad'
          : '#263f45'
        : f.selected
          ? '#cf762b'
          : boundaryColor;
      ctx.lineWidth = (countryOutline ? 2.6 : f.selected ? 2 : boundaryWidth) / this.scale;
      ctx.stroke(this.pathFor(f));
    }
    ctx.setLineDash([]);
    for (const { point, x, y } of this.projectedPoints) {
      const screenX = x * this.scale + this.x;
      const screenY = y * this.scale + this.y;
      if (
        !point.markerKind &&
        screenX >= -4 &&
        screenY >= -4 &&
        screenX <= this.width + 4 &&
        screenY <= this.height + 4
      ) {
        ctx.beginPath();
        ctx.arc(x, y, 3.5 / this.scale, 0, Math.PI * 2);
        ctx.fillStyle = point.marked ? '#d16932' : '#427a9d';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 0.7 / this.scale;
        ctx.stroke();
      }
    }
    const screenMarkers = [];
    for (const { point, x, y } of this.projectedPoints) {
      if (!point.markerKind) continue;
      const screenX = x * this.scale + this.x;
      const screenY = y * this.scale + this.y;
      if (screenX < -24 || screenY < -24 || screenX > this.width + 24 || screenY > this.height + 24)
        continue;
      screenMarkers.push({ id: point.id, value: point, x: screenX, y: screenY });
    }
    this.markerGroups = clusterScreenMarkers(screenMarkers);
    // Marker sizes are screen pixels, independent of map projection and zoom.
    // PNG export uses this same path, including the original SVG-derived symbols.
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    for (const group of this.markerGroups) {
      if (group.members.length > 1) drawVisitedCluster(ctx, group.members.length, group.x, group.y);
      else drawVisitedMarker(ctx, group.members[0]!.markerKind!, group.x, group.y);
    }
    this.viewChanged();
  }
  async png(
    title: string,
    legend: { label: string; color: string }[] = [],
    credits: string[] = [],
  ): Promise<Blob> {
    const markerKinds = (['airport', 'world-heritage', 'project-reference'] as const).filter(
      (kind) => this.scene.points.some((point) => point.markerKind === kind),
    );
    const hasClusters =
      markerKinds.length > 0 && this.markerGroups.some((group) => group.members.length > 1);
    const markerLegendRows = markerKinds.length + (hasClusters ? 1 : 0);
    const image = document.createElement('canvas');
    image.width = Math.max(this.canvas.width, 720);
    image.height =
      this.canvas.height +
      160 +
      (markerLegendRows ? 8 + markerLegendRows * 30 : 0) +
      credits.length * 18;
    const ctx = image.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, image.width, image.height);
    ctx.fillStyle = '#234339';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText(title, 24, 36);
    ctx.font = '14px sans-serif';
    ctx.fillText('方舆旅游手册 · ' + new Date().toLocaleDateString(), 24, 66);
    ctx.drawImage(this.canvas, (image.width - this.canvas.width) / 2, 90);
    legend.forEach((item, index) => {
      const x = 24 + index * 110;
      const y = this.canvas.height + 116;
      ctx.fillStyle = item.color;
      ctx.fillRect(x, y - 12, 14, 14);
      ctx.fillStyle = '#234339';
      ctx.fillText(item.label, x + 20, y);
    });
    const markerLabels = {
      airport: '已到访机场',
      'world-heritage': '世遗组成地点到访记录（不表示整个项目完成）',
      'project-reference': '项目代表位置：仅反映项目记录，不表示全部组成地点到访',
    };
    markerKinds.forEach((kind, index) => {
      const y = this.canvas.height + 150 + index * 30;
      drawVisitedMarker(ctx, kind, 35, y - 5, 24);
      ctx.fillStyle = '#234339';
      ctx.fillText(markerLabels[kind], 58, y);
    });
    if (hasClusters) {
      const y = this.canvas.height + 150 + markerKinds.length * 30;
      drawVisitedCluster(ctx, 2, 35, y - 5, 24);
      ctx.fillStyle = '#234339';
      ctx.fillText('聚合数字表示合并展示的到访记录数，不代表项目完成数。', 58, y);
    }
    ctx.fillText(
      '边界与点位仅供旅行记录参考，不作为权威区划依据。',
      24,
      image.height - 12 - credits.length * 18,
    );
    ctx.font = '11px sans-serif';
    credits.forEach((credit, index) =>
      ctx.fillText(
        credit,
        24,
        image.height - 12 - (credits.length - index - 1) * 18,
        image.width - 48,
      ),
    );
    return new Promise((resolve, reject) =>
      image.toBlob((blob) => (blob ? resolve(blob) : reject(Error('PNG 导出失败'))), 'image/png'),
    );
  }
  destroy() {
    this.stop();
    if (this.drawFrame !== undefined) cancelAnimationFrame(this.drawFrame);
    if (this.hoverFrame !== undefined) cancelAnimationFrame(this.hoverFrame);
    this.drawFrame = undefined;
    this.hoverFrame = undefined;
    this.abort.abort();
    this.observer.disconnect();
    this.canvas.remove();
  }
}
