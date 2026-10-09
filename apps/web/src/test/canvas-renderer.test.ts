import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasMapRenderer, type MapScene } from '@fangyu/map-renderer';

const pathState = vi.hoisted(() => ({ created: 0 }));
const context = {
  arc: vi.fn(),
  beginPath: vi.fn(),
  fill: vi.fn(),
  fillRect: vi.fn(),
  isPointInPath: vi.fn(() => false),
  lineTo: vi.fn(),
  moveTo: vi.fn(),
  restore: vi.fn(),
  save: vi.fn(),
  scale: vi.fn(),
  setLineDash: vi.fn(),
  setTransform: vi.fn(),
  stroke: vi.fn(),
  translate: vi.fn(),
} as unknown as CanvasRenderingContext2D;

const feature = (id: string, bounds: [number, number, number, number]) => ({
  id,
  name: id,
  bounds,
  fill: '#fff',
  geometry: {
    type: 'Polygon' as const,
    coordinates: [
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[1]],
        [bounds[2], bounds[3]],
        [bounds[0], bounds[3]],
        [bounds[0], bounds[1]],
      ],
    ],
  },
});

function scene(features: MapScene['features']): MapScene {
  return { features, points: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  pathState.created = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => context as CanvasRenderingContext2D,
  );
  vi.stubGlobal(
    'Path2D',
    class {
      constructor() {
        pathState.created++;
      }
      closePath() {}
      lineTo() {}
      moveTo() {}
    },
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('canvas renderer work scheduling', () => {
  it('creates paths only when their feature intersects the viewport', () => {
    const host = document.createElement('div');
    Object.defineProperty(host, 'clientWidth', { value: 800 });
    Object.defineProperty(host, 'clientHeight', { value: 500 });
    document.body.append(host);
    const renderer = new CanvasMapRenderer(host, () => {});
    const first = feature('first', [0, 0, 1, 1]);
    const outside = feature('outside', [80, 0, 81, 1]);
    renderer.setScene(scene([first]));
    expect(pathState.created).toBe(1);

    renderer.setScene(scene([first, outside]));
    expect(pathState.created).toBe(1);

    renderer.setCamera({ center: [80.5, 0.5], zoom: 5 });
    expect(pathState.created).toBe(2);
    renderer.destroy();
    host.remove();
  });

  it('coalesces multiple zoom updates into one animation-frame draw', () => {
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const host = document.createElement('div');
    Object.defineProperty(host, 'clientWidth', { value: 800 });
    Object.defineProperty(host, 'clientHeight', { value: 500 });
    document.body.append(host);
    const renderer = new CanvasMapRenderer(host, () => {});
    renderer.setScene(scene([feature('first', [0, 0, 1, 1])]));
    const drawCount = vi.mocked(context.fillRect).mock.calls.length;

    renderer.zoom(1.1);
    renderer.zoom(1.1);
    renderer.zoom(1.1);
    expect(requestFrame).toHaveBeenCalledOnce();
    expect(vi.mocked(context.fillRect)).toHaveBeenCalledTimes(drawCount);
    frames[0]!(performance.now());
    expect(vi.mocked(context.fillRect)).toHaveBeenCalledTimes(drawCount + 1);
    renderer.destroy();
    host.remove();
  });
});
