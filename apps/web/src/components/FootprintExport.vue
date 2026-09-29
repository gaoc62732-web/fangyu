<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import { VISIT_LABELS, type Scope } from '@fangyu/contracts';
import { footprintPng, type RenderFeature } from '@fangyu/map-renderer';
import type { MapViewState } from '../app/workspace.js';
import { SCOPE_NAMES } from '../app/workspace.js';
import { useAppStore } from '../app/store.js';
import { download } from '../features/exports/download.js';
import AppDialog from './AppDialog.vue';
const props = defineProps<{ scope: Scope; regionId: string; state: MapViewState }>();
defineEmits<{ close: [] }>();
const store = useAppStore(),
  selected = ref(!!props.regionId),
  double = ref(false),
  showPoints = ref(false),
  url = ref(''),
  busy = ref(false),
  error = ref('');
let blob: Blob | undefined,
  serial = 0;
async function preview() {
  const ticket = ++serial;
  busy.value = true;
  error.value = '';
  try {
    const response = await fetch(import.meta.env.BASE_URL + 'maps/' + props.scope + '.json');
    if (!response.ok) throw Error('导出边界加载失败');
    const data: GeoJSON.FeatureCollection = await response.json();
    const session = store.session!,
      regionId = selected.value ? props.regionId : '';
    const scoped = data.features.filter(
      (f) =>
        f.properties?.level !== 'border' &&
        (!regionId || session.index.belongsTo(String(f.properties?.regionId), regionId)),
    );
    let chosen = scoped.filter((f) => f.properties?.level === props.state.level);
    if (!chosen.length) chosen = scoped.filter((f) => f.properties?.regionId === regionId);
    const marked = new Set<string>();
    if (props.state.colorCategory)
      for (const e of store.rows)
        if (e.categoryId === props.state.colorCategory && e.visited)
          for (const id of session.index.entryRegions(e, props.scope))
            for (const r of session.index.ancestors(id)) marked.add(r.id);
    const features: RenderFeature[] = chosen.map((f) => {
      const id = String(f.properties?.regionId);
      return {
        id,
        name: String(f.properties?.name || ''),
        geometry: f.geometry,
        fill: store.colors[
          props.state.colorCategory
            ? marked.has(id)
              ? 'arrived'
              : 'unvisited'
            : session.visitState(id)
        ],
      };
    });
    const entries = session
      .entries(props.scope)
      .filter(
        (e) =>
          !regionId ||
          session.index
            .entryRegions(e, props.scope)
            .some((id) => session.index.belongsTo(id, regionId)),
      );
    const points = showPoints.value
      ? entries
          .filter(
            (e) =>
              e.coordinates &&
              e.visited &&
              (!props.state.colorCategory || e.categoryId === props.state.colorCategory),
          )
          .map((e) => ({ id: e.id, name: e.name, coords: e.coordinates!, marked: true }))
      : [];
    const category = session.index.catalog.categories.find(
      (c) => c.id === props.state.colorCategory,
    )?.name;
    const legend = category
      ? [
          { label: category + '未标记', color: store.colors.unvisited },
          { label: category + '已标记', color: store.colors.arrived },
        ]
      : Object.entries(VISIT_LABELS).map(([state, label]) => ({
          label,
          color: store.colors[state as keyof typeof VISIT_LABELS],
        }));
    const result = await footprintPng(features, points, {
      width: double.value ? 3840 : 1920,
      title:
        (regionId ? session.index.regions.get(regionId)?.name : SCOPE_NAMES[props.scope]) +
        ' · 我的旅行足迹',
      subtitle:
        entries.filter((e) => e.visited).length +
        ' / ' +
        entries.length +
        ' 项目已标记 · ' +
        features.filter((f) => session.arrived(f.id)).length +
        ' / ' +
        features.length +
        ' 地区已到达',
      world: props.scope === 'world',
      legend,
    });
    if (ticket !== serial) return;
    if (url.value) URL.revokeObjectURL(url.value);
    blob = result;
    url.value = URL.createObjectURL(result);
  } catch (cause) {
    if (ticket === serial) error.value = String(cause);
  } finally {
    if (ticket === serial) busy.value = false;
  }
}
watch([selected, double, showPoints, () => store.revision], preview, { immediate: true });
onBeforeUnmount(() => {
  serial++;
  if (url.value) URL.revokeObjectURL(url.value);
});
</script>
<template>
  <AppDialog
    title="导出我的旅行足迹"
    @close="$emit('close')"
    ><div class="toolbar">
      <label v-if="regionId"
        ><input
          v-model="selected"
          type="checkbox"
        />仅当前地区</label
      ><label
        ><input
          v-model="double"
          type="checkbox"
        />两倍尺寸 · 3840px</label
      ><label
        ><input
          v-model="showPoints"
          type="checkbox"
        />显示已标记项目点</label
      >
    </div>
    <p class="note">使用手册边界生成，不依赖在线底图。</p>
    <p
      v-if="busy"
      role="status"
    >
      正在绘制图片…
    </p>
    <p
      v-if="error"
      class="inline-error"
      role="alert"
    >
      {{ error }}
    </p>
    <img
      v-if="url"
      :src="url"
      alt="足迹图片预览"
      class="export-preview"
    /><button
      class="primary"
      :disabled="busy || !!error || !url"
      @click="blob && download(blob, '方舆旅行足迹.png')"
    >
      下载 PNG
    </button></AppDialog
  >
</template>
