import type { ChinaBoundarySettings, GeographicFile, Region } from '@fangyu/contracts';
import type { GeographicFileMatches } from '@fangyu/import-export';
import type { CountySpatialRequest, CountySpatialResponse } from './county-spatial-protocol.js';

export class CountySpatialWorker {
  private readonly worker = new Worker(
    new URL('../../workers/county-spatial.worker.ts', import.meta.url),
    { type: 'module' },
  );
  private readonly ready: Promise<null>;
  private serial = 0;
  private failure: Error | undefined;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >();

  constructor(
    baseUrl: string,
    counties: Pick<Region, 'id' | 'level' | 'historical'>[],
    settings: ChinaBoundarySettings,
  ) {
    this.worker.onmessage = ({ data }: MessageEvent<CountySpatialResponse>) => {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);
      if ('error' in data) pending.reject(Error(data.error));
      else pending.resolve(data.result);
    };
    this.worker.onerror = this.worker.onmessageerror = () => {
      this.fail(Error('县级空间索引后台处理失败，请重新载入导入页面。'));
    };
    this.ready = this.send('init', { baseUrl, counties, settings });
    void this.ready.catch((cause: unknown) =>
      this.fail(cause instanceof Error ? cause : Error(String(cause))),
    );
  }

  async matchGeographic(files: GeographicFile[]): Promise<GeographicFileMatches[]> {
    await this.ready;
    return this.send('geographic', files);
  }

  async matchPoints(points: [number, number][]): Promise<string[][]> {
    await this.ready;
    return this.send('points', points);
  }

  private send(
    type: 'init',
    payload: Extract<CountySpatialRequest, { type: 'init' }>['payload'],
  ): Promise<null>;
  private send(type: 'geographic', payload: GeographicFile[]): Promise<GeographicFileMatches[]>;
  private send(type: 'points', payload: [number, number][]): Promise<string[][]>;
  private send(type: CountySpatialRequest['type'], payload: unknown): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const id = ++this.serial;
      this.pending.set(id, { resolve, reject });
      try {
        this.worker.postMessage({ id, type, payload } as CountySpatialRequest);
      } catch (cause) {
        this.pending.delete(id);
        reject(cause);
      }
    });
  }

  private fail(error: Error) {
    if (this.failure) return;
    this.failure = error;
    this.worker.terminate();
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  destroy() {
    this.fail(Error('县级空间索引已释放'));
  }
}
