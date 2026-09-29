<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { VISIT_LABELS, type MapLevel, type Scope } from '@fangyu/contracts';
import { CanvasMapRenderer, type MapScene } from '@fangyu/map-renderer';
import type { EntryView } from '@fangyu/domain';
import { useAppStore } from '../app/store.js';
import { download } from '../features/exports/download.js';

const props = withDefaults(
  defineProps<{
    scope: Scope;
    selected?: string;
    level?: MapLevel;
    category?: string;
    points?: EntryView[];
  }>(),
  { selected: '', level: 'county', category: '' },
);
const emit = defineEmits<{ select: [id: string]; point: [id: string] }>();
const store = useAppStore();
const host = ref<HTMLElement>();
const hovered = ref('');
const mapError = ref('');
const showPoints = ref(true);
let renderer: CanvasMapRenderer | undefined;

const scene = computed<MapScene>(() => {
  void store.revision;
  const session = store.session!;
  const markedRegions = new Set<string>();
  if (props.category && props.scope === 'china') {
    for (const entry of store.rows) {
      if (entry.categoryId !== props.category || !entry.visited) continue;
      for (const owner of entry.regionIds) {
        for (const ancestor of session.index.ancestors(owner)) markedRegions.add(ancestor.id);
      }
    }
  }
  const features = (store.geometry[props.scope] || [])
    .filter(
      (feature) =>
        props.scope !== 'china' || feature.level === props.level || feature.level === 'border',
    )
    .sort((left, right) => Number(left.level === 'border') - Number(right.level === 'border'))
    .map((feature) => {
      const region = feature.regionId ? session.index.regions.get(feature.regionId) : undefined;
      let fill = region ? store.colors[session.visitState(region.id)] : store.colors.unmapped;
      if (feature.level === 'border') fill = 'transparent';
      if (region && props.category && props.scope === 'china') {
        const visited = markedRegions.has(region.id);
        fill = store.colors[visited ? 'arrived' : 'unvisited'];
      }
      return {
        id: feature.regionId || feature.id,
        name: region?.name || '未映射边界',
        geometry: feature.geometry,
        fill,
        interactive: Boolean(region),
        selected: Boolean(
          region && props.selected && session.index.belongsTo(region.id, props.selected),
        ),
      };
    });
  const points = showPoints.value
    ? (props.points || [])
        .filter((entry) => entry.coordinates)
        .map((entry) => ({
          id: entry.id,
          name: entry.name,
          coords: entry.coordinates!,
          marked: entry.visited,
        }))
    : [];
  return { features, points, world: props.scope === 'world', dark: store.dark };
});

async function load() {
  mapError.value = '';
  try {
    await store.ensureGeometry(props.scope);
    renderer?.setScene(scene.value, true);
    fitSelection();
  } catch (cause) {
    mapError.value = String(cause);
  }
}

function fitSelection() {
  const ids = props.selected
    ? scene.value.features.filter((feature) => feature.selected).map((feature) => feature.id)
    : undefined;
  renderer?.fit(ids);
}

async function exportPng() {
  if (!renderer) return;
  try {
    const legend = Object.entries(VISIT_LABELS).map(([state, label]) => ({
      label,
      color: store.colors[state as keyof typeof VISIT_LABELS],
    }));
    download(await renderer.png('方舆旅行地图', legend), '方舆地图.png');
  } catch (cause) {
    mapError.value = String(cause);
  }
}

onMounted(() => {
  if (host.value) {
    renderer = new CanvasMapRenderer(
      host.value,
      (id, point) => (point ? emit('point', id) : emit('select', id)),
      (name) => {
        hovered.value = name;
      },
    );
    void load();
  }
});
watch(scene, (value) => renderer?.setScene(value));
watch(() => props.scope, load);
watch(() => [props.selected, props.level], fitSelection);
onBeforeUnmount(() => renderer?.destroy());
</script>

<template>
  <section class="map-card">
    <div class="toolbar">
      <button
        aria-label="放大"
        @click="renderer?.zoom(1.4)"
      >
        ＋
      </button>
      <button
        aria-label="缩小"
        @click="renderer?.zoom(1 / 1.4)"
      >
        －
      </button>
      <button @click="renderer?.fit()">全图</button>
      <button @click="fitSelection">选中范围</button>
      <button @click="exportPng">导出 PNG</button>
      <label
        ><input
          v-model="showPoints"
          type="checkbox"
        />显示点位</label
      >
    </div>
    <p
      v-if="mapError"
      class="error"
    >
      {{ mapError }}
    </p>
    <div
      ref="host"
      class="map-surface"
    ></div>
    <div class="legend">
      <span
        v-for="(label, state) in VISIT_LABELS"
        :key="state"
      >
        <i :style="{ background: store.colors[state] }"></i>{{ label }}
      </span>
    </div>
    <p class="note">{{ hovered || '拖动平移，滚轮缩放，点击选择。' }}</p>
  </section>
</template>
