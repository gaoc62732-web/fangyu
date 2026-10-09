<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { useAppStore } from '../app/store.js';
import PointIcon from './PointIcon.vue';
const store = useAppStore();
const route = useRoute();
const more = ref<HTMLDetailsElement>();
const regionDestination = computed(() => {
  const previous = store.regionalMap;
  return {
    path: '/regions/' + (previous?.scope || 'china'),
    query: previous?.selected ? { region: previous.selected } : {},
  };
});
const links = computed(() => [
  { to: regionDestination.value, label: '区域点卯', active: route.path.startsWith('/regions') },
  { to: '/points', label: '点位点卯', active: route.path === '/points' },
  { to: '/achievements', label: '成就', active: route.path === '/achievements' },
  { to: '/imports', label: '导入导出', active: route.path === '/imports' },
]);
const extra = [
  ['/records', '记录'],
  ['/maofen', '卯分'],
  ['/help', '使用说明'],
] as const;
function close() {
  if (more.value) more.value.open = false;
}
function outside(event: PointerEvent) {
  if (event.target instanceof Node && !more.value?.contains(event.target)) close();
}
function keydown(event: KeyboardEvent) {
  const menu = more.value;
  if (!menu) return;
  if (event.key === 'Escape') {
    close();
    menu.querySelector('summary')?.focus();
    event.preventDefault();
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  menu.open = true;
  const items = [...menu.querySelectorAll<HTMLElement>('a, .module-theme')];
  const current = items.indexOf(document.activeElement as HTMLElement);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : event.key === 'ArrowDown'
          ? (current + 1) % items.length
          : (current - 1 + items.length) % items.length;
  items[next]?.focus();
}
onMounted(() => document.addEventListener('pointerdown', outside));
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside));
watch(() => route.fullPath, close);
</script>
<template>
  <header class="module-header">
    <RouterLink
      class="module-brand"
      :to="regionDestination"
      aria-label="方舆首页"
      ><PointIcon
        name="compass"
        :size="26"
      /><span>方舆</span></RouterLink
    >
    <nav
      class="module-navigation"
      aria-label="主导航"
    >
      <RouterLink
        v-for="link in links"
        :key="link.label"
        :to="link.to"
        :class="{ current: link.active }"
        :aria-current="link.active ? 'page' : undefined"
        >{{ link.label }}</RouterLink
      >
    </nav>
    <details
      ref="more"
      class="module-more"
      @keydown="keydown"
      @focusout="!more?.contains($event.relatedTarget as Node) && close()"
    >
      <summary :class="{ current: extra.some(([path]) => route.path === path) }">
        更多<PointIcon
          name="chevron"
          :size="14"
        />
      </summary>
      <div class="module-more-menu">
        <RouterLink
          v-for="[path, label] in extra"
          :key="path"
          :to="path"
          @click="close"
          >{{ label }}</RouterLink
        >
        <button
          class="module-theme"
          @click="store.setDark(!store.dark)"
        >
          {{ store.dark ? '切换日间模式' : '切换夜间模式' }}
        </button>
      </div>
    </details>
    <RouterLink
      class="module-settings-link"
      to="/settings"
      aria-label="设置"
      title="设置"
    >
      <PointIcon name="settings" />
    </RouterLink>
  </header>
</template>
<style scoped>
.module-header {
  height: 56px;
  display: flex;
  align-items: center;
  gap: 34px;
  padding: 0 32px;
  border-bottom: 1px solid var(--atlas-line);
  background: var(--atlas-paper);
  position: sticky;
  top: 0;
  z-index: 20;
  flex: none;
}
.module-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
  color: var(--atlas-ink);
  text-decoration: none;
  font-size: 22px;
  font-weight: 300;
  letter-spacing: 0.12em;
}
.module-brand svg {
  color: #737e67;
}
.module-navigation {
  display: flex;
  flex: 1;
  gap: 28px;
  flex-wrap: nowrap;
  min-width: 0;
  height: 100%;
  overflow-x: auto;
  scrollbar-width: none;
}
.module-navigation::-webkit-scrollbar {
  display: none;
}
.module-navigation a {
  display: flex;
  align-items: center;
  flex: none;
  position: relative;
  padding: 0 2px;
  border-radius: 0;
  color: var(--atlas-ink);
  background: transparent;
  font-size: 16px;
  font-weight: 300;
  white-space: nowrap;
  text-decoration: none;
}
.module-navigation a.current::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 2px;
  right: 2px;
  height: 2px;
  background: var(--atlas-accent);
}
.module-navigation a:hover {
  color: var(--atlas-accent);
}
.module-more {
  position: relative;
  flex: none;
  font-size: 16px;
}
.module-settings-link {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  color: var(--atlas-ink);
}
.module-settings-link:hover,
.module-settings-link.router-link-active {
  background: var(--atlas-soft);
}
.module-more summary {
  display: flex;
  align-items: center;
  gap: 7px;
  list-style: none;
  cursor: pointer;
  padding: 8px;
  border-radius: 10px;
  font-weight: 300;
}
.module-more summary::-webkit-details-marker {
  display: none;
}
.module-more[open] summary,
.module-more summary:hover,
.module-more summary.current {
  background: var(--atlas-soft);
}
.module-more-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 12px);
  min-width: 184px;
  padding: 8px;
  display: grid;
  border: 1px solid var(--atlas-line);
  border-radius: 12px;
  background: var(--atlas-paper);
}
.module-more-menu a,
.module-theme {
  padding: 10px 12px;
  background: transparent;
  border: 0;
  border-radius: 8px;
  color: var(--atlas-ink);
  text-decoration: none;
  text-align: left;
  font-weight: 300;
  white-space: nowrap;
}
.module-more-menu a:hover,
.module-theme:hover {
  background: var(--atlas-soft);
}
.module-theme {
  border-top: 1px solid var(--atlas-line);
  border-radius: 0;
  margin-top: 6px;
  padding-top: 14px;
  font-size: 14px;
}
@media (max-width: 760px) {
  .module-header {
    padding: 0 16px;
    gap: 16px;
  }
  .module-brand {
    font-size: 19px;
    gap: 7px;
  }
  .module-brand svg {
    width: 22px;
  }
  .module-navigation {
    gap: 20px;
  }
  .module-more summary {
    padding: 7px 2px;
  }
  .module-more-menu {
    right: 0;
  }
}
@media (max-width: 520px) {
  .module-header {
    gap: 12px;
  }
  .module-navigation {
    gap: 8px;
  }
  .module-navigation a {
    font-size: 14px;
  }
  .module-more summary {
    font-size: 14px;
  }
  .module-brand span {
    display: none;
  }
}
</style>
