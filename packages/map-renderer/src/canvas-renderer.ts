import { geoNaturalEarth1, geoPath } from 'd3-geo';
import type { MapScene, RenderFeature, RenderPoint } from './types.js';
import { projectionGeometry } from './projection-geometry.js';
import { clusterScreenMarkers, type ScreenMarkerCluster } from './marker-clusters.js';
import { drawVisitedCluster, drawVisitedMarker } from './visited-marker-icons.js';

type Bounds = [number, number, number, number];
type Shape = RenderFeature & { path: Path2D; bounds: Bounds };
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
  private abort = new AbortController();

  constructor(
    host: HTMLElement,
    private select: (id: string, point: boolean, markerIds?: string[]) => void,
    private hover: (item: MapHover | undefined) => void = () => {},
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
          this.draw();
        } else {
          const hit = this.hit(event.offsetX, event.offsetY);
          this.hover(hit ? { ...hit, x: event.offsetX, y: event.offsetY } : undefined);
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
    this.canvas.addEventListener('pointerleave', () => this.hover(undefined), options);
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
    if (reset || !previous.features.length) this.fit();
    else this.draw();
  }
  fit(ids?: string[], selectionScale = 1) {
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
      Math.max(1, this.width - 36) / (b[2] - b[0] || 1),
      Math.max(1, this.height - 36) / (b[3] - b[1] || 1),
    );
    if (!ids?.length) this.fullScale = targetScale;
    this.scale =
      Math.min(targetScale, this.fullScale * (this.scene.world ? 20 : 36)) * selectionScale;
    this.x = this.width / 2 - ((b[0] + b[2]) / 2) * this.scale;
    this.y = this.height / 2 - ((b[1] + b[3]) / 2) * this.scale;
    this.draw();
  }
  zoom(factor: number, x = this.width / 2, y = this.height / 2) {
    const next = Math.max(
      this.fullScale * 0.75,
      Math.min(this.fullScale * (this.scene.world ? 20 : 36), this.scale * factor),
    );
    const scaleRatio = next / this.scale;
    this.x = x - (x - this.x) * scaleRatio;
    this.y = y - (y - this.y) * scaleRatio;
    this.scale = next;
    this.draw();
  }
  focusPoints(ids: readonly string[], maxRelativeZoom = 24) {
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
    for (const group of [...(this.markerGroups || [])].reverse()) {
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
    for (const point of [...this.scene.points].filter((point) => !point.markerKind).reverse()) {
      const p = this.project(point.coords);
      if (Math.hypot(p[0] * this.scale + this.x - x, p[1] * this.scale + this.y - y) < 7)
        return { id: point.id, name: point.name, point: true };
    }
    const px = (x - this.x) / this.scale;
    const py = (y - this.y) / this.scale;
    const coordinates = this.scene.allowsRegionHit ? this.unproject([px, py]) : null;
    if (this.scene.allowsRegionHit) {
      if (!coordinates || !this.scene.allowsRegionHit(coordinates)) return;
    }
    const ctx = this.context;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const found = [...this.shapes]
      .reverse()
      .find(
        (f) =>
          f.interactive !== false &&
          px >= f.bounds[0] &&
          px <= f.bounds[2] &&
          py >= f.bounds[1] &&
          py <= f.bounds[3] &&
          ctx.isPointInPath(f.path, px, py, 'evenodd') &&
          (!this.scene.allowsRegionHit ||
            (coordinates && this.scene.allowsRegionHit(coordinates, f.geometry))),
      );
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
    const boundaryWidth =
      this.scene.detailLevel === 'province' ? 1.4 : this.scene.detailLevel === 'city' ? 0.9 : 0.5;
    const boundaryColor = this.scene.dark
      ? '#91b0bb'
      : this.scene.detailLevel === 'county'
        ? '#8ca49d'
        : '#57726b';
    for (const f of this.shapes) {
      ctx.fillStyle = f.fill;
      ctx.fill(f.path, 'evenodd');
      ctx.strokeStyle = f.selected ? '#cf762b' : boundaryColor;
      ctx.lineWidth = (f.selected ? 2 : boundaryWidth) / this.scale;
      ctx.stroke(f.path);
    }
    for (const point of this.scene.points.filter((point) => !point.markerKind)) {
      const [x, y] = this.project(point.coords);
      ctx.beginPath();
      ctx.arc(x, y, 3.5 / this.scale, 0, Math.PI * 2);
      ctx.fillStyle = point.marked ? '#d16932' : '#427a9d';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 0.7 / this.scale;
      ctx.stroke();
    }
    this.markerGroups = clusterScreenMarkers(
      this.scene.points
        .filter((point) => point.markerKind)
        .map((point) => {
          const [x, y] = this.project(point.coords);
          return {
            id: point.id,
            value: point,
            x: x * this.scale + this.x,
            y: y * this.scale + this.y,
          };
        }),
    );
    // Marker sizes are screen pixels, independent of map projection and zoom.
    // PNG export uses this same path, including the original SVG-derived symbols.
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    for (const group of this.markerGroups) {
      if (group.members.length > 1) drawVisitedCluster(ctx, group.members.length, group.x, group.y);
      else drawVisitedMarker(ctx, group.members[0]!.markerKind!, group.x, group.y);
    }
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
    this.abort.abort();
    this.observer.disconnect();
    this.canvas.remove();
  }
}
