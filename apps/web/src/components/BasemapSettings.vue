<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  basemapCanEnable,
  basemapKind,
  basemapProvider,
  setBasemapKind,
} from '../features/maps/basemap-settings.js';
import type { BasemapKind } from '../features/maps/types.js';

const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false });
const message = ref('');
const tiandituAvailable = computed(() => basemapKind.value === 'satellite' && basemapCanEnable.value);

function changeKind(event: Event) {
  const kind = (event.target as HTMLSelectElement).value as BasemapKind;
  setBasemapKind(kind);
  message.value = basemapProvider.value ? '已切换底图。' : '当前底图暂不可用。';
}
</script>

<template>
  <section
    class="basemap-settings"
    :class="{ compact: props.compact }"
  >
    <label class="basemap-control">
      <span>底图</span>
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
  position: relative;
  display: grid;
  gap: 6px;
  color: var(--atlas-ink);
  font-size: 13px;
}
.basemap-settings.compact {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  min-width: 0;
}
.basemap-control {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.basemap-control span {
  flex: none;
  color: var(--atlas-ink);
  opacity: 0.72;
}
.basemap-control select {
  width: 154px;
  min-width: 0;
  height: 30px;
  padding: 3px 8px;
  font-size: 12px;
}
.basemap-settings:not(.compact) .basemap-control {
  justify-content: space-between;
}
.basemap-settings:not(.compact) .basemap-control select {
  width: 178px;
  height: 32px;
  font-size: 13px;
}
.basemap-settings p {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--atlas-ink);
  opacity: 0.7;
}
.basemap-settings.compact p {
  position: absolute;
  top: auto;
  bottom: calc(100% + 4px);
  right: 0;
  width: max-content;
  max-width: min(280px, calc(100vw - 32px));
  margin-top: 4px;
  padding: 5px 8px;
  border: 1px solid var(--atlas-line);
  border-radius: 6px;
  background: var(--atlas-paper);
  box-shadow: 0 6px 16px rgb(20 28 22 / 10%);
}
.basemap-settings.compact p + p {
  bottom: calc(100% + 34px);
}
</style>
