import { computed, markRaw, ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import { loadWebCatalog } from './catalog-loader.js';
import { CatalogIndex } from '@fangyu/catalog';
import { HandbookSession, PALETTES, darkColors, type MapColors } from '@fangyu/domain';
import {
  DEFAULT_CHINA_BOUNDARIES,
  type ArchiveDocument,
  type Scope,
  type MapLevel,
} from '@fangyu/contracts';
import type { HandbookStorage } from '@fangyu/data-access';
import { createAppDataAccess } from './data-access.js';
import { appMode } from './mode.js';
import type { ChinaBoundaryData } from '../features/maps/china-boundaries.js';

export const useAppStore = defineStore('app', () => {
  const session = shallowRef<HandbookSession>();
  const revision = ref(0);
  const loading = ref(true);
  const loadError = ref('');
  const error = ref('');
  const saveStatus = ref('');
  const selectedRegionId = ref('');
  const category = ref('');
  const regionalMap = shallowRef<{
    scope: Scope;
    selected: string;
    level: MapLevel;
    camera?: { center: [number, number]; zoom: number };
  }>();
  const archives = ref<ArchiveDocument[]>([]);
  const dark = ref(localStorage.getItem('fangyu-theme') === 'dark');
  const chinaBoundaryData = shallowRef<ChinaBoundaryData>();
  const chinaBoundarySettings = computed(() => {
    void revision.value;
    return session.value?.preferences.chinaBoundaries || DEFAULT_CHINA_BOUNDARIES;
  });
  let boundaryRequest: Promise<ChinaBoundaryData> | undefined;
  let boundaryUsers = 0;
  async function loadChinaBoundaries() {
    if (chinaBoundaryData.value) return chinaBoundaryData.value;
    boundaryRequest ||= (async () => {
      const response = await fetch(baseUrl + 'maps/china-boundary-options.json.gz');
      if (!response.ok) throw Error('地区归属边界暂时无法加载。');
      const bytes = new Uint8Array(await response.arrayBuffer());
      const data =
        bytes[0] === 0x1f && bytes[1] === 0x8b
          ? ((await new Response(
              new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
            ).json()) as ChinaBoundaryData)
          : (JSON.parse(new TextDecoder().decode(bytes)) as ChinaBoundaryData);
      if (boundaryUsers) chinaBoundaryData.value = markRaw(data);
      return data;
    })();
    try {
      return await boundaryRequest;
    } finally {
      boundaryRequest = undefined;
    }
  }
  async function acquireChinaBoundaries() {
    boundaryUsers++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      boundaryUsers = Math.max(0, boundaryUsers - 1);
      if (!boundaryUsers) chinaBoundaryData.value = undefined;
    };
    try {
      const data = await loadChinaBoundaries();
      return { data, release };
    } catch (cause) {
      release();
      throw cause;
    }
  }
  const baseUrl = import.meta.env.BASE_URL;
  let storage: HandbookStorage;
  let savedRevision = 0;
  let saveQueue = Promise.resolve();
  let saveFailure: unknown;
  async function load() {
    loading.value = true;
    loadError.value = '';
    try {
      const catalog = await loadWebCatalog(baseUrl);
      storage = createAppDataAccess();
      const index = new CatalogIndex(catalog);
      let saved = await storage.read();
      let localImport = false;
      if (!saved && appMode() === 'demo' && location.hostname === '127.0.0.1') {
        const response = await fetch(baseUrl + 'local-records.json', { cache: 'no-store' });
        if (response.ok) {
          saved = new HandbookSession(index).validate(await response.json());
          await storage.write(saved, 0);
          localImport = true;
        }
      }
      session.value = markRaw(new HandbookSession(index, saved));
      savedRevision = saved?.revision || 0;
      saveFailure = undefined;
      revision.value++;
      archives.value = await storage.archives();
      saveStatus.value = localImport ? '已载入本机旧版迁移记录' : '记录已载入';
    } catch (cause) {
      loadError.value = String(cause);
    } finally {
      loading.value = false;
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
      selectedRegionId.value = session.value!.index.resolveRegion(selectedRegionId.value);
      revision.value++;
      void persist();
      return true;
    } catch (cause) {
      error.value = String(cause);
      return false;
    }
  }

  function undo() {
    if (!session.value?.canUndo) return;
    session.value!.undo();
    revision.value++;
    void persist();
  }

  async function flush() {
    await saveQueue;
    if (saveFailure) throw saveFailure;
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
    await flush();
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
    revision,
    loading,
    loadError,
    error,
    saveStatus,
    selectedRegionId,
    category,
    regionalMap,
    archives,
    dark,
    load,
    commit,
    undo,
    flush,
    saveArchive,
    restore,
    renameArchive,
    deleteArchive,
    setDark,
    rows,
    canUndo,
    colors,
    chinaBoundaryData,
    chinaBoundarySettings,
    acquireChinaBoundaries,
  };
});
