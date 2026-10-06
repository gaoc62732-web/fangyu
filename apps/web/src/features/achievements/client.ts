import type { Catalog, RecordSnapshot } from '@fangyu/contracts';
import type { AchievementPayloads, AchievementResponse, AchievementResults } from './protocol.js';

export class AchievementWorker {
  private readonly worker = new Worker(
    new URL('../../workers/achievements.worker.ts', import.meta.url),
    {
      type: 'module',
    },
  );
  private readonly ready: Promise<null>;
  private serial = 0;
  private failure: Error | undefined;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >();
  constructor(catalog: Catalog, snapshot: RecordSnapshot) {
    this.worker.onmessage = ({ data }: MessageEvent<AchievementResponse>) => {
      const p = this.pending.get(data.id);
      if (!p) return;
      this.pending.delete(data.id);
      if ('error' in data) p.reject(Error(data.error));
      else p.resolve(data.result);
    };
    this.worker.onerror = this.worker.onmessageerror = () => {
      this.fail(Error('后台成就计算失败，请重新载入页面。'));
    };
    this.ready = this.send('init', { catalog, snapshot });
    void this.ready.catch((error: unknown) =>
      this.fail(error instanceof Error ? error : Error(String(error))),
    );
  }
  async request<K extends Exclude<keyof AchievementPayloads, 'init'>>(
    type: K,
    ...args: AchievementPayloads[K] extends undefined ? [] : [payload: AchievementPayloads[K]]
  ): Promise<AchievementResults[K]> {
    await this.ready;
    return this.send(type, args[0]);
  }

  private send<K extends keyof AchievementPayloads>(
    type: K,
    payload: AchievementPayloads[K] | undefined,
  ): Promise<AchievementResults[K]> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const id = ++this.serial;
      this.pending.set(id, { resolve: (value) => resolve(value as AchievementResults[K]), reject });
      try {
        this.worker.postMessage({ id, type, payload });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  private fail(error: Error) {
    if (this.failure) return;
    this.failure = error;
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
  }

  destroy() {
    this.fail(Error('查询已结束'));
  }
}
