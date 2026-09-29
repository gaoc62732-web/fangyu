<script setup lang="ts">
import { watchEffect } from 'vue';
import { RouterLink, RouterView } from 'vue-router';
import { appMode } from './app/mode.js';
import { useAppStore } from './app/store.js';
import { exportJson } from './features/exports/download.js';
import LoginPanel from './components/LoginPanel.vue';

const store = useAppStore();
const mode = appMode();
const navigation: [string, string][] = [
  ['/china', '中国'],
  ['/world', '世界'],
  ['/japan', '日本'],
  ['/korea', '韩国'],
  ['/records', '要素列表'],
  ['/achievements', '旅行成就'],
  ['/imports', '导入导出'],
  ['/settings', '存档与外观'],
  ['/help', '使用说明'],
];
watchEffect(() => {
  document.documentElement.dataset.theme = store.dark ? 'dark' : 'light';
});
</script>

<template>
  <header class="site-header">
    <div class="brand">
      <span class="logo">方</span>
      <div>
        <h1>方舆 · 旅游手册地图</h1>
        <small>{{ mode === 'demo' ? '记录保存在此浏览器' : '记录通过服务端保存' }}</small>
      </div>
    </div>
    <nav aria-label="主导航">
      <RouterLink
        v-for="[path, label] in navigation"
        :key="path"
        :to="path!"
        >{{ label }}</RouterLink
      >
    </nav>
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
    <button @click="store.setDark(!store.dark)">{{ store.dark ? '浅色界面' : '深色界面' }}</button>
    <button
      :disabled="!store.canUndo"
      @click="store.undo()"
    >
      撤销
    </button>
  </footer>
</template>
