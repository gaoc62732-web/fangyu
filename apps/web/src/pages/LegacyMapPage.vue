<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Scope, MapLevel } from '@fangyu/contracts';
import LegacyMapSurface from '../components/LegacyMapSurface.vue';
import { useAppStore } from '../app/store.js';
import { SCOPE_NAMES } from '../app/workspace.js';
const store = useAppStore();
const scope = ref<Scope>('china'),
  level = ref<MapLevel>('province'),
  selected = ref('');
const points = computed(() => store.session!.entries(scope.value));
</script>
<template>
  <section class="legacy-map-page">
    <div class="toolbar">
      <RouterLink to="/map">← 返回新地图</RouterLink><strong>旧地图对照</strong
      ><span class="note">仅供验收对照；进入此页会加载原精度边界。</span>
    </div>
    <div class="toolbar">
      <select
        v-model="scope"
        aria-label="旧地图范围"
      >
        <option
          v-for="(name, id) in SCOPE_NAMES"
          :key="id"
          :value="id"
        >
          {{ name }}
        </option></select
      ><select
        v-model="level"
        aria-label="旧地图层级"
      >
        <option value="province">省级</option>
        <option value="city">市级</option>
        <option value="county">县级</option></select
      ><span>{{ store.session!.index.paths.get(selected) }}</span>
    </div>
    <LegacyMapSurface
      :scope="scope"
      :level="level"
      :selected="selected"
      :points="points"
      @select="(id) => (selected = id)"
    />
  </section>
</template>
<style scoped>
.legacy-map-page {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.legacy-map-page :deep(.map-surface) {
  position: relative;
  min-height: 440px;
  flex: 1;
}
</style>
