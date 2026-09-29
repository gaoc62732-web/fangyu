import { geoNaturalEarth1, geoPath } from 'd3-geo';
import type { MapScene, RenderFeature } from './types.js';

type Bounds = [number, number, number, number];
type Shape = RenderFeature & { path: Path2D; bounds: Bounds };
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
  private pathCache = new WeakMap<
    GeoJSON.Geometry,
    { world: boolean; path: Path2D; bounds: Bounds }
  >();
  private project = mercator;
  private width = 1;
  private height = 1;
  private scale = 1;
  private x = 0;
  private y = 0;
  private drag: { x: number; y: number; startX: number; startY: number } | undefined;
  private abort = new AbortController();

  constructor(
    host: HTMLElement,
    private select: (id: string, point: boolean) => void,
    private hover: (name: string) => void = () => {},
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
          this.x += event.offsetX - this.drag.x;
          this.y += event.offsetY - this.drag.y;
          this.drag.x = event.offsetX;
          this.drag.y = event.offsetY;
          this.draw();
        } else this.hover(this.hit(event.offsetX, event.offsetY)?.name || '');
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
          const hit = this.hit(event.offsetX, event.offsetY);
          if (hit) this.select(hit.id, hit.point);
        }
        this.drag = undefined;
      },
      options,
    );
    this.canvas.addEventListener(
      'pointercancel',
      () => {
        this.drag = undefined;
      },
      options,
    );
    this.canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.zoom(Math.exp(-event.deltaY * 0.001), event.offsetX, event.offsetY);
      },
      { ...options, passive: false },
    );
    this.observer = new ResizeObserver(() => {
      this.width = host.clientWidth || 800;
      this.height = host.clientHeight || 560;
      const ratio = devicePixelRatio || 1;
      this.canvas.width = Math.round(this.width * ratio);
      this.canvas.height = Math.round(this.height * ratio);
      this.fit();
    });
    this.observer.observe(host);
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
    const path = geoPath(projection);
    this.shapes = scene.features.map((feature) => {
      const cached = this.pathCache.get(feature.geometry);
      if (cached && cached.world === Boolean(scene.world)) {
        return { ...feature, path: cached.path, bounds: cached.bounds };
      }
      const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
      let shape: Path2D;
      if (scene.world) {
        const f = { type: 'Feature' as const, geometry: feature.geometry, properties: {} };
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
  fit(ids?: string[]) {
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
    this.scale = Math.min(
      (this.width - 36) / (b[2] - b[0] || 1),
      (this.height - 36) / (b[3] - b[1] || 1),
    );
    this.x = this.width / 2 - ((b[0] + b[2]) / 2) * this.scale;
    this.y = this.height / 2 - ((b[1] + b[3]) / 2) * this.scale;
    this.draw();
  }
  zoom(factor: number, x = this.width / 2, y = this.height / 2) {
    const next = Math.max(0.3, Math.min(50000, this.scale * factor));
    const scaleRatio = next / this.scale;
    this.x = x - (x - this.x) * scaleRatio;
    this.y = y - (y - this.y) * scaleRatio;
    this.scale = next;
    this.draw();
  }
  private hit(x: number, y: number) {
    for (const point of [...this.scene.points].reverse()) {
      const p = this.project(point.coords);
      if (Math.hypot(p[0] * this.scale + this.x - x, p[1] * this.scale + this.y - y) < 7)
        return { id: point.id, name: point.name, point: true };
    }
    const px = (x - this.x) / this.scale;
    const py = (y - this.y) / this.scale;
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
          ctx.isPointInPath(f.path, px, py, 'evenodd'),
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
    for (const f of this.shapes) {
      ctx.fillStyle = f.fill;
      ctx.fill(f.path, 'evenodd');
      ctx.strokeStyle = f.selected ? '#cf762b' : this.scene.dark ? '#75888b' : '#9fafac';
      ctx.lineWidth = (f.selected ? 2 : 0.5) / this.scale;
      ctx.stroke(f.path);
    }
    for (const point of this.scene.points) {
      const [x, y] = this.project(point.coords);
      ctx.beginPath();
      ctx.arc(x, y, 3.5 / this.scale, 0, Math.PI * 2);
      ctx.fillStyle = point.marked ? '#d16932' : '#427a9d';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 0.7 / this.scale;
      ctx.stroke();
    }
  }
  async png(title: string, legend: { label: string; color: string }[] = []): Promise<Blob> {
    const image = document.createElement('canvas');
    image.width = Math.max(this.canvas.width, 720);
    image.height = this.canvas.height + 160;
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
    ctx.fillText('边界与点位仅供旅行记录参考，不作为权威区划依据。', 24, image.height - 12);
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
