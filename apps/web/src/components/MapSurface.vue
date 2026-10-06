<script setup lang="ts">
import { nextTick } from 'vue';
import { VISIT_LABELS, type MapLevel, type Scope } from '@fangyu/contracts';
import type { EntryView } from '@fangyu/domain';
import { POINT_MAP_APPEARANCE } from '@fangyu/map-renderer';
import { useTiledMap } from '../features/maps/use-tiled-map.js';
import BasemapSettings from './BasemapSettings.vue';
import PointIcon from './PointIcon.vue';
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
    pointMode?: boolean;
    pointSettingsOpen?: boolean;
    initialCamera?: { center: [number, number]; zoom: number } | undefined;
    previewRegions?: string[] | undefined;
  }>(),
  { selected: '', level: 'county', category: '', focus: null },
);
const emit = defineEmits<{
  select: [id: string];
  point: [id: string];
  level: [value: Exclude<MapLevel, 'country'>];
  overview: [];
  cluster: [ids: string[]];
  settings: [];
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
  providerFailed,
  missingBoundary,
  mapZoom,
  mapCenter,
  visiblePointCount,
  pointGroups,
  expandCluster,
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
  <section
    class="map-card"
    :class="{ 'atlas-map': pointMode }"
  >
    <div
      v-if="scope === 'china' && !pointMode"
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
    <div
      v-if="!pointMode"
      class="toolbar"
    >
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
      v-if="!pointMode"
      :result="visitedResult"
      :layers="visitedLayers"
      :selected="selectedVisitedMarkers"
      @choose="selectVisitedMarker"
      @close="closeVisitedSelection"
    />
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
      <template v-if="pointMode">
        <div class="atlas-map-controls">
          <details class="atlas-map-legend">
            <summary aria-label="地图图例">
              <PointIcon
                name="legend"
                :size="16"
              /><span>图例</span>
            </summary>
            <div class="atlas-legend-content">
              <h4>点位与范围</h4>
              <div class="atlas-state-legend">
                <span
                  ><i
                    class="atlas-legend-dot"
                    style="background: #617267"
                  />未点亮</span
                >
                <span
                  ><i
                    class="atlas-legend-dot"
                    style="background: #a07c3b"
                  />已点亮</span
                >
                <span
                  ><i
                    :style="{
                      background: POINT_MAP_APPEARANCE.highlightColor,
                      opacity: POINT_MAP_APPEARANCE.highlightOpacity,
                    }"
                  />所选范围</span
                >
              </div>
            </div>
          </details>
          <div
            v-if="scope === 'china' || scope === 'france'"
            class="atlas-levels"
            role="group"
            aria-label="地图行政层级"
          >
            <button
              v-for="option in [
                ['province', '省'],
                ['city', '市'],
                ['county', '县'],
              ] as const"
              :key="option[0]"
              :class="{ active: level === option[0] }"
              :aria-pressed="level === option[0]"
              @click="emit('level', option[0])"
            >
              {{ option[1] }}
            </button>
          </div>
          <div class="atlas-zoom">
            <button
              aria-label="放大"
              @click="zoom(1.5)"
            >
              <PointIcon name="plus" />
            </button>
            <button
              aria-label="缩小"
              @click="zoom(1 / 1.5)"
            >
              <PointIcon name="minus" />
            </button>
            <button
              aria-label="显示全图"
              @click="overview()"
            >
              <PointIcon name="frame" />
            </button>
          </div>
        </div>
        <div class="atlas-map-options">
          <button
            aria-label="点位关联设置"
            title="点位关联设置"
            :aria-expanded="pointSettingsOpen"
            @click="emit('settings')"
          >
            <PointIcon name="settings" />
          </button>
        </div>
        <details
          v-if="fallback"
          class="atlas-map-attribution"
        >
          <summary aria-label="地图来源">ⓘ</summary>
          <div>
            <a
              v-for="credit in mapAttributions(scope)"
              :key="credit.url"
              :href="credit.url"
              target="_blank"
              rel="noopener noreferrer"
              >{{ credit.label }}</a
            >
          </div>
        </details>
      </template>
      <div
        v-if="pointMode"
        class="point-overlay"
        aria-label="地图点位"
      >
        <button
          v-for="group in pointGroups"
          :key="group.members.map((e) => e.id).join(',')"
          class="point-dot"
          :class="{
            clustered: group.members.length > 1,
            marked: group.members.every((e) => e.visited),
          }"
          :style="{ left: group.x + 'px', top: group.y + 'px' }"
          :aria-label="
            group.members.length > 1
              ? group.members.length + ' 个点位，展开查看'
              : group.members[0]!.name
          "
          @click.stop="
            group.members.length > 1
              ? (emit(
                  'cluster',
                  group.members.map((e) => e.id),
                ),
                expandCluster(group.members.map((e) => e.id)))
              : emit('point', group.members[0]!.id)
          "
        >
          <span v-if="group.members.length > 1">{{ group.members.length }}</span>
          <span
            v-else
            class="point-dot-name"
            >{{ group.members[0]!.name }}</span
          >
        </button>
      </div>
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
      v-if="fallback || providerFailed || (mapError && !missingBoundary)"
      class="tile-map-note"
      role="status"
    >
      <span v-if="fallback">{{ focus ? '简化地图暂不支持精确定位。' : '已切换为简化地图。' }}</span>
      <span v-else-if="providerFailed">在线底图暂不可用。</span>
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
    <BasemapSettings v-if="!pointMode" />
    <slot name="content-controls" />
    <div
      v-if="!pointMode"
      class="legend"
    >
      <span
        v-for="(label, state) in VISIT_LABELS"
        :key="state"
      >
        <i :style="{ background: store.colors[state] }"></i>{{ label }}
      </span>
    </div>
    <p
      v-if="!pointMode"
      class="note map-data-attribution"
    >
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
.atlas-map {
  position: relative;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  min-height: 0;
  height: 100%;
}
.atlas-map .map-surface {
  height: 100%;
}
.atlas-map > .error,
.atlas-map > .tile-map-note {
  position: absolute;
  bottom: 44px;
  left: 24px;
  z-index: 4;
  max-width: min(440px, calc(100% - 110px));
  background: #fffefaed;
  border: 1px solid #e2e3dd;
  border-radius: 8px;
  padding: 9px 13px;
  font-size: var(--point-meta-size, 14px);
  color: var(--point-ink, #30372e);
}
.atlas-map .map-hover-card {
  border-radius: 7px;
  background: #fffefa;
  border-color: #d9ddd0;
  box-shadow: 0 4px 14px #30392a15;
  font-size: var(--point-meta-size, 14px);
}
.atlas-map .map-hover-card :deep(small) {
  font-size: var(--point-meta-size, 14px);
  color: var(--point-ink, #30372e);
}
.atlas-map .tile-map-note button {
  font-size: var(--point-body-size, 16px);
}
.atlas-map-controls {
  position: absolute;
  right: 24px;
  bottom: 58px;
  z-index: 2;
  display: grid;
  justify-items: end;
  gap: 12px;
}
.atlas-zoom,
.atlas-levels {
  display: flex;
  background: #fffefa;
  border: 1px solid #e2e3dd;
  box-shadow: none;
  border-radius: 12px;
  padding: 4px;
}
.atlas-zoom {
  flex-direction: column;
}
.atlas-map button {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #333932;
  background: transparent;
  border: 0;
  border-radius: 7px;
  padding: 0;
}
.atlas-zoom button {
  width: 34px;
  height: 34px;
}
.atlas-zoom button:hover,
.atlas-levels button:hover {
  background: #efefe8;
}
.atlas-levels button {
  width: 36px;
  height: 36px;
  font-size: var(--point-body-size, 16px);
  font-weight: 300;
}
.atlas-levels button.active {
  background: #363d34;
  color: #fff;
}
.atlas-map-options {
  position: absolute;
  top: 24px;
  right: 24px;
  z-index: 4;
}
.atlas-map-options > button,
.atlas-map-legend > summary {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  background: #fffefa;
  border: 1px solid #e2e3dd;
  border-radius: 12px;
  cursor: pointer;
  color: var(--point-ink, #30372e);
  box-shadow: none;
  list-style: none;
}
.atlas-map-options > button {
  width: 42px;
}
.atlas-map-legend {
  position: relative;
}
.atlas-state-legend .atlas-legend-dot {
  border-radius: 50%;
}
.atlas-map-legend > summary {
  gap: 8px;
  padding: 0 12px;
  font-size: var(--point-body-size, 16px);
  font-weight: 300;
}
.atlas-map-legend > summary::-webkit-details-marker,
.atlas-map-attribution > summary::-webkit-details-marker {
  display: none;
}
.atlas-map-options > button:hover,
.atlas-map-options > button[aria-expanded='true'],
.atlas-map-legend > summary:hover,
.atlas-map-legend[open] > summary {
  background: #f2f2e9;
}
.atlas-legend-content {
  position: absolute;
  right: 0;
  bottom: 50px;
  width: 240px;
  padding: 18px;
  background: #fffefa;
  border: 1px solid #e2e3dd;
  border-radius: 12px;
}
.atlas-legend-content h4 {
  margin: 0 0 14px;
  font-size: var(--point-meta-size, 14px);
  font-weight: 400;
}
.atlas-state-legend {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 12px;
  font-size: var(--point-meta-size, 14px);
}
.atlas-state-legend span {
  display: flex;
  align-items: center;
  gap: 7px;
}
.atlas-state-legend i {
  width: 10px;
  height: 10px;
  flex-shrink: 0;
  border: 1px solid #30372e15;
  border-radius: 2px;
}
.atlas-map-attribution {
  position: absolute;
  right: 10px;
  bottom: 40px;
  z-index: 2;
  background: #fffefaed;
  border-radius: 12px;
  color: var(--point-ink, #30372e);
}
.atlas-map-attribution summary {
  list-style: none;
  cursor: pointer;
  padding: 0 6px;
  font-size: 18px;
}
.atlas-map-attribution > div {
  position: absolute;
  right: 0;
  bottom: 28px;
  display: grid;
  gap: 6px;
  width: min(340px, calc(100vw - 48px));
  padding: 12px 16px;
  background: #fffefa;
  border: 1px solid #e2e3dd;
  border-radius: 12px;
  font-size: 12px;
  line-height: 1.65;
}
.atlas-map-attribution a {
  color: inherit;
}
.atlas-map .point-dot {
  display: block;
  background: #617267;
  border: 2px solid #fffefa;
  border-radius: 50%;
  box-shadow: 0 2px 7px #27292135;
}
.atlas-map .point-dot.marked {
  background: #a07c3b;
}
.atlas-map .point-dot.clustered {
  font-size: var(--point-meta-size, 14px);
  font-weight: 400;
  background: #fdfcf7;
  color: #454f43;
  border: 1px solid #b8c3b6;
  width: 36px;
  height: 36px;
}
.atlas-map .point-dot-name {
  font-size: var(--point-meta-size, 14px);
  color: #394236;
  background: #fffefaed;
  padding: 3px 7px;
  top: -15px;
  box-shadow: 0 2px 4px #2729210a;
}
.point-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}
.point-dot {
  position: absolute;
  pointer-events: auto;
  transform: translate(-50%, -50%);
  width: 12px;
  height: 12px;
  padding: 0;
  border: 2px solid white;
  border-radius: 50%;
  background: #438fae;
  box-shadow: 0 1px 4px #23433955;
}
.point-dot.marked {
  background: #26775b;
}
.point-dot.clustered {
  width: 32px;
  height: 32px;
  font-size: 12px;
  font-weight: 700;
  color: white;
}
.point-dot-name {
  position: absolute;
  left: 15px;
  top: -9px;
  color: #243a37;
  white-space: nowrap;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  background: #ffffffe0;
  padding: 1px 5px;
  border-radius: 3px;
}
.map-data-attribution {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  font-size: 11px;
}
.map-surface > .tile-map-host {
  position: absolute;
  inset: 0;
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
