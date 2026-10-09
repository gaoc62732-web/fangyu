<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  basemapCanEnable,
  basemapEnabled,
  basemapKind,
  basemapProvider,
  setBasemapEnabled,
  setBasemapKind,
} from '../features/maps/basemap-settings.js';
import type { BasemapKind } from '../features/maps/types.js';

const message = ref('');
const tiandituAvailable = computed(() => basemapKind.value === 'satellite' && basemapCanEnable.value);

function toggle(event: Event) {
  const enabled = (event.target as HTMLInputElement).checked;
  const saved = setBasemapEnabled(enabled);
  message.value = saved ? (enabled ? '已启用底图。' : '已关闭底图。') : '底图设置未能保存。';
}

function changeKind(event: Event) {
  const kind = (event.target as HTMLSelectElement).value as BasemapKind;
  setBasemapKind(kind);
  message.value = basemapProvider.value ? '已切换底图。' : '当前底图暂不可用。';
}
</script>

<template>
  <section class="basemap-settings">
    <h3>底图</h3>
    <div class="toolbar">
      <label>
        <input
          type="checkbox"
          :checked="basemapEnabled"
          :disabled="!basemapCanEnable"
          @change="toggle"
        />启用底图
      </label>
      <label>
        类型
        <select
          :value="basemapKind"
          aria-label="底图类型"
          @change="changeKind"
        >
          <option value="vector">OSM Liberty（自定义）</option>
          <option
            value="satellite"
            :disabled="basemapKind !== 'satellite' && !basemapCanEnable"
          >天地图</option>
        </select>
      </label>
    </div>
    <p
      v-if="basemapKind === 'satellite' && !tiandituAvailable"
      class="note"
    >当前项目未提供天地图底图配置。</p>
    <p
      v-if="message"
      role="status"
      aria-live="polite"
    >{{ message }}</p>
  </section>
</template>

<style scoped>
.basemap-settings {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--atlas-line);
}
.basemap-settings h3 {
  margin: 0 0 12px;
}
.basemap-settings .toolbar {
  flex-wrap: wrap;
}
</style>
