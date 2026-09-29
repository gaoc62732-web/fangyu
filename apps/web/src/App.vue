<script setup lang="ts">
import { ref, watchEffect } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { appMode } from './app/mode.js';
import { useAppStore } from './app/store.js';
import { exportJson } from './features/exports/download.js';
import LoginPanel from './components/LoginPanel.vue';
import { version } from '../package.json';

const store = useAppStore();
const route = useRoute();
const countryMenu = ref<HTMLDetailsElement>();
const utilityMenu = ref<HTMLDetailsElement>();
const mode = appMode();
const navigation: [string, string][] = [
  ['/china', '中国'],
  ['/world', '世界'],
  ['/maofen', '点卯计算器'],
  ['/records', '要素列表'],
  ['/achievements', '旅行成就'],
];
function closeCountryMenu() {
  if (countryMenu.value) countryMenu.value.open = false;
}
function closeUtilityMenu() {
  if (utilityMenu.value) utilityMenu.value.open = false;
}
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
    <nav aria-label="主导航">
      <RouterLink
        v-for="[path, label] in navigation.slice(0, 2)"
        :key="path"
        :to="path!"
        >{{ label }}</RouterLink
      >
      <details
        ref="countryMenu"
        class="nav-dropdown"
        @mouseleave="closeCountryMenu"
      >
        <summary :class="{ active: route.path === '/japan' || route.path === '/korea' }">
          其他国家
        </summary>
        <div class="nav-dropdown-options">
          <RouterLink
            to="/japan"
            @click="closeCountryMenu"
            >日本专题</RouterLink
          >
          <RouterLink
            to="/korea"
            @click="closeCountryMenu"
            >韩国专题</RouterLink
          >
        </div>
      </details>
      <RouterLink
        v-for="[path, label] in navigation.slice(2)"
        :key="path"
        :to="path!"
        >{{ label }}</RouterLink
      >
      <details
        ref="utilityMenu"
        class="nav-dropdown"
      >
        <summary :class="{ active: ['/imports', '/settings', '/help'].includes(route.path) }">
          工具
        </summary>
        <div class="nav-dropdown-options">
          <RouterLink
            to="/imports"
            @click="closeUtilityMenu"
            >导入导出</RouterLink
          >
          <RouterLink
            to="/settings"
            @click="closeUtilityMenu"
            >存档与外观</RouterLink
          >
          <RouterLink
            to="/help"
            @click="closeUtilityMenu"
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
      <RouterView />
    </template>
  </main>
  <footer class="site-footer">
    <span role="status">{{ store.saveStatus }}</span>
    <button
      :disabled="!store.canUndo"
      @click="store.undo()"
    >
      撤销
    </button>
  </footer>
</template>
