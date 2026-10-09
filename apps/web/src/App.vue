<script setup lang="ts">
import { computed, watchEffect } from 'vue';
import { RouterView, useRoute } from 'vue-router';
import { appMode } from './app/mode.js';
import { useAppStore } from './app/store.js';
import { exportJson } from './features/exports/download.js';
import LoginPanel from './components/LoginPanel.vue';
import AppHeader from './components/AppHeader.vue';
import PointIcon from './components/PointIcon.vue';
const store = useAppStore();
const route = useRoute();
const mode = appMode();
const mapModule = computed(() => route.path === '/points' || route.path.startsWith('/regions'));
watchEffect(() => {
  document.documentElement.dataset.theme = store.dark ? 'dark' : 'light';
});
</script>
<template>
  <div
    class="atlas-app"
    :class="{ 'atlas-map-module': mapModule }"
  >
    <AppHeader />
    <main
      class="atlas-content"
      :class="{ 'atlas-map-content': mapModule }"
    >
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
      v-if="!mapModule"
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
