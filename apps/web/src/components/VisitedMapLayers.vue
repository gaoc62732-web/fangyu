<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { RecordPreferences } from '@fangyu/contracts';
import type { visitedMapMarkers } from '@fangyu/domain';
import { VISITED_MARKER_PATHS } from '@fangyu/map-renderer';
import { useAppStore } from '../app/store.js';

type Result = ReturnType<typeof visitedMapMarkers>;
type Marker = Result['markers'][number];
const props = defineProps<{
  result: Result;
  layers: NonNullable<RecordPreferences['mapLayers']>;
  selected: Marker[];
}>();
const emit = defineEmits<{ choose: [id: string]; close: [] }>();
const store = useAppStore();
const query = ref('');
const limit = ref(30);
const selection = ref<HTMLElement>();
const items = computed(() =>
  props.result.markers.filter((marker) =>
    marker.name.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase()),
  ),
);
const options = [
  { key: 'visitedAirports', icon: 'airport', label: '已到访机场' },
  { key: 'visitedWorldHeritage', icon: 'world-heritage', label: '已到访世界遗产' },
] as const;
function toggle(key: keyof NonNullable<RecordPreferences['mapLayers']>, event: Event) {
  const value = (event.target as HTMLInputElement).checked;
  store.commit((session) =>
    session.updatePreferences({ mapLayers: { ...props.layers, [key]: value } }),
  );
}
function mark(marker: Marker, event: Event) {
  store.commit((session) =>
    session.markEntry(marker.entryId, (event.target as HTMLInputElement).checked),
  );
}
function record(marker: Marker) {
  void store.revision;
  return store.session!.view(store.session!.entry(marker.entryId));
}
const safeUrl = (url?: string) => (/^https?:\/\//i.test(url || '') ? url : undefined);
watch(query, () => {
  limit.value = 30;
});
watch(
  () => props.selected.map((marker) => marker.id).join(','),
  async (value) => {
    if (value) {
      await nextTick();
      selection.value?.focus({ preventScroll: true });
    }
  },
);
</script>

<template>
  <section
    class="visited-map-layers"
    aria-label="已到访地图图层"
  >
    <div class="visited-layer-switches">
      <label
        v-for="option in options"
        :key="option.key"
      >
        <input
          type="checkbox"
          :checked="layers[option.key]"
          @change="toggle(option.key, $event)"
        />
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          aria-hidden="true"
        >
          <path
            :d="VISITED_MARKER_PATHS[option.icon]"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        {{ option.label }}
      </label>
    </div>
    <template v-if="layers.visitedAirports || layers.visitedWorldHeritage">
      <p
        class="visited-layer-summary"
        role="status"
      >
        已定位 {{ result.counts.mappedRecords }} 条<span v-if="result.counts.omittedRecords">
          · 无法定位 {{ result.counts.omittedRecords }} 条</span
        >
      </p>
      <details
        v-if="result.markers.length"
        class="visited-marker-list"
      >
        <summary>已到访地点（{{ result.markers.length }}）</summary>
        <input
          v-model="query"
          type="search"
          aria-label="搜索已到访地图标记"
          placeholder="查找已到访机场或世界遗产"
        />
        <div class="visited-marker-buttons">
          <button
            v-for="marker in items.slice(0, limit)"
            :key="marker.id"
            @click="emit('choose', marker.id)"
          >
            {{ marker.name }}<small v-if="marker.kind === 'project-reference'">参考位置</small>
          </button>
        </div>
        <p v-if="!items.length">没有匹配的已到访地图标记。</p>
        <button
          v-if="items.length > limit"
          @click="limit += 30"
        >
          显示更多
        </button>
      </details>
      <details
        v-if="result.omitted.length"
        class="visited-marker-omissions"
      >
        <summary>无法定位（{{ result.omitted.length }}）</summary>
        <ul>
          <li
            v-for="item in result.omitted.slice(0, 30)"
            :key="item.id"
          >
            {{ item.name }}
          </li>
        </ul>
        <p v-if="result.omitted.length > 30">仅显示前 30 条。</p>
      </details>
      <section
        v-if="selected.length"
        ref="selection"
        class="visited-map-selection"
        role="region"
        aria-label="已到访地点详情"
        tabindex="-1"
        @keydown.esc.stop="emit('close')"
      >
        <div class="visited-selection-heading">
          <strong>{{
            selected.length > 1 ? `此处有 ${selected.length} 条到访记录` : '已到访地点'
          }}</strong
          ><button
            aria-label="关闭已到访地点详情"
            @click="emit('close')"
          >
            关闭
          </button>
        </div>
        <div class="visited-selection-items">
          <article
            v-for="marker in selected"
            :key="marker.id"
          >
            <button
              class="visited-marker-name"
              @click="emit('choose', marker.id)"
            >
              {{ marker.name }}
            </button>
            <p v-if="marker.kind === 'project-reference'">项目参考位置，非入口。</p>
            <label
              ><input
                type="checkbox"
                :checked="record(marker).visited"
                :aria-label="'已到访：' + marker.name"
                @change="mark(marker, $event)"
              />{{ marker.partial ? '已有部分到访记录' : '已到访' }}</label
            >
            <p v-if="record(marker).note">{{ record(marker).note }}</p>
            <a
              v-if="safeUrl(marker.sourceUrl)"
              :href="safeUrl(marker.sourceUrl)"
              target="_blank"
              rel="noopener noreferrer"
              >查看地点来源</a
            >
          </article>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.visited-map-layers {
  padding: 10px 12px;
  border-top: 1px solid #dce5df;
  border-bottom: 1px solid #dce5df;
}
.visited-layer-switches {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 20px;
}
.visited-layer-switches label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.visited-layer-summary {
  margin: 8px 0 4px;
}
.visited-marker-omissions p {
  font-size: 12px;
  line-height: 1.6;
  color: #61766d;
}
.visited-marker-list,
.visited-marker-omissions {
  margin-top: 8px;
}
summary {
  cursor: pointer;
}
.visited-marker-list > input {
  display: block;
  width: min(100%, 360px);
  box-sizing: border-box;
  margin: 8px 0;
  padding: 7px;
}
.visited-marker-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 160px;
  overflow: auto;
}
.visited-marker-buttons button {
  max-width: 100%;
  overflow-wrap: anywhere;
  text-align: left;
}
small {
  display: block;
}
.visited-map-selection {
  margin-top: 10px;
  padding: 10px;
  border: 1px solid #9db9ac;
  border-radius: 8px;
}
.visited-selection-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}
.visited-selection-items {
  max-height: 260px;
  overflow: auto;
}
.visited-selection-items article {
  padding: 10px 0;
  border-bottom: 1px solid #dce5df;
}
.visited-selection-items article:last-child {
  border: 0;
}
.visited-marker-name {
  display: block;
  max-width: 100%;
  text-align: left;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.visited-selection-items p {
  margin: 6px 0;
  font-size: 12px;
  line-height: 1.6;
}
.visited-selection-items a {
  display: block;
  margin-top: 6px;
}
:global([data-theme='dark']) .visited-marker-omissions p {
  color: #b5cbbf;
}
</style>
