/** Original travel symbols, not UNESCO's emblem or an airline logo. */
export const VISITED_MARKER_PATHS = {
  airport: 'M12 2 10.5 9 3 13v2l7.5-2 .5 5-3 2v2l4-1.5 4 1.5v-2l-3-2 .5-5 7.5 2v-2L13.5 9Z',
  'world-heritage': 'M3 9 12 3 21 9ZM4 11h16M5 11v8m4-8v8m6-8v8m4-8v8M3 20h18M2 22h20',
} as const;

export type VisitedMarkerKind = 'airport' | 'world-heritage' | 'project-reference';
const paths = new Map<string, Path2D>();

export function drawVisitedMarker(
  context: CanvasRenderingContext2D,
  kind: VisitedMarkerKind,
  x: number,
  y: number,
  size = 30,
) {
  const symbol = kind === 'airport' ? 'airport' : 'world-heritage';
  let path = paths.get(symbol);
  if (!path) {
    path = new Path2D(VISITED_MARKER_PATHS[symbol]);
    paths.set(symbol, path);
  }
  context.save();
  context.translate(x, y);
  context.fillStyle = '#fffdf5';
  context.strokeStyle = kind === 'project-reference' ? '#966516' : '#215d50';
  context.lineWidth = 1.4;
  if (kind === 'project-reference') context.setLineDash([3, 2]);
  context.beginPath();
  context.arc(0, 0, size / 2 - 1, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.setLineDash([]);
  const scale = (size - 10) / 24;
  context.scale(scale, scale);
  context.translate(-12, -12);
  context.lineWidth = 1.8;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.stroke(path);
  context.restore();
}

export function drawVisitedCluster(
  context: CanvasRenderingContext2D,
  count: number,
  x: number,
  y: number,
  size = 36,
) {
  context.save();
  context.beginPath();
  context.arc(x, y, size / 2 - 1, 0, Math.PI * 2);
  context.fillStyle = '#215d50';
  context.strokeStyle = '#fffdf5';
  context.lineWidth = 2;
  context.fill();
  context.stroke();
  context.fillStyle = '#fff';
  context.font = 'bold 12px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(count > 999 ? `${Math.floor(count / 1000)}k+` : String(count), x, y + 0.5);
  context.restore();
}
