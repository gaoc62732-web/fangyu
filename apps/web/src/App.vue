<script setup lang="ts">
import { onMounted, onUnmounted, watchEffect } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { appMode } from './app/mode.js';
import { useAppStore } from './app/store.js';
import { exportJson } from './features/exports/download.js';
import LoginPanel from './components/LoginPanel.vue';
const store = useAppStore();
const route = useRoute();
const mode = appMode();
watchEffect(() => {
  document.documentElement.dataset.theme = store.dark ? 'dark' : 'light';
});
function keydown(e: KeyboardEvent) {
  const target = e.target as HTMLElement;
  if (
    (e.ctrlKey || e.metaKey) &&
    e.key.toLowerCase() === 'z' &&
    !e.shiftKey &&
    !target.closest('input,textarea,[contenteditable="true"]') &&
    store.canUndo
  ) {
    e.preventDefault();
    store.undo();
  }
}
onMounted(() => window.addEventListener('keydown', keydown));
onUnmounted(() => window.removeEventListener('keydown', keydown));
</script>
<template>
  <header class="site-header">
    <RouterLink
      class="brand"
      to="/map"
      ><span class="logo">方</span
      ><span><strong>方舆</strong><small>旅行有迹 · 山河入册</small></span></RouterLink
    >
    <nav
      class="primary-nav"
      aria-label="主导航"
    >
      <RouterLink to="/map">地图</RouterLink><RouterLink to="/achievements">成就</RouterLink
      ><RouterLink to="/manage">记录管理</RouterLink>
    </nav>
    <div class="header-actions">
      <span
        class="save-state"
        role="status"
        >{{ store.saveStatus || '正在准备手册' }}</span
      ><button
        :disabled="!store.canUndo"
        @click="store.undo()"
        title="撤销 Ctrl / ⌘ Z"
      >
        ↶ 撤销</button
      ><RouterLink
        to="/settings"
        aria-label="外观设置"
        >外观</RouterLink
      ><RouterLink
        to="/help"
        aria-label="使用帮助"
        >帮助</RouterLink
      >
    </div>
  </header>
  <main
    class="page-shell"
    :class="{ 'map-shell': route.path === '/map' }"
  >
    <div
      v-if="store.error"
      class="error-panel global-error"
      role="alert"
    >
      <span>{{ store.error }}</span
      ><button
        v-if="store.session"
        @click="store.retrySave().catch(() => {})"
      >
        重试保存</button
      ><button
        v-if="store.session"
        @click="exportJson(store.session.snapshot())"
      >
        导出当前记录</button
      ><button @click="store.error = ''">收起</button>
    </div>
    <section
      v-if="store.loading"
      class="loading"
    >
      <span class="loading-mark">方</span>
      <h2>正在打开旅行手册</h2>
      <p>准备地区目录与记录校验，完成后即可记录到访。</p>
      <p v-if="store.bootstrap">
        已准备 {{ store.bootstrap.regions.length.toLocaleString() }} 个地区、{{
          store.bootstrap.categories.length
        }}
        个类别；正在载入完整目录。
      </p>
    </section>
    <section
      v-else-if="store.loadError"
      class="error-panel"
    >
      <h2>手册暂时无法载入</h2>
      <p>{{ store.loadError }}</p>
      <LoginPanel
        v-if="mode === 'server'"
        @authenticated="store.load()"
      /><button @click="store.load()">重新载入</button>
    </section>
    <RouterView
      v-else-if="store.session"
      v-slot="{ Component }"
      ><KeepAlive :include="['CatalogPage', 'AchievementsPage', 'ManagePage']"
        ><component :is="Component" /></KeepAlive
    ></RouterView>
  </main>
  <div
    v-if="store.notice"
    class="record-feedback"
    role="status"
  >
    <span>{{ store.notice }}</span
    ><button
      :disabled="!store.canUndo"
      @click="store.undo()"
    >
      撤销</button
    ><button
      aria-label="关闭记录提示"
      @click="store.notice = ''"
    >
      ×
    </button>
  </div>
</template>
