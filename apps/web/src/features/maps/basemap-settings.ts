import { computed, ref } from 'vue';
import { tianditu, type BasemapKind } from './types.js';

// Deliberately separate from records, Pinia snapshots, archives and exports.
const storageKey = 'fangyu-private-basemap-v1';
type Choice = {
  mode: 'disabled' | 'custom' | 'environment';
  enabled: boolean;
  kind: BasemapKind;
  key?: string;
};
type StorageName = 'sessionStorage' | 'localStorage';
function read(storageName: StorageName): Choice | undefined {
  try {
    const storage = window[storageName];
    const value = JSON.parse(storage.getItem(storageKey) || 'null');
    if (!value) return;
    const kind = value.kind === 'satellite' ? 'satellite' : 'vector';
    if (value.mode === 'disabled') return { mode: 'disabled', enabled: false, kind };
    if (value.mode === 'environment')
      return { mode: 'environment', enabled: value.enabled !== false, kind };
    if (value.mode === 'custom' && typeof value.key === 'string' && tianditu(value.key))
      return { mode: 'custom', enabled: value.enabled !== false, kind, key: value.key };
    // Invalid stored settings must not silently reactivate a build-time key.
    return { mode: 'disabled', enabled: false, kind };
  } catch {
    /* Never include storage content in errors. */
  }
}
function write(storageName: StorageName, value?: Choice) {
  try {
    const storage = window[storageName];
    if (value) storage.setItem(storageKey, JSON.stringify(value));
    else storage.removeItem(storageKey);
    return true;
  } catch {
    return false;
  }
}
const sessionChoice = read('sessionStorage');
const localChoice = read('localStorage');
let remembered = !sessionChoice && Boolean(localChoice);
const choice = ref<Choice>(
  sessionChoice ||
    localChoice || {
      mode: 'environment',
      enabled: true,
      kind: 'vector',
    },
);
const configuredProvider = computed(() =>
  tianditu(
    choice.value.mode === 'custom'
      ? choice.value.key || ''
      : choice.value.mode === 'environment'
        ? import.meta.env.VITE_TIANDITU_KEY || ''
        : '',
    choice.value.kind,
  ),
);
export const basemapProvider = computed(() =>
  choice.value.enabled ? configuredProvider.value : null,
);
export const basemapMode = computed(() => (choice.value.enabled ? choice.value.mode : 'disabled'));
export const basemapKind = computed(() => choice.value.kind);
export const basemapCanEnable = computed(() => Boolean(configuredProvider.value));
export const basemapEnabled = computed(() => Boolean(basemapProvider.value));
function save(next: Choice, remember = remembered) {
  const removed = write(remember ? 'sessionStorage' : 'localStorage');
  const stored = write(remember ? 'localStorage' : 'sessionStorage', next);
  remembered = remember;
  choice.value = next;
  return removed && stored;
}
export function applyBasemapKey(key: string, remember: boolean): boolean {
  const next: Choice = { mode: 'custom', enabled: true, kind: choice.value.kind, key: key.trim() };
  if (!tianditu(next.key!)) return false;
  return save(next, remember);
}
export function setBasemapEnabled(enabled: boolean): boolean {
  if (enabled && !configuredProvider.value) return false;
  return save({ ...choice.value, enabled });
}
export function setBasemapKind(kind: BasemapKind): boolean {
  return save({ ...choice.value, kind });
}
export function disableBasemap() {
  // A temporary toggle retains the configured key, unlike explicit clearing.
  return setBasemapEnabled(false);
}
export function clearBasemapKey() {
  const next: Choice = { mode: 'disabled', enabled: false, kind: choice.value.kind };
  // Persist only this keyless marker so clearing never silently revives a build key.
  const local = write('localStorage', next),
    session = write('sessionStorage', next);
  remembered = false;
  choice.value = next;
  return local && session;
}
export function useEnvironmentBasemap() {
  return save({ mode: 'environment', enabled: true, kind: choice.value.kind }, false);
}
export async function testBasemapKey(key: string, kind = choice.value.kind): Promise<boolean> {
  const provider = tianditu(key.trim(), kind);
  if (!provider) return false;
  try {
    // Check both imagery and its matching annotation layer without logging URLs.
    const signal = AbortSignal.timeout(6000);
    const checks = await Promise.all(
      [...provider.tiles, ...provider.labels].map(async (template) => {
        const url = template.replace('{z}', '2').replace('{x}', '3').replace('{y}', '1');
        const response = await fetch(url, { signal, cache: 'no-store' });
        if (!response.ok || !response.headers.get('content-type')?.startsWith('image/'))
          return false;
        const image = await createImageBitmap(await response.blob());
        const valid = image.width > 0 && image.height > 0;
        image.close();
        return valid;
      }),
    );
    return checks.every(Boolean);
  } catch {
    return false;
  }
}
