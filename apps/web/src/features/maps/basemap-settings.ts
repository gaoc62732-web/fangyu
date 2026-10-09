import { computed, ref } from 'vue';
import { tianditu, type BasemapKind } from './types.js';
import { libertyBasemap } from './liberty-basemap.js';

const storageKey = 'fangyu-basemap-v1';
type Choice = { enabled: boolean; kind: BasemapKind };
type StorageName = 'sessionStorage' | 'localStorage';

function read(storageName: StorageName): Choice | undefined {
  try {
    const value = JSON.parse(window[storageName].getItem(storageKey) || 'null');
    if (!value) return;
    return {
      enabled: value.enabled !== false,
      kind: value.kind === 'satellite' ? 'satellite' : 'vector',
    };
  } catch {
    return;
  }
}

function write(storageName: StorageName, value: Choice) {
  try {
    window[storageName].setItem(storageKey, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const sessionChoice = read('sessionStorage');
const localChoice = read('localStorage');
const choice = ref<Choice>(sessionChoice || localChoice || { enabled: true, kind: 'vector' });
const configuredProvider = computed(() =>
  choice.value.kind === 'vector'
    ? libertyBasemap()
    : tianditu(import.meta.env.VITE_TIANDITU_KEY || '', choice.value.kind),
);

export const basemapProvider = computed(() =>
  choice.value.enabled ? configuredProvider.value : null,
);
export const basemapMode = computed(() => (choice.value.enabled ? 'environment' : 'disabled'));
export const basemapKind = computed(() => choice.value.kind);
export const basemapCanEnable = computed(() => Boolean(configuredProvider.value));
export const basemapEnabled = computed(() => Boolean(basemapProvider.value));

function save(next: Choice) {
  const stored = write('localStorage', next) && write('sessionStorage', next);
  choice.value = next;
  return stored;
}

export function setBasemapEnabled(enabled: boolean) {
  if (enabled && !configuredProvider.value) return false;
  return save({ ...choice.value, enabled });
}

export function setBasemapKind(kind: BasemapKind) {
  return save({ ...choice.value, kind });
}
