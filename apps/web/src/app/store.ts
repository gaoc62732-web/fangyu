import { computed, markRaw, ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import { CatalogIndex, loadGeometry } from '@fangyu/catalog';
import { HandbookSession, PALETTES, darkColors, type MapColors } from '@fangyu/domain';
import type { ArchiveDocument, Catalog, GeometryFeature, Scope } from '@fangyu/contracts';
import type { HandbookStorage } from '@fangyu/data-access';
import { loadWebCatalog } from './catalog-loader.js';
import { createAppDataAccess } from './data-access.js';
import { CatalogWorker } from '../features/catalog/client.js';

export const useAppStore = defineStore('app', () => {
  const session = shallowRef<HandbookSession>();
  const worker = shallowRef<CatalogWorker>();
  const bootstrap = shallowRef<Pick<Catalog, 'version' | 'regions' | 'categories'>>();
  const revision = ref(0);
  const loading = ref(true);
  const loadError = ref('');
  const error = ref('');
  const saveStatus = ref('');
  const notice = ref('');
  const selectedRegionId = ref('');
  const category = ref('');
  const archives = ref<ArchiveDocument[]>([]);
  const dark = ref(localStorage.getItem('fangyu-theme') === 'dark');
  const geometry = shallowRef<Partial<Record<Scope, GeometryFeature[]>>>({});
  const baseUrl = import.meta.env.BASE_URL;
  let storage: HandbookStorage;
  let savedRevision = 0;
  let saveQueue = Promise.resolve();
  let saveFailure: unknown;
  const geometryRequests = new Map<Scope, Promise<GeometryFeature[]>>();

  async function load() {
    loading.value = true;
    loadError.value = '';
    try {
      void fetch(baseUrl + 'bootstrap.json')
        .then((response) => {
          if (!response.ok) return;
          return response.json().then((data) => {
            bootstrap.value = data;
          });
        })
        .catch(() => {});
      const catalog = await loadWebCatalog(baseUrl);
      storage = createAppDataAccess();
      const saved = await storage.read();
      session.value = markRaw(new HandbookSession(new CatalogIndex(catalog), saved));
      worker.value?.destroy();
      worker.value = markRaw(new CatalogWorker(catalog, session.value.snapshot()));
      savedRevision = saved?.revision || 0;
      saveFailure = undefined;
      revision.value++;
      archives.value = await storage.archives();
      saveStatus.value = '记录已载入';
    } catch (cause) {
      loadError.value = String(cause);
    } finally {
      loading.value = false;
    }
  }

  async function ensureGeometry(scope: Scope) {
    const existing = geometry.value[scope];
    if (existing) return existing;
    let request = geometryRequests.get(scope);
    if (!request) {
      request = loadGeometry(baseUrl, scope);
      geometryRequests.set(scope, request);
    }
    try {
      const features = await request;
      geometry.value = { ...geometry.value, [scope]: markRaw(features) };
      return features;
    } finally {
      geometryRequests.delete(scope);
    }
  }

  function persist() {
    if (saveFailure) {
      saveStatus.value = '保存失败，请导出 JSON 备份';
      return saveQueue;
    }
    const snapshot = session.value!.snapshot();
    saveStatus.value = '正在保存…';
    saveQueue = saveQueue.then(async () => {
      if (saveFailure) return;
      try {
        await storage.write(snapshot, savedRevision);
        savedRevision = snapshot.revision;
        saveStatus.value = '已自动保存';
      } catch (cause) {
        saveFailure = cause;
        saveStatus.value = '保存失败，请导出 JSON 备份';
        error.value = String(cause);
      }
    });
    return saveQueue;
  }

  function commit(update: (current: HandbookSession) => void): boolean {
    try {
      session.value!.transaction(() => update(session.value!));
      void worker.value?.request('sync', session.value!.snapshot()).catch((cause) => {
        error.value = String(cause);
      });
      revision.value++;
      void persist();
      return true;
    } catch (cause) {
      error.value = String(cause);
      return false;
    }
  }

  function undo() {
    session.value!.undo();
    void worker.value?.request('sync', session.value!.snapshot()).catch((cause) => {
      error.value = String(cause);
    });
    revision.value++;
    void persist();
    notice.value = '已撤销上一次记录操作';
  }

  async function flush() {
    await saveQueue;
    if (saveFailure) throw saveFailure;
  }
  async function retrySave() {
    await saveQueue;
    saveFailure = undefined;
    error.value = '';
    await persist();
    // The same expected revision is retained: a conflict never overwrites newer records.
    await flush();
  }

  function recordEntry(id: string, visited: boolean, regionId?: string, subitemId?: string) {
    const before = session.value!.snapshot().regions;
    const ok = commit((current) =>
      subitemId
        ? current.markSubitem(id, subitemId, visited, regionId)
        : current.markEntry(id, visited, regionId),
    );
    if (ok) {
      const after = session.value!.snapshot().regions;
      const names = Object.keys(after)
        .filter((key) => before[key] !== after[key])
        .map((key) => session.value!.index.regions.get(key)?.name)
        .filter(Boolean);
      notice.value =
        (visited ? '已记录到访' : '已取消项目标记，地区记录保留') +
        (names.length
          ? ' · 补记 ' +
            names.slice(0, 4).join('、') +
            (names.length > 4 ? ' 等 ' + names.length + ' 个地区' : '')
          : '');
    }
    return ok;
  }

  async function saveArchive(name: string, snapshot = session.value!.snapshot()) {
    const archive: ArchiveDocument = {
      id: crypto.randomUUID(),
      name: name.trim() || '未命名存档',
      createdAt: new Date().toISOString(),
      snapshot,
    };
    await storage.saveArchive(archive);
    archives.value = await storage.archives();
    return archive;
  }

  async function restore(snapshot: unknown) {
    const validated = session.value!.validate(snapshot);
    const before = session.value!.revision;
    await saveArchive('恢复前自动备份');
    if (session.value!.revision !== before) throw Error('备份期间记录已变化，请重新恢复。');
    if (!commit((current) => current.replace(validated))) throw Error(error.value);
    await saveQueue;
    if (saveFailure) throw saveFailure;
  }

  async function renameArchive(archive: ArchiveDocument, name: string) {
    await storage.saveArchive({ ...archive, name });
    archives.value = await storage.archives();
  }

  async function deleteArchive(id: string) {
    await storage.deleteArchive(id);
    archives.value = await storage.archives();
  }

  function setDark(value: boolean) {
    dark.value = value;
    localStorage.setItem('fangyu-theme', value ? 'dark' : 'light');
  }

  const rows = computed(() => {
    void revision.value;
    return session.value?.entries() || [];
  });
  const canUndo = computed(() => {
    void revision.value;
    return session.value?.canUndo || false;
  });
  const colors = computed<MapColors>(() => {
    void revision.value;
    const preferences = session.value?.preferences;
    const selected = preferences?.palette || 'jade';
    const colors =
      selected === 'custom'
        ? { ...PALETTES.jade.colors, ...preferences?.customColors }
        : PALETTES[selected].colors;
    return dark.value ? darkColors(colors) : colors;
  });

  return {
    session,
    worker,
    bootstrap,
    revision,
    loading,
    loadError,
    error,
    saveStatus,
    notice,
    selectedRegionId,
    category,
    archives,
    dark,
    load,
    commit,
    flush,
    retrySave,
    recordEntry,
    undo,
    saveArchive,
    restore,
    renameArchive,
    deleteArchive,
    setDark,
    rows,
    canUndo,
    colors,
    geometry,
    ensureGeometry,
  };
});
