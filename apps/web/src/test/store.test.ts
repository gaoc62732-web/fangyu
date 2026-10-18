import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../app/store.js';
import { loadWebCatalogSnapshot, webCatalogRevision } from '../app/catalog-loader.js';
import { storage } from './setup.js';
import { airport, catalog, dongcheng, station } from './fixtures.js';

beforeEach(() => {
  vi.mocked(loadWebCatalogSnapshot).mockReset().mockResolvedValue({ catalog, revision: null });
  vi.mocked(webCatalogRevision).mockReset().mockResolvedValue(null);
});

describe('record persistence', () => {
  it('releases shared China boundary data after its final consumer leaves', async () => {
    const store = useAppStore();
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ schemaVersion: 2, arcs: {}, profiles: [], fixedPaths: [] }), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const first = await store.acquireChinaBoundaries();
    const second = await store.acquireChinaBoundaries();
    expect(store.chinaBoundaryData).toBe(first.data);
    expect(fetchMock).toHaveBeenCalledOnce();

    first.release();
    expect(store.chinaBoundaryData).toBe(first.data);
    second.release();
    expect(store.chinaBoundaryData).toBeUndefined();
    second.release();
    expect(store.chinaBoundaryData).toBeUndefined();
  });

  it('does not save or change the revision when there is nothing to undo', async () => {
    const store = useAppStore();
    await store.load();
    const revision = store.revision;
    store.undo();
    await store.flush();
    expect(store.revision).toBe(revision);
    expect(storage.write).not.toHaveBeenCalled();
  });

  it('refreshes an edited local catalogue once when concurrent checks see a new revision', async () => {
    const store = useAppStore();
    await store.load();
    vi.mocked(loadWebCatalogSnapshot).mockClear();
    const previousRevision = store.revision;
    const addedEntry = {
      ...catalog.entries[0]!,
      id: 'new-local-point',
      recordId: 'new-local-point',
      name: '新点位',
    };
    const updatedCatalog = { ...catalog, entries: [...catalog.entries, addedEntry] };
    vi.mocked(webCatalogRevision).mockResolvedValue(1);
    vi.mocked(loadWebCatalogSnapshot).mockResolvedValue({ catalog: updatedCatalog, revision: 1 });

    await Promise.all([store.refreshCatalog(), store.refreshCatalog()]);

    expect(loadWebCatalogSnapshot).toHaveBeenCalledOnce();
    expect(store.session!.index.catalog.entries.some((entry) => entry.id === addedEntry.id)).toBe(
      true,
    );
    expect(store.manualCatalogRevision).toBe(1);
    expect(store.revision).toBe(previousRevision + 1);
  });

  it('saves independent snapshots in order with the previous saved revision', async () => {
    const store = useAppStore();
    await store.load();
    store.commit((session) => session.markEntry(airport, true, dongcheng));
    store.commit((session) => session.markEntry(station, true, dongcheng));
    await store.flush();
    expect(storage.write).toHaveBeenCalledTimes(2);
    const [first, second] = storage.write.mock.calls;
    expect(first![1]).toBe(0);
    expect(second![1]).toBe(1);
    expect(first![0].entries[station]).toBeUndefined();
    expect(second![0].entries[station]?.visited).toBe(true);
    expect(store.saveStatus).toBe('已自动保存');
  });

  it('reports a failed save and prevents subsequent writes from overwriting it', async () => {
    const store = useAppStore();
    await store.load();
    const error = Error('storage conflict');
    storage.write.mockRejectedValueOnce(error);
    store.commit((session) => session.markEntry(airport, true));
    await expect(store.flush()).rejects.toBe(error);
    store.commit((session) => session.markEntry(station, true));
    await expect(store.flush()).rejects.toBe(error);
    expect(storage.write).toHaveBeenCalledTimes(1);
    expect(store.saveStatus).toContain('保存失败');
  });

  it('rolls back invalid transactions without persisting a partial update', async () => {
    const store = useAppStore();
    await store.load();
    expect(
      store.commit((session) => {
        session.markEntry(airport, true);
        session.markEntry('missing', true);
      }),
    ).toBe(false);
    await store.flush();
    expect(store.session!.view(store.session!.entry(airport)).visited).toBe(false);
    expect(storage.write).not.toHaveBeenCalled();
  });
});
