<script setup lang="ts">
import { computed, nextTick } from 'vue';
import { VISIT_LABELS, type MapLevel, type Scope } from '@fangyu/contracts';
import type { EntryView } from '@fangyu/domain';
import { POINT_MAP_APPEARANCE, pointVisitColors } from '@fangyu/map-renderer';
import { useTiledMap } from '../features/maps/use-tiled-map.js';
import PointIcon from './PointIcon.vue';
import ChinaBoundarySettings from './ChinaBoundarySettings.vue';
import VisitedMapLayers from './VisitedMapLayers.vue';
const props = withDefaults(
  defineProps<{
    scope: Scope;
    selected?: string;
    selectionMuted?: boolean;
    level?: MapLevel;
    category?: string;
    points?: EntryView[];
    highlightedPointIds?: string[];
    focus?: [number, number] | null;
    focusPoints?: [number, number][] | null;
    pointMode?: boolean;
    regionMode?: boolean;
    initialCamera?: { center: [number, number]; zoom: number } | undefined;
    previewRegions?: string[] | undefined;
  }>(),
  { selected: '', selectionMuted: false, level: 'county', category: '', focus: null },
);
const emit = defineEmits<{
  select: [id: string];
  point: [id: string];
  level: [value: Exclude<MapLevel, 'country'>];
  overview: [];
  cluster: [ids: string[]];
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
  zoom,
  fitRegion,
  fitSelection,
  fitFranceView,
  exportPng,
} = useTiledMap(props, (id, point) => (point ? emit('point', id) : emit('select', id)));
const pointColors = computed(() => ({ ...POINT_MAP_APPEARANCE, ...pointVisitColors(store.colors) }));
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
    :class="{ 'atlas-map': pointMode || regionMode }"
  >
    <div
      v-if="scope === 'china' && !pointMode && !regionMode"
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
      v-if="!pointMode && !regionMode"
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
      v-if="!pointMode && !regionMode"
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
      <template v-if="pointMode || regionMode">
        <div class="atlas-map-controls">
          <details class="atlas-map-legend">
            <summary aria-label="地图图例">
              <PointIcon
                name="legend"
                :size="16"
              /><span>图例</span>
            </summary>
            <div class="atlas-legend-content">
              <h4>{{ regionMode ? '地区旅行状态' : '点位与范围' }}</h4>
              <div
                v-if="regionMode"
                class="atlas-state-legend"
              >
                <span
                  v-for="(label, state) in VISIT_LABELS"
                  :key="state"
                  ><i :style="{ background: store.colors[state] }" />{{ label }}</span
                >
              </div>
              <div
                v-else
                class="atlas-state-legend"
              >
                <span
                  ><i
                    class="atlas-legend-dot"
                    :style="{ background: pointColors.unvisitedColor }"
                  />未点亮</span
                >
                <span
                  ><i
                    class="atlas-legend-dot"
                    :style="{ background: pointColors.visitedColor }"
                  />已点亮</span
                >
                <span><i class="atlas-legend-dot" :style="{ background: pointColors.partialColor }" />部分到访</span>
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
        <ChinaBoundarySettings v-if="scope === 'china' && regionMode" />
      </template>
      <div
        v-if="pointMode"
        class="point-overlay"
        :class="{ 'has-focused-points': highlightedPointIds?.length }"
        :style="{ '--point-visited': pointColors.visitedColor, '--point-unvisited': pointColors.unvisitedColor, '--point-partial': pointColors.partialColor, '--point-visited-ink': pointColors.visitedTextColor, '--point-unvisited-ink': pointColors.unvisitedTextColor, '--point-partial-ink': pointColors.partialTextColor }"
        aria-label="地图点位"
      >
        <button
          v-for="group in pointGroups"
          :key="group.id"
          class="point-dot"
          :class="{
            clustered: group.members.length > 1,
            marked: group.members.every((e) => e.checked),
            partial: !group.members.every((e) => e.checked) && group.members.some((e) => e.checked || e.partial),
            'is-focused': group.highlighted,
          }"
          :style="{ left: group.x + 'px', top: group.y + 'px' }"
          :aria-label="
            group.members.length > 1
              ? group.members.length + ' 个点位，点击放大'
              : group.members[0]!.name
          "
          @click.stop="
            group.members.length > 1
              ? expandCluster(group.members.map((e) => e.id), group.expansionZoom)
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
      <div
        class="map-attribution-bar"
        aria-label="地图贡献信息"
      >
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noopener noreferrer"
          >© OpenStreetMap contributors</a
        ><span aria-hidden="true">|</span><span>天地图</span><span aria-hidden="true">|</span
        ><span>Fangyu Developers</span>
      </div>
    </div>
    <div
      v-if="providerFailed"
      class="tile-map-note"
      role="status"
    >
      <span v-if="providerFailed">底图加载错误，当前仅显示政区边界。请检查网络连接。</span>
      <button
        v-if="providerFailed"
        :disabled="loading"
        @click="initialize"
      >
        重试地图
      </button>
    </div>
    <slot name="content-controls" />
    <div
      v-if="!pointMode && !regionMode"
      class="legend"
    >
      <span
        v-for="(label, state) in VISIT_LABELS"
        :key="state"
      >
        <i :style="{ background: store.colors[state] }"></i>{{ label }}
      </span>
    </div>
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
.atlas-map-legend > summary::-webkit-details-marker {
  display: none;
}
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
.map-attribution-bar {
  position: absolute;
  right: 0;
  bottom: 0;
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 5px;
  max-width: calc(100% - 16px);
  padding: 2px 6px;
  border-radius: 6px 0 0;
  color: var(--point-ink, #30372e);
  background: rgb(255 254 250 / 72%);
  font-size: 11px;
  line-height: 1.35;
  white-space: nowrap;
}
.map-attribution-bar a {
  color: inherit;
}
.atlas-map .point-dot {
  display: block;
  background: var(--point-unvisited);
  border: 2px solid #fffefa;
  border-radius: 50%;
  box-shadow: 0 2px 7px #27292135;
}
.atlas-map .point-dot.marked {
  background: var(--point-visited);
}
.atlas-map .point-dot.partial { background: var(--point-partial); }
.atlas-map .point-dot.clustered {
  font-size: var(--point-meta-size, 14px);
  font-weight: 400;
  background: var(--point-unvisited);
  color: var(--point-unvisited-ink);
  border: 1px solid #b8c3b6;
  width: 36px;
  height: 36px;
}
.atlas-map .point-dot-name {
  font-size: var(--point-meta-size, 14px);
  color: #394236;
  background: #fffefaed;
  padding: 3px 7px;
  top: 50%;
  box-shadow: 0 2px 4px #2729210a;
}
.point-overlay {
  position: absolute;
  inset: 0;
  z-index: 1;
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
  background: var(--point-unvisited);
  box-shadow: 0 1px 4px #23433955;
}
.point-dot.marked {
  background: var(--point-visited);
}
.point-dot.partial { background: var(--point-partial); }
.point-dot.clustered {
  width: 32px;
  height: 32px;
  font-size: 12px;
  font-weight: 700;
  color: white;
}
.point-dot-name {
  position: absolute;
  left: calc(100% + 8px);
  right: auto;
  top: 50%;
  transform: translateY(-50%);
  color: #243a37;
  width: max-content;
  white-space: normal;
  max-width: min(520px, calc(100vw - 72px));
  overflow: visible;
  overflow-wrap: anywhere;
  text-overflow: clip;
  text-align: left;
  line-height: 1.45;
  font-size: 12px;
  background: #ffffffe0;
  padding: 1px 5px;
  border-radius: 3px;
  pointer-events: auto;
  cursor: pointer;
}
.point-dot-name::before { content: ''; position: absolute; top: 0; bottom: 0; right: 100%; width: 10px; }
.point-overlay.has-focused-points .point-dot:not(.is-focused) { opacity: .2; z-index: 0; }
.point-overlay .point-dot.is-focused { z-index: 20; width: 15px; height: 15px; outline: 1px solid var(--atlas-ink); outline-offset: 3px; box-shadow: 0 0 0 3px var(--atlas-paper), 0 3px 9px #243a3730; }
.point-overlay .point-dot.is-focused.clustered { width: 36px; height: 36px; }
.atlas-map .point-dot.clustered.marked { background: var(--point-visited); color: var(--point-visited-ink); border-color: var(--point-visited); }
.atlas-map .point-dot.clustered.partial { background: var(--point-partial); color: var(--point-partial-ink); border-color: var(--point-partial); }
.point-overlay .point-dot.is-focused .point-dot-name { padding: 4px 8px; border: 1px solid var(--atlas-line); background: var(--atlas-paper); font-size: var(--point-meta-size, 14px); font-weight: 500; box-shadow: 0 2px 8px #243a3718; }
.map-surface > .tile-map-host {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.tile-map-status {
  position: absolute;
  left: 50%;
  right: auto;
  bottom: 84px;
  width: max-content;
  max-width: min(360px, calc(100% - 48px));
  transform: translateX(-50%);
  padding: 8px 14px;
  background: #ffffffed;
  color: #244d40;
  border-radius: 8px;
  z-index: 2;
  text-align: center;
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
