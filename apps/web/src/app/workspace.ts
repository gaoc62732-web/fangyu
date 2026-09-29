import { reactive, watch } from 'vue';
import { defineStore } from 'pinia';
import type { MapLevel, Scope } from '@fangyu/contracts';
export type Bounds = [number, number, number, number];
export interface CatalogQuery {
  scope: Scope;
  regionId: string;
  descendants: boolean;
  categories: string[];
  text: string;
  status: '' | 'visited' | 'unvisited' | 'partial';
  missingCoordinates: boolean;
  railType: string;
  bounds: Bounds | null;
  retainedIds: string[];
}
export interface MapViewState {
  preset: 'explore' | 'footprints';
  level: MapLevel;
  colorCategory: string;
  showPoints: boolean;
  camera: { center: [number, number]; zoom: number } | null;
}
export interface ScopeWorkspace {
  selectedRegion: string;
  mode: 'region' | 'theme';
  restrictTheme: boolean;
  view: 'map' | 'list';
  categories: string[];
  query: string;
  status: CatalogQuery['status'];
  descendants: boolean;
  missingCoordinates: boolean;
  railType: string;
  bounds: Bounds | null;
  detail: string;
  detailRegion: string;
  collapsed: boolean;
  scroll: number;
  expanded: Record<string, boolean>;
  map: MapViewState;
}
export const SCOPE_NAMES: Record<Scope, string> = {
  china: '中国',
  world: '世界',
  japan: '日本',
  korea: '韩国',
};
const scopes: Scope[] = ['china', 'world', 'japan', 'korea'];
export function initialWorkspace(scope: Scope): ScopeWorkspace {
  return {
    selectedRegion: '',
    mode: 'region',
    restrictTheme: false,
    view: 'map',
    categories: [],
    query: '',
    status: '',
    descendants: true,
    missingCoordinates: false,
    railType: '',
    bounds: null,
    detail: '',
    detailRegion: '',
    collapsed: false,
    scroll: 0,
    expanded: {},
    map: {
      preset: 'explore',
      level: scope === 'china' ? 'province' : scope === 'world' ? 'country' : 'province',
      colorCategory: '',
      showPoints: true,
      camera: null,
    },
  };
}
export const useWorkspace = defineStore('workspace', () => {
  const state = reactive({
    scope: 'china' as Scope,
    scopes: Object.fromEntries(scopes.map((s) => [s, initialWorkspace(s)])) as Record<
      Scope,
      ScopeWorkspace
    >,
  });
  try {
    const saved = JSON.parse(localStorage.getItem('fangyu-workspace-v1') || 'null');
    if (saved && scopes.includes(saved.scope)) {
      state.scope = saved.scope;
      for (const scope of scopes) {
        const value = saved.scopes?.[scope];
        if (!value || !Array.isArray(value.categories)) continue;
        const fresh = initialWorkspace(scope);
        for (const key of ['selectedRegion', 'query', 'railType'] as const)
          if (typeof value[key] === 'string') fresh[key] = value[key];
        for (const key of [
          'restrictTheme',
          'descendants',
          'missingCoordinates',
          'collapsed',
        ] as const)
          if (typeof value[key] === 'boolean') fresh[key] = value[key];
        if (value.mode === 'theme') fresh.mode = 'theme';
        if (value.view === 'list') fresh.view = 'list';
        if (['', 'visited', 'unvisited', 'partial'].includes(value.status))
          fresh.status = value.status;
        fresh.categories = value.categories.filter((id: unknown) => typeof id === 'string');
        if (Number.isFinite(value.scroll) && value.scroll >= 0) fresh.scroll = value.scroll;
        if (value.expanded && typeof value.expanded === 'object')
          fresh.expanded = Object.fromEntries(
            Object.entries(value.expanded).filter(([, v]) => typeof v === 'boolean'),
          ) as Record<string, boolean>;
        const map = value.map;
        if (map && typeof map === 'object') {
          if (map.preset === 'footprints') fresh.map.preset = 'footprints';
          if (
            (scope === 'china'
              ? ['province', 'city', 'county']
              : scope === 'world'
                ? ['country']
                : ['province']
            ).includes(map.level)
          )
            fresh.map.level = map.level;
          if (typeof map.colorCategory === 'string') fresh.map.colorCategory = map.colorCategory;
          if (typeof map.showPoints === 'boolean') fresh.map.showPoints = map.showPoints;
          const camera = map.camera;
          if (
            Array.isArray(camera?.center) &&
            camera.center.length === 2 &&
            camera.center.every(Number.isFinite) &&
            Math.abs(camera.center[1]) <= 85 &&
            Number.isFinite(camera.zoom) &&
            camera.zoom >= 0 &&
            camera.zoom <= 22
          )
            fresh.map.camera = camera;
        }
        state.scopes[scope] = fresh;
      }
    }
  } catch {
    /* Optional view preferences must never prevent record access. */
  }
  let timer: ReturnType<typeof setTimeout>;
  watch(
    state,
    () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          localStorage.setItem('fangyu-workspace-v1', JSON.stringify(state));
        } catch {
          /* Storage may be unavailable. */
        }
      }, 200);
    },
    { deep: true },
  );
  return { state };
});
