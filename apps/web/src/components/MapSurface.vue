<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { VISIT_LABELS, type MapLevel, type Scope } from '@fangyu/contracts';
import { CanvasMapRenderer, type MapHover, type MapScene } from '@fangyu/map-renderer';
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
const emit = defineEmits<{
  select: [id: string];
  point: [id: string];
  level: [value: Exclude<MapLevel, 'country'>];
}>();
const store = useAppStore();
const host = ref<HTMLElement>();
const hovered = ref<MapHover>();
const mapError = ref('');
const showPoints = ref(true);
const taiwanSelected = computed(() =>
  props.scope === 'china' &&
  store.session?.index.ancestors(props.selected)[0]?.code === '710000',
);
let renderer: CanvasMapRenderer | undefined;
const entryById = computed(() => new Map(store.rows.map((entry) => [entry.id, entry])));
const hoverInfo = computed(() => {
  const hit = hovered.value;
  if (!hit) return undefined;
  if (hit.point) {
    const entry = entryById.value.get(hit.id);
    if (!entry) return { title: hit.name, detail: '内容项目', state: '' };
    const category = store.session!.index.catalog.categories.find((item) => item.id === entry.categoryId);
    return { title: entry.name, detail: `${category?.name || '内容项目'} · ${entry.path}`, state: entry.visited ? '已标记' : '未标记' };
  }
  const region = store.session!.index.regions.get(hit.id);
  return {
    title: hit.name,
    detail: region
      ? props.scope === 'world'
        ? region.aliases[0] || ''
        : store.session!.index.paths.get(region.id) || ''
      : '',
    state: region ? VISIT_LABELS[store.session!.visitState(region.id)] : '',
  };
});
const hoverStyle = computed(() => ({
  left: `${Math.max(8, Math.min((host.value?.clientWidth || 800) - 270, (hovered.value?.x || 0) + 16))}px`,
  top: `${Math.max(8, Math.min((host.value?.clientHeight || 560) - 100, (hovered.value?.y || 0) + 16))}px`,
}));

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
  const points = showPoints.value && props.scope === 'china' && !taiwanSelected.value
    ? (props.points || [])
        .filter((entry) => entry.coordinates)
        .map((entry) => ({
          id: entry.id,
          name: entry.name,
          coords: entry.coordinates!,
          marked: entry.visited,
        }))
    : [];
  return {
    features,
    points,
    world: props.scope === 'world',
    dark: store.dark,
    detailLevel: props.scope === 'china' && props.level !== 'country' ? props.level : undefined,
  };
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
  const selectedRegion = store.session!.index.regions.get(props.selected);
  renderer?.fit(ids, props.scope === 'china' && selectedRegion?.level === 2 ? 0.82 : 1);
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
      (item) => {
        hovered.value = item;
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
        @click="renderer?.zoom(1.2)"
      >
        ＋
      </button>
      <button
        aria-label="缩小"
        @click="renderer?.zoom(1 / 1.2)"
      >
        －
      </button>
      <button @click="renderer?.fit()">全图</button>
      <button @click="fitSelection">选中范围</button>
      <button @click="exportPng">导出 PNG</button>
      <label v-if="scope === 'china' && !taiwanSelected"
        ><input
          v-model="showPoints"
          type="checkbox"
        />显示点位</label
      >
    </div>
    <p class="map-boundary-notice" role="note">
      <strong>地图边界说明</strong>
      边界与行政区划图形仅供旅行记录参考，不代表权威或现行的地理边界与行政区划；具体情况请以主管部门公布的资料为准。
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
    >
      <div v-if="hoverInfo" class="map-hover-card" :style="hoverStyle" role="tooltip">
        <strong>{{ hoverInfo.title }}</strong>
        <small>{{ hoverInfo.detail }}</small>
        <span>{{ hoverInfo.state }}</span>
      </div>
    </div>
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
  </section>
</template>
