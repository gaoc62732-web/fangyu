import { geoMercator, geoNaturalEarth1, geoPath, geoCentroid } from 'd3-geo';
import type { RenderFeature, RenderPoint } from './types.js';
import { projectionGeometry } from './projection-geometry.js';
export async function footprintPng(
  features: RenderFeature[],
  points: RenderPoint[],
  options: {
    width: number;
    title: string;
    subtitle: string;
    world: boolean;
    legend: { label: string; color: string }[];
  },
): Promise<Blob> {
  if (!features.length) throw Error('当前范围没有可导出的独立边界，请选择更大的地区。');
  features = features.map((f) => ({ ...f, geometry: projectionGeometry(f.geometry) }));
  const canvas = document.createElement('canvas');
  const ratio = options.width / 1920;
  canvas.width = options.width;
  canvas.height = Math.round(options.width * 0.68);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#faf9f3';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const collection: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: features.map((f) => ({ type: 'Feature', geometry: f.geometry, properties: {} })),
  };
  const projection = (options.world ? geoNaturalEarth1() : geoMercator()).fitExtent(
    [
      [60 * ratio, 145 * ratio],
      [canvas.width - 60 * ratio, canvas.height - 140 * ratio],
    ],
    collection,
  );
  const draw = geoPath(projection, ctx);
  for (const f of features) {
    ctx.beginPath();
    draw({ type: 'Feature', geometry: f.geometry, properties: {} });
    ctx.fillStyle = f.fill;
    ctx.fill('evenodd');
    ctx.strokeStyle = '#82978b';
    ctx.lineWidth = 0.7 * ratio;
    ctx.stroke();
  }
  for (const p of points) {
    const xy = projection(p.coords);
    if (!xy) continue;
    ctx.beginPath();
    ctx.arc(xy[0], xy[1], 4 * ratio, 0, Math.PI * 2);
    ctx.fillStyle = '#ae7131';
    ctx.fill();
  }
  const occupied: { x: number; y: number; width: number }[] = [];
  ctx.font = 14 * ratio + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#344b40';
  for (const f of features) {
    if (!f.name) continue;
    const bounds = geoPath(projection).bounds({
      type: 'Feature',
      geometry: f.geometry,
      properties: {},
    });
    if (bounds[1][0] - bounds[0][0] < 45 * ratio || bounds[1][1] - bounds[0][1] < 24 * ratio)
      continue;
    const xy = projection(geoCentroid({ type: 'Feature', geometry: f.geometry, properties: {} }));
    if (!xy) continue;
    const width = ctx.measureText(f.name).width;
    if (
      occupied.some(
        (p) =>
          Math.abs(p.x - xy[0]) < (p.width + width) / 2 + 5 * ratio &&
          Math.abs(p.y - xy[1]) < 20 * ratio,
      )
    )
      continue;
    occupied.push({ x: xy[0], y: xy[1], width });
    ctx.fillText(f.name, xy[0], xy[1]);
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = '#213e32';
  ctx.font = 'bold ' + 36 * ratio + 'px sans-serif';
  ctx.fillText(options.title, 55 * ratio, 66 * ratio);
  ctx.font = 18 * ratio + 'px sans-serif';
  ctx.fillStyle = '#65776a';
  ctx.fillText(options.subtitle, 55 * ratio, 105 * ratio);
  const bottom = canvas.height - 92 * ratio;
  let x = 55 * ratio;
  ctx.font = 16 * ratio + 'px sans-serif';
  for (const item of options.legend) {
    ctx.fillStyle = item.color;
    ctx.fillRect(x, bottom - 14 * ratio, 16 * ratio, 16 * ratio);
    ctx.fillStyle = '#344b40';
    ctx.fillText(item.label, x + 23 * ratio, bottom);
    x += ctx.measureText(item.label).width + 66 * ratio;
  }
  ctx.font = 14 * ratio + 'px sans-serif';
  ctx.fillStyle = '#65776a';
  ctx.fillText(
    '方舆旅行手册 · ' +
      new Date().toLocaleDateString('zh-CN') +
      ' · 自有目录边界，仅供旅行记录参考',
    55 * ratio,
    canvas.height - 36 * ratio,
  );
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(Error('图片生成失败'))), 'image/png'),
  );
}
