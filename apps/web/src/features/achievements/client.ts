import type { Catalog, RecordSnapshot } from '@fangyu/contracts';
export class AchievementWorker {
  private worker = new Worker(new URL('../../workers/achievements.worker.ts', import.meta.url), {
    type: 'module',
  });
  private serial = 0;
  private failure: Error | undefined;
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (reason: Error) => void }
  >();
  constructor(catalog: Catalog, snapshot: RecordSnapshot) {
    this.worker.onmessage = ({ data }) => {
      const p = this.pending.get(data.id);
      if (!p) return;
      this.pending.delete(data.id);
      if (data.error) p.reject(Error(data.error));
      else p.resolve(data.result);
    };
    this.worker.onerror = () => {
      this.failure = Error('后台目录查询失败，请重新载入页面。');
      for (const p of this.pending.values()) p.reject(this.failure);
      this.pending.clear();
    };
    void this.request('init', { catalog, snapshot }).catch(() => {});
  }
  request<T = unknown>(type: string, payload?: unknown): Promise<T> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const id = ++this.serial;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, payload });
    });
  }
  destroy() {
    this.failure = Error('查询已结束');
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(Error('查询已结束'));
    this.pending.clear();
  }
}
