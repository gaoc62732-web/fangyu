<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  provide,
  shallowReactive,
  watch,
  watchEffect,
} from 'vue';
import { RouterView, useRoute } from 'vue-router';
import { isScope, type MapLevel, type Scope } from '@fangyu/contracts';
import { appMode } from './app/mode.js';
import { router } from './app/router.js';
import { useAppStore } from './app/store.js';
import { exportJson } from './features/exports/download.js';
import { sharedMapKey, type SharedMapContext } from './features/maps/shared-map.js';
import LoginPanel from './components/LoginPanel.vue';
import AppHeader from './components/AppHeader.vue';
import MapSurface from './components/MapSurface.vue';
import PointIcon from './components/PointIcon.vue';
const store = useAppStore();
const route = useRoute();
const mode = appMode();
const adminRoute = computed(() => route.path.startsWith('/admin/'));
const mapModule = computed(() => route.path === '/points' || route.path.startsWith('/regions'));
const initialScope = isScope(String(route.params.scope)) ? (route.params.scope as Scope) : 'china';
const initialLevel = (store.regionalMap?.level ||
  store.session?.preferences.mapLevel ||
  'county') as MapLevel;
const sharedMap: SharedMapContext = {
  provided: true,
  view: shallowReactive({
    mode: route.path === '/points' ? 'points' : 'regions',
    scope: route.path === '/points' ? store.regionalMap?.scope || 'china' : initialScope,
    selected: route.path === '/points' ? store.regionalMap?.selected || '' : store.selectedRegionId,
    level: initialLevel,
    category: store.category,
    points: [],
    focus: null,
    initialCamera: store.regionalMap?.camera,
    previewRegions: [],
    rightInset: '0px',
    onSelect: () => {},
    onPoint: () => {},
    onLevel: () => {},
    onOverview: () => {},
    onCluster: () => {},
  }),
};
provide(sharedMapKey, sharedMap);
const mapProps = computed(() => {
  const view = sharedMap.view;
  return {
    scope: view.scope,
    selected: view.selected,
    level: view.level,
    category: view.category,
    points: view.points,
    focus: view.focus,
    pointMode: view.mode === 'points',
    regionMode: view.mode === 'regions',
    initialCamera: view.initialCamera,
    previewRegions: view.previewRegions,
  };
});
const sharedMapStyle = computed(() => ({ right: sharedMap.view.rightInset }));
function selectRegion(id: string) {
  sharedMap.view.onSelect(id);
}
function selectPoint(id: string) {
  sharedMap.view.onPoint(id);
}
function changeMapLevel(level: Exclude<MapLevel, 'country'>) {
  sharedMap.view.onLevel(level);
}
function openCluster(ids: string[]) {
  sharedMap.view.onCluster(ids);
}
function overviewMap() {
  sharedMap.view.onOverview();
}
let catalogRefreshTimer: number | undefined;
function refreshAfterLocalCatalogUpdate() {
  if (!adminRoute.value) void store.refreshCatalog();
}
onMounted(() => {
  void router.isReady().then(() => {
    if (!adminRoute.value) void store.load();
  });
  window.addEventListener('storage', refreshAfterLocalCatalogUpdate);
  window.addEventListener('fangyu-local-catalog-updated', refreshAfterLocalCatalogUpdate);
  catalogRefreshTimer = window.setInterval(() => {
    if (!adminRoute.value && typeof store.refreshCatalog === 'function')
      void store.refreshCatalog();
  }, 2500);
});
onBeforeUnmount(() => {
  window.clearInterval(catalogRefreshTimer);
  window.removeEventListener('storage', refreshAfterLocalCatalogUpdate);
  window.removeEventListener('fangyu-local-catalog-updated', refreshAfterLocalCatalogUpdate);
});
watch(adminRoute, (isAdmin, wasAdmin) => {
  if (wasAdmin && !isAdmin) void store.load();
});
watchEffect(() => {
  document.documentElement.dataset.theme = store.dark ? 'dark' : 'light';
});
</script>
<template>
  <div
    class="atlas-app"
    :class="{ 'atlas-map-module': mapModule }"
  >
    <AppHeader v-if="!adminRoute" />
    <main
      v-if="adminRoute"
      class="atlas-admin-content"
    >
      <RouterView />
    </main>
    <main
      v-else
      class="atlas-content"
      :class="{ 'atlas-map-content': mapModule }"
    >
      <div
        v-if="mapModule && store.session"
        class="atlas-shared-map"
        :style="sharedMapStyle"
      >
        <MapSurface
          v-bind="mapProps"
          @select="selectRegion"
          @point="selectPoint"
          @level="changeMapLevel"
          @cluster="openCluster"
          @overview="overviewMap"
        />
      </div>
      <p
        v-if="store.loading"
        role="status"
        class="loading"
      >
        正在载入目录数据…
      </p>
      <section
        v-else-if="store.loadError"
        class="error-panel"
      >
        <p>{{ store.loadError }}</p>
        <LoginPanel
          v-if="mode === 'server'"
          @authenticated="store.load()"
        />
        <button @click="store.load()">重新载入</button>
      </section>
      <template v-else-if="store.session">
        <div
          v-if="store.error"
          class="error-panel atlas-save-error"
          role="alert"
        >
          <p>{{ store.error }}</p>
          <button @click="exportJson(store.session.snapshot())">导出当前记录</button
          ><button @click="store.error = ''">收起提示</button>
        </div>
        <RouterView v-slot="{ Component }"
          ><KeepAlive include="AchievementsPage"><component :is="Component" /></KeepAlive
        ></RouterView>
      </template>
    </main>
    <footer
      v-if="!mapModule && !adminRoute"
      class="atlas-statusbar"
    >
      <span role="status">{{ store.saveStatus }}</span
      ><button
        :disabled="!store.canUndo"
        @click="store.undo()"
      >
        <PointIcon
          name="undo"
          :size="15"
        />撤销
      </button>
    </footer>
  </div>
</template>
