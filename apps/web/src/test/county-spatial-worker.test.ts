import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { DEFAULT_CHINA_BOUNDARIES, type GeographicFile } from '@fangyu/contracts';
import type {
  CountySpatialRequest,
  CountySpatialResponse,
} from '../features/imports/county-spatial-protocol.js';
import { CountySpatialWorker } from '../features/imports/county-spatial-client.js';

class FakeWorker {
  static current: FakeWorker;
  messages: CountySpatialRequest[] = [];
  onmessage: ((event: MessageEvent<CountySpatialResponse>) => void) | undefined;
  onerror: (() => void) | undefined;
  onmessageerror: (() => void) | undefined;
  terminate = vi.fn();
  postMessage = vi.fn((message: CountySpatialRequest) => this.messages.push(message));
  constructor() {
    FakeWorker.current = this;
  }
  reply(data: CountySpatialResponse) {
    this.onmessage?.(new MessageEvent('message', { data }));
  }
}

beforeEach(() => vi.stubGlobal('Worker', FakeWorker));

describe('county spatial worker lifecycle', () => {
  it('keeps geometry in the worker and returns only geographic match ids', async () => {
    const client = new CountySpatialWorker('/app/', [], DEFAULT_CHINA_BOUNDARIES);
    const worker = FakeWorker.current;
    expect(worker.messages[0]).toMatchObject({ type: 'init', payload: { baseUrl: '/app/' } });
    worker.reply({ id: worker.messages[0]!.id, result: null });
    await flushPromises();
    const files: GeographicFile[] = [
      {
        fileName: 'track.kml',
        items: [{ name: 'track', points: [[116.4, 39.9]], lines: [], vertices: 1 }],
        vertices: 1,
        unsupported: 0,
      },
    ];
    const result = client.matchGeographic(files);
    await flushPromises();
    const request = worker.messages[1]!;
    expect(request).toMatchObject({ type: 'geographic', payload: files });
    worker.reply({
      id: request.id,
      result: [{ items: [{ pointHits: [['dongcheng']], lineHits: [] }] }],
    });
    await expect(result).resolves.toEqual([
      { items: [{ pointHits: [['dongcheng']], lineHits: [] }] },
    ]);
    client.destroy();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('rejects pending requests when the import page releases the worker', async () => {
    const client = new CountySpatialWorker('/app/', [], DEFAULT_CHINA_BOUNDARIES);
    const worker = FakeWorker.current;
    const result = client.matchPoints([[116.4, 39.9]]);
    client.destroy();
    await expect(result).rejects.toThrow('已释放');
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
