import type {
  GeographicFile,
  GeometryFeature,
  ImportPlan,
  ImportRow,
  VisitState,
} from '@fangyu/contracts';
import { VISIT_RANK } from '@fangyu/contracts';
import type { HandbookSession } from '@fangyu/domain';

type Point = number[];
type Bounds = [number, number, number, number];
interface CountyGeometry {
  regionId: string;
  polygons: Point[][][];
  bounds: Bounds;
}

function bounds(points: Point[]): Bounds {
  return points.reduce<Bounds>(
    (box, point) => [
      Math.min(box[0], point[0]!),
      Math.min(box[1], point[1]!),
      Math.max(box[2], point[0]!),
      Math.max(box[3], point[1]!),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
}

function overlaps(a: Bounds, b: Bounds): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);
}

function onSegment(point: Point, start: Point, end: Point): boolean {
  const tolerance = 1e-9;
  return (
    Math.abs(orientation(start, end, point)) < tolerance &&
    point[0]! >= Math.min(start[0]!, end[0]!) - tolerance &&
    point[0]! <= Math.max(start[0]!, end[0]!) + tolerance &&
    point[1]! >= Math.min(start[1]!, end[1]!) - tolerance &&
    point[1]! <= Math.max(start[1]!, end[1]!) + tolerance
  );
}

function inRing(point: Point, ring: Point[]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[previous]!;
    const b = ring[index]!;
    if (onSegment(point, a, b)) return true;
    if (
      a[1]! > point[1]! !== b[1]! > point[1]! &&
      point[0]! < ((b[0]! - a[0]!) * (point[1]! - a[1]!)) / (b[1]! - a[1]!) + a[0]!
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function inCounty(point: Point, county: CountyGeometry): boolean {
  return county.polygons.some(
    (polygon) =>
      polygon[0] &&
      inRing(point, polygon[0]) &&
      !polygon.slice(1).some((hole) => inRing(point, hole)),
  );
}

function crosses(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (abC * abD < 0 && cdA * cdB < 0) return true;
  return onSegment(c, a, b) || onSegment(d, a, b) || onSegment(a, c, d) || onSegment(b, c, d);
}

export class CountySpatialIndex {
  private readonly grid = new Map<string, CountyGeometry[]>();
  private readonly extent: Bounds = [Infinity, Infinity, -Infinity, -Infinity];

  constructor(session: HandbookSession, geometry: GeometryFeature[]) {
    for (const feature of geometry) {
      const region = feature.regionId ? session.index.regions.get(feature.regionId) : undefined;
      if (feature.level !== 'county' || !region || region.level !== 2 || region.historical)
        continue;
      if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') continue;
      const polygons =
        feature.geometry.type === 'Polygon'
          ? [feature.geometry.coordinates]
          : feature.geometry.coordinates;
      const box = bounds(polygons.flat(2));
      const county: CountyGeometry = { regionId: region.id, polygons, bounds: box };
      this.extent[0] = Math.min(this.extent[0], box[0]);
      this.extent[1] = Math.min(this.extent[1], box[1]);
      this.extent[2] = Math.max(this.extent[2], box[2]);
      this.extent[3] = Math.max(this.extent[3], box[3]);
      for (let x = Math.floor(box[0]); x <= Math.floor(box[2]); x++) {
        for (let y = Math.floor(box[1]); y <= Math.floor(box[3]); y++) {
          const key = x + ',' + y;
          const group = this.grid.get(key) || [];
          group.push(county);
          this.grid.set(key, group);
        }
      }
    }
  }

  private candidates(box: Bounds): Set<CountyGeometry> {
    const found = new Set<CountyGeometry>();
    if (!overlaps(box, this.extent)) return found;
    for (
      let x = Math.floor(Math.max(box[0], this.extent[0]));
      x <= Math.floor(Math.min(box[2], this.extent[2]));
      x++
    ) {
      for (
        let y = Math.floor(Math.max(box[1], this.extent[1]));
        y <= Math.floor(Math.min(box[3], this.extent[3]));
        y++
      ) {
        for (const county of this.grid.get(x + ',' + y) || []) {
          if (overlaps(box, county.bounds)) found.add(county);
        }
      }
    }
    return found;
  }

  pointHits(point: Point): Set<string> {
    return new Set(
      [...this.candidates(bounds([point]))]
        .filter((county) => inCounty(point, county))
        .map((county) => county.regionId),
    );
  }

  lineHits(line: Point[]): Set<string> {
    if (line.length === 1) return this.pointHits(line[0]!);
    const hits = new Set<string>();
    for (let index = 1; index < line.length; index++) {
      const start = line[index - 1]!;
      const end = line[index]!;
      for (const county of this.candidates(bounds([start, end]))) {
        if (hits.has(county.regionId)) continue;
        const intersects =
          inCounty(start, county) ||
          inCounty(end, county) ||
          county.polygons.some((polygon) =>
            polygon.some((ring) =>
              ring.some((point, position) =>
                crosses(start, end, point, ring[(position + 1) % ring.length]!),
              ),
            ),
          );
        if (intersects) hits.add(county.regionId);
      }
    }
    return hits;
  }
}

export function geographicPlan(
  session: HandbookSession,
  spatial: CountySpatialIndex,
  files: GeographicFile[],
  state: VisitState,
): ImportPlan {
  const rows = new Map<string, ImportRow>();
  const notes: string[] = [];
  const add = (regionId: string, source: string, input: string, ambiguous: boolean) => {
    const existing = rows.get(regionId);
    if (existing) {
      existing.source += '；' + source;
      if (ambiguous) {
        existing.include = false;
        existing.result = '包含边界歧义，需手动确认';
      }
      return;
    }
    const region = session.index.regions.get(regionId)!;
    rows.set(regionId, {
      id: crypto.randomUUID(),
      source,
      input,
      kind: 'region',
      candidates: [
        { id: regionId, name: region.name, path: session.index.paths.get(regionId) || '' },
      ],
      choice: 0,
      include: !ambiguous && VISIT_RANK[state] > VISIT_RANK[session.visitState(regionId)],
      state,
      result: ambiguous ? '边界重叠，需手动确认' : '已匹配',
    });
  };

  for (const file of files) {
    if (file.unsupported)
      notes.push(file.fileName + '：跳过 ' + file.unsupported + ' 个不支持的面或关系。');
    for (const item of file.items) {
      let matched = false;
      for (const point of item.points) {
        const hits = spatial.pointHits(point);
        matched ||= hits.size > 0;
        for (const id of hits) add(id, file.fileName, item.name, hits.size > 1);
      }
      for (const line of item.lines) {
        const hits = spatial.lineHits(line);
        matched ||= hits.size > 0;
        for (const id of hits) add(id, file.fileName, item.name, false);
      }
      if (!matched) notes.push(file.fileName + ' · ' + item.name + '：未匹配县区');
    }
  }
  return {
    title: '地理文件',
    baseRevision: session.revision,
    rows: [...rows.values()],
    notes,
    applied: false,
  };
}
