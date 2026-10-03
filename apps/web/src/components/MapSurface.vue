<script setup lang="ts">
import { nextTick } from 'vue';
import { VISIT_LABELS, type MapLevel, type Scope } from '@fangyu/contracts';
import type { EntryView } from '@fangyu/domain';
import { useTiledMap } from '../features/maps/use-tiled-map.js';
import BasemapSettings from './BasemapSettings.vue';
import VisitedMapLayers from './VisitedMapLayers.vue';
import { mapAttributions } from '../features/maps/data-attribution.js';
const props = withDefaults(
  defineProps<{
    scope: Scope;
    selected?: string;
    level?: MapLevel;
    category?: string;
    points?: EntryView[];
    focus?: [number, number] | null;
  }>(),
  { selected: '', level: 'county', category: '', focus: null },
);
const emit = defineEmits<{
  select: [id: string];
  point: [id: string];
  level: [value: Exclude<MapLevel, 'country'>];
  overview: [];
}>();
const {
  store,
  host,
  mapHost,
  hoverInfo,
  hoverStyle,
  showPoints,
  mapError,
  loading,
  fallback,
  provider,
  providerFailed,
  missingBoundary,
  mapZoom,
  mapCenter,
  visiblePointCount,
  visitedResult,
  visitedLayers,
  selectedVisitedMarkers,
  selectVisitedMarker,
  closeVisitedSelection,
  initialize,
  useFallback,
  zoom,
  fitRegion,
  fitSelection,
  fitFranceView,
  exportPng,
} = useTiledMap(props, (id, point) => (point ? emit('point', id) : emit('select', id)));
async function overview(group?: 'metropolitan' | 'overseas') {
  if (props.scope === 'france') {
    emit('overview');
    await nextTick();
  }
  if (group) fitFranceView(group);
  else fitRegion();
}
</script>
<template>
  <section class="map-card">
    <div
      v-if="scope === 'china'"
      class="map-level-switch"
      role="group"
      aria-label="中国地图显示层级"
    >
      <span>显示层级</span>
      <button
        v-for="option in [
          ['province', '省级'],
          ['city', '市州盟'],
          ['county', '县区'],
        ] as const"
        :key="option[0]"
        type="button"
        :class="{ active: level === option[0] }"
        :aria-pressed="level === option[0]"
        @click="emit('level', option[0])"
      >
        {{ option[1] }}
      </button>
    </div>
    <div class="toolbar">
      <button
        aria-label="放大"
        @click="zoom(1.2)"
      >
        ＋
      </button>
      <button
        aria-label="缩小"
        @click="zoom(1 / 1.2)"
      >
        －
      </button>
      <button @click="overview()">全图</button>
      <template v-if="scope === 'france'">
        <button
          :disabled="loading || missingBoundary"
          @click="overview('metropolitan')"
        >
          法国本土
        </button>
        <button
          :disabled="loading || missingBoundary"
          title="显示当前目录已收录的全部海外地区"
          @click="overview('overseas')"
        >
          全部海外地区
        </button>
      </template>
      <button @click="fitSelection">选中范围</button>
      <button @click="exportPng">导出 PNG</button>
      <label
        ><input
          v-model="showPoints"
          type="checkbox"
        />显示点位</label
      >
    </div>
    <VisitedMapLayers
      :result="visitedResult"
      :layers="visitedLayers"
      :selected="selectedVisitedMarkers"
      @choose="selectVisitedMarker"
      @close="closeVisitedSelection"
    />
    <p
      v-if="showPoints && !category && !selected && !focus"
      class="note"
    >
      {{
        fallback
          ? '全图优先显示已到访点位；选择类别或地区可查看其余地点。'
          : '全图优先显示已到访点位；放大地图或选择类别、地区可查看其余地点。'
      }}
    </p>
    <p
      class="map-boundary-notice"
      role="note"
    >
      <strong>地图边界说明</strong>
      边界与行政区划图形仅供旅行记录参考，不代表权威或现行的地理边界与行政区划；具体情况请以主管部门公布的资料为准。
      <span v-if="['vietnam', 'malaysia', 'singapore', 'brunei'].includes(scope)">
        本专题在西沙、南沙的离散岛礁图形不提供行政区悬停或选择。
      </span>
    </p>
    <p
      v-if="mapError"
      class="error"
    >
      {{ mapError }}
    </p>
    <div
      ref="host"
      class="map-surface"
      :data-map-level="scope === 'france' || scope === 'china' ? level : undefined"
      :data-map-mode="missingBoundary ? 'unavailable' : fallback ? 'canvas' : 'tiles'"
      :data-map-zoom="fallback || missingBoundary ? undefined : mapZoom"
      :data-map-center="mapCenter?.join(',')"
      :data-visible-points="visiblePointCount"
      :aria-busy="loading"
    >
      <div
        ref="mapHost"
        class="tile-map-host"
      />
      <div
        v-if="loading"
        class="tile-map-status"
        role="status"
      >
        正在载入地图…
      </div>
      <div
        v-if="hoverInfo"
        class="map-hover-card"
        :style="hoverStyle"
        role="tooltip"
      >
        <strong>{{ hoverInfo.title }}</strong>
        <small>{{ hoverInfo.detail }}</small>
        <span>{{ hoverInfo.state }}</span>
      </div>
    </div>
    <div
      class="tile-map-note"
      role="status"
    >
      <span>{{
        missingBoundary
          ? '本专题边界地图待补充'
          : fallback
            ? focus
              ? '当前使用简化地图，仅显示所属地区范围，暂不支持地点精确居中。'
              : '当前使用简化地图，仍可查看和记录到访。'
            : providerFailed
              ? '在线底图暂不可用，行政区地图仍可使用。'
              : !provider
                ? '行政区地图 · 在线底图未启用'
                : '在线底图 · ' + provider.name
      }}</span>
      <button
        v-if="fallback || providerFailed || mapError"
        :disabled="loading"
        @click="initialize"
      >
        重试地图
      </button>
      <button
        v-if="mapError && !fallback && !missingBoundary"
        :disabled="loading"
        @click="useFallback"
      >
        使用简化地图
      </button>
    </div>
    <BasemapSettings />
    <slot name="content-controls" />
    <div class="legend">
      <span
        v-for="(label, state) in VISIT_LABELS"
        :key="state"
      >
        <i :style="{ background: store.colors[state] }"></i>{{ label }}
      </span>
    </div>
    <p class="note">拖动平移，滚轮缩放，点击选择；悬浮查看地区与要素信息。</p>
    <p class="note map-data-attribution">
      <a
        v-for="credit in mapAttributions(scope, visitedLayers.visitedWorldHeritage)"
        :key="credit.url"
        :href="credit.url"
        target="_blank"
        rel="noopener noreferrer"
        >{{ credit.label }}</a
      >
    </p>
  </section>
</template>

<style scoped>
.map-data-attribution {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  font-size: 11px;
}
.tile-map-host {
  width: 100%;
  height: 100%;
}
.tile-map-status {
  position: absolute;
  top: 12px;
  left: 12px;
  padding: 8px 14px;
  background: #ffffffed;
  color: #244d40;
  border-radius: 8px;
  z-index: 2;
}
.tile-map-note {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 6px 12px;
  font-size: 12px;
  color: #667a71;
}
.tile-map-note button {
  font-size: 12px;
  padding: 3px 9px;
}
.map-hover-card {
  z-index: 3;
  pointer-events: none;
}
:global([data-theme='dark']) .tile-map-note {
  color: #b5cbbf;
}
:global([data-theme='dark']) .tile-map-status {
  background: #20343bed;
  color: #d7e4de;
}
</style>
