<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { getScopeConfig, MALAY_REGION_TOPIC, SCOPE_NAV_GROUPS } from '@fangyu/contracts';
import { appMode } from './app/mode.js';
import { useAppStore } from './app/store.js';
import { exportJson } from './features/exports/download.js';
import LoginPanel from './components/LoginPanel.vue';
import { version } from '../package.json';
declare const __FANGYU_BUILD__: { version: string; id: string; commit: string; dirty: boolean };
const build = __FANGYU_BUILD__;

const store = useAppStore();
const route = useRoute();
const navigationElement = ref<HTMLElement>();
const mode = appMode();
const topicGroups = SCOPE_NAV_GROUPS.map((group) => ({
  ...group,
  topics: group.topicIds.map((id) =>
    id === MALAY_REGION_TOPIC.id ? MALAY_REGION_TOPIC : getScopeConfig(id),
  ),
}));
const navigation: [string, string][] = [
  ['/maofen', '点卯计算器'],
  ['/records', '要素列表'],
  ['/achievements', '旅行成就'],
];
function isTopicActive(id: string) {
  return (
    route.path === '/' + id ||
    (id === MALAY_REGION_TOPIC.id &&
      MALAY_REGION_TOPIC.scopeIds.some((scope) => route.path === '/' + scope))
  );
}
function closeMenus(except?: HTMLDetailsElement) {
  navigationElement.value?.querySelectorAll<HTMLDetailsElement>('details[open]').forEach((menu) => {
    if (menu !== except) menu.open = false;
  });
}
function onMenuToggle(event: Event) {
  const menu = event.currentTarget as HTMLDetailsElement;
  if (menu.open) closeMenus(menu);
}
function onMenuFocusOut(event: FocusEvent) {
  const menu = event.currentTarget as HTMLDetailsElement;
  if (!(event.relatedTarget instanceof Node) || !menu.contains(event.relatedTarget)) {
    menu.open = false;
  }
}
async function onMenuKeydown(event: KeyboardEvent) {
  const menu = event.currentTarget as HTMLDetailsElement;
  if (event.key === 'Escape') {
    if (menu.open) {
      event.preventDefault();
      menu.open = false;
      menu.querySelector('summary')?.focus();
    }
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const onSummary = event.target === menu.querySelector('summary');
  if (onSummary && ['Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  menu.open = true;
  closeMenus(menu);
  await nextTick();
  const links = Array.from(menu.querySelectorAll<HTMLAnchorElement>('a'));
  if (!links.length) return;
  const current = links.indexOf(document.activeElement as HTMLAnchorElement);
  const index =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? links.length - 1
        : event.key === 'ArrowDown'
          ? (current + 1) % links.length
          : current < 0
            ? links.length - 1
            : (current - 1 + links.length) % links.length;
  links[index]?.focus();
}
function onOutsidePointer(event: PointerEvent) {
  if (event.target instanceof Node && !navigationElement.value?.contains(event.target))
    closeMenus();
}
onMounted(() => document.addEventListener('pointerdown', onOutsidePointer));
onUnmounted(() => document.removeEventListener('pointerdown', onOutsidePointer));
watch(
  () => route.fullPath,
  () => closeMenus(),
);
watchEffect(() => {
  document.documentElement.dataset.theme = store.dark ? 'dark' : 'light';
});
</script>

<template>
  <header class="site-header">
    <div class="brand">
      <span class="logo">方</span>
      <div>
        <h1>
          方舆 · 旅游手册地图 <span class="app-version">v{{ version }}</span>
        </h1>
        <small>{{ mode === 'demo' ? '记录保存在此浏览器' : '记录通过服务端保存' }}</small>
      </div>
    </div>
    <nav
      ref="navigationElement"
      aria-label="主导航"
    >
      <RouterLink to="/world">世界</RouterLink>
      <details
        v-for="group in topicGroups"
        :key="group.id"
        class="nav-dropdown topic-menu"
        @toggle="onMenuToggle"
        @focusout="onMenuFocusOut"
        @keydown="onMenuKeydown"
      >
        <summary :class="{ active: group.topics.some((topic) => isTopicActive(topic.id)) }">
          {{ group.name }}
        </summary>
        <div
          class="nav-dropdown-options"
          :aria-label="group.name + '国家专题'"
        >
          <RouterLink
            v-for="topic in group.topics"
            :key="topic.id"
            :to="'/' + topic.id"
            :class="{
              'topic-contains-current':
                topic.id === MALAY_REGION_TOPIC.id && isTopicActive(topic.id),
            }"
            @click="closeMenus()"
            >{{ topic.title }}</RouterLink
          >
        </div>
      </details>
      <RouterLink
        v-for="[path, label] in navigation"
        :key="path"
        :to="path!"
        >{{ label }}</RouterLink
      >
      <details
        class="nav-dropdown"
        @toggle="onMenuToggle"
        @focusout="onMenuFocusOut"
        @keydown="onMenuKeydown"
      >
        <summary :class="{ active: ['/imports', '/settings', '/help'].includes(route.path) }">
          工具
        </summary>
        <div class="nav-dropdown-options">
          <RouterLink
            to="/imports"
            @click="closeMenus()"
            >导入导出</RouterLink
          >
          <RouterLink
            to="/settings"
            @click="closeMenus()"
            >存档与外观</RouterLink
          >
          <RouterLink
            to="/help"
            @click="closeMenus()"
            >使用说明</RouterLink
          >
        </div>
      </details>
    </nav>
    <button
      type="button"
      class="theme-toggle"
      :aria-label="store.dark ? '切换到日间模式' : '切换到夜间模式'"
      :title="store.dark ? '切换到日间模式' : '切换到夜间模式'"
      @click="store.setDark(!store.dark)"
    >
      <span
        class="theme-icon"
        aria-hidden="true"
        >{{ store.dark ? '☀' : '☾' }}</span
      >
      <span>{{ store.dark ? '日间' : '夜间' }}</span>
    </button>
  </header>
  <main class="page-shell">
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
        class="error-panel"
        role="alert"
      >
        <p>{{ store.error }}</p>
        <button @click="exportJson(store.session.snapshot())">导出当前记录</button>
        <button @click="store.error = ''">收起提示</button>
      </div>
      <RouterView v-slot="{ Component }">
        <KeepAlive include="AchievementsPage">
          <component :is="Component" />
        </KeepAlive>
      </RouterView>
    </template>
  </main>
  <footer class="site-footer">
    <span class="build-identity"
      >{{ build.version.includes('-dev') ? '开发预览' : '版本 ' + build.version }} {{ build.id }} ·
      {{ build.commit }}{{ build.dirty ? ' + 未提交修改' : '' }}</span
    >
    <span role="status">{{ store.saveStatus }}</span>
    <button
      :disabled="!store.canUndo"
      @click="store.undo()"
    >
      撤销
    </button>
  </footer>
</template>

<style scoped>
.site-header nav {
  min-width: 0;
}
.nav-dropdown summary:focus-visible,
.nav-dropdown-options a:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
.topic-menu .nav-dropdown-options {
  width: max-content;
  max-width: min(25rem, calc(100vw - 32px));
  max-height: min(28rem, 65dvh);
  overflow-y: auto;
}
.topic-menu .nav-dropdown-options a {
  white-space: normal;
  overflow-wrap: anywhere;
}
.topic-contains-current {
  font-weight: 700;
  box-shadow: inset 3px 0 currentColor;
}
@media (max-width: 760px) {
  .site-header nav {
    position: relative;
    width: 100%;
  }
  .nav-dropdown {
    position: static;
  }
  .nav-dropdown-options {
    left: 0;
    right: 0;
    width: auto;
    max-width: 100%;
    max-height: 55dvh;
    overflow-y: auto;
  }
  .topic-menu .nav-dropdown-options {
    width: auto;
    max-width: 100%;
  }
}
</style>
