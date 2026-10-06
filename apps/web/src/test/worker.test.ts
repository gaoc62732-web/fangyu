import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { AchievementWorker } from '../features/achievements/client.js';
import type { AchievementRequest, AchievementResponse } from '../features/achievements/protocol.js';
import { catalog, createSession } from './fixtures.js';

class FakeWorker {
  static current: FakeWorker;
  messages: AchievementRequest[] = [];
  onmessage: ((event: MessageEvent<AchievementResponse>) => void) | undefined;
  onerror: (() => void) | undefined;
  onmessageerror: (() => void) | undefined;
  terminate = vi.fn();
  postMessage = vi.fn((message: AchievementRequest) => this.messages.push(message));
  constructor() {
    FakeWorker.current = this;
  }
  reply(data: AchievementResponse) {
    this.onmessage?.(new MessageEvent('message', { data }));
  }
}
beforeEach(() => vi.stubGlobal('Worker', FakeWorker));
function open() {
  const client = new AchievementWorker(catalog, createSession().snapshot());
  return { client, worker: FakeWorker.current };
}

describe('achievement worker lifecycle', () => {
  it('waits for initialization and correlates replies arriving out of order', async () => {
    const { client, worker } = open();
    const first = client.request('achievement', 'first');
    const second = client.request('achievement', 'second');
    expect(worker.messages).toHaveLength(1);
    worker.reply({ id: worker.messages[0]!.id, result: null });
    await flushPromises();
    expect(worker.messages).toHaveLength(3);
    worker.reply({ id: worker.messages[2]!.id, error: 'second failed' });
    await expect(second).rejects.toThrow('second failed');
    worker.reply({ id: worker.messages[1]!.id, result: undefined });
    await expect(first).resolves.toBeUndefined();
    client.destroy();
  });

  it('keeps initialization errors visible to queued and future requests', async () => {
    const { client, worker } = open();
    const query = client.request('achievements');
    worker.reply({ id: worker.messages[0]!.id, error: 'invalid snapshot' });
    await expect(query).rejects.toThrow('invalid snapshot');
    await expect(client.request('achievements')).rejects.toThrow('invalid snapshot');
    expect(worker.messages).toHaveLength(1);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it.each(['onerror', 'onmessageerror'] as const)(
    'rejects pending requests on %s',
    async (event) => {
      const { client, worker } = open();
      worker.reply({ id: worker.messages[0]!.id, result: null });
      const query = client.request('achievements');
      await flushPromises();
      worker[event]?.();
      await expect(query).rejects.toThrow('后台成就计算失败');
      await expect(client.request('achievements')).rejects.toThrow('后台成就计算失败');
      client.destroy();
      expect(worker.terminate).toHaveBeenCalledOnce();
    },
  );

  it('rejects requests when destroyed during initialization', async () => {
    const { client, worker } = open();
    const query = client.request('achievements');
    client.destroy();
    await expect(query).rejects.toThrow('查询已结束');
    worker.reply({ id: worker.messages[0]!.id, result: null });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('rejects clone errors without leaving an unresolved request', async () => {
    const { client, worker } = open();
    worker.reply({ id: worker.messages[0]!.id, result: null });
    worker.postMessage.mockImplementationOnce(() => {
      throw new DOMException('cannot clone', 'DataCloneError');
    });
    await expect(client.request('sync', createSession().snapshot())).rejects.toThrow(
      'cannot clone',
    );
    client.destroy();
  });
});
