import { afterEach, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { ArchiveDocument, RecordSnapshot } from '@fangyu/contracts';
import { catalog } from './fixtures.js';

const storageMock = vi.hoisted(() => ({
  read: vi.fn<() => Promise<RecordSnapshot | undefined>>(async () => undefined),
  write: vi.fn<(snapshot: RecordSnapshot, expectedRevision: number) => Promise<void>>(
    async () => {},
  ),
  archives: vi.fn<() => Promise<ArchiveDocument[]>>(async () => []),
  saveArchive: vi.fn<(archive: ArchiveDocument) => Promise<void>>(async () => {}),
  deleteArchive: vi.fn<(id: string) => Promise<void>>(async () => {}),
}));
export const storage = storageMock;
vi.mock('../app/data-access.js', () => ({ createAppDataAccess: () => storageMock }));
vi.mock('../app/catalog-loader.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../app/catalog-loader.js')>()),
  loadWebCatalog: async () => catalog,
}));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setActivePinia(createPinia());
  storage.read.mockReset().mockResolvedValue(undefined);
  storage.write.mockReset().mockResolvedValue(undefined);
  storage.archives.mockReset().mockResolvedValue([]);
  storage.saveArchive.mockReset().mockResolvedValue(undefined);
  storage.deleteArchive.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
