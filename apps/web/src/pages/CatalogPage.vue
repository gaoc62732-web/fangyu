<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Scope } from '@fangyu/contracts';
import type { EntryView } from '@fangyu/domain';
import { useAppStore } from '../app/store.js';
import MapSurface from '../components/MapSurface.vue';
import VisitStateSelect from '../components/VisitStateSelect.vue';
import EntryList from '../components/EntryList.vue';
import { exportCsv } from '../features/exports/download.js';

const props = defineProps<{ scope: Scope }>();
const store = useAppStore();
const query = ref('');
const status = ref('');
const descendants = ref(true);
const focusedEntry = ref('');
const customName = ref('');
const railType = ref('');
const session = computed(() => store.session!);
const index = computed(() => session.value.index);
const title = computed(
  () =>
    ({ china: '中国旅游手册', world: '世界旅游手册', japan: '日本专题', korea: '韩国专题' })[
      props.scope
    ],
);
const regions = computed(() =>
  index.value.catalog.regions.filter((region) => region.scope === props.scope),
);
const selected = computed(() => index.value.regions.get(store.selectedRegionId));
const roots = computed(() =>
  regions.value.filter((region) => (props.scope === 'china' ? region.level === 0 : true)),
);
const path = computed(() => index.value.ancestors(store.selectedRegionId));
const province = computed(
  () => path.value.find((region) => region.scope === 'china' && region.level === 0)?.id || '',
);
const city = computed(
  () => path.value.find((region) => region.scope === 'china' && region.level === 1)?.id || '',
);
const cities = computed(() =>
  regions.value.filter((region) => region.parentId === province.value && region.level === 1),
);
const counties = computed(() =>
  regions.value.filter(
    (region) =>
      region.level === 2 &&
      province.value &&
      index.value.belongsTo(region.id, city.value || province.value),
  ),
);
const level = computed({
  get: () => {
    void store.revision;
    return session.value.preferences.mapLevel;
  },
  set: (value) => {
    store.commit((current) => current.updatePreferences({ mapLevel: value }));
  },
});
const rows = computed(() =>
  store.rows.filter((entry) => {
    const owners = index.value.entryRegions(entry, props.scope);
    const within =
      !store.selectedRegionId ||
      owners.some((id) =>
        descendants.value
          ? index.value.belongsTo(id, store.selectedRegionId)
          : id === store.selectedRegionId,
      );
    const text = [
      entry.name,
      entry.path,
      entry.code,
      entry.description,
      ...entry.aliases,
      ...(entry.lines || []),
      ...(entry.operators || []),
    ]
      .join(' ')
      .toLocaleLowerCase();
    return (
      owners.length &&
      within &&
      (!store.category || entry.categoryId === store.category) &&
      (!status.value || entry.visited === (status.value === 'visited')) &&
      (!focusedEntry.value || entry.id === focusedEntry.value) &&
      (!railType.value || entry.railTypes?.includes(railType.value)) &&
      (!query.value || text.includes(query.value.trim().toLocaleLowerCase()))
    );
  }),
);
const searchRegions = computed(() =>
  query.value.trim()
    ? regions.value
        .filter((region) =>
          [region.name, region.code, ...region.aliases].join(' ').includes(query.value.trim()),
        )
        .slice(0, 40)
    : [],
);

function select(id: string) {
  store.selectedRegionId = id;
  focusedEntry.value = '';
}

function locate(entry: EntryView) {
  const owner = index.value.entryRegions(entry, props.scope)[0];
  if (owner) store.selectedRegionId = owner;
  focusedEntry.value = entry.id;
}

function locatePoint(id: string) {
  const entry = store.rows.find((item) => item.id === id);
  if (entry) locate(entry);
}

function addEntry() {
  if (!selected.value || !store.category) return;
  if (
    store.commit((current) => current.addEntry(selected.value!, store.category, customName.value))
  ) {
    customName.value = '';
  }
}

function csv() {
  exportCsv(
    [
      ['项目 ID', '名称', '地区', '类别', '到访', '部分到访', '备注', '来源'],
      ...rows.value.map((entry) => [
        entry.id,
        entry.name,
        entry.path,
        entry.categoryId,
        entry.checked,
        entry.partial,
        entry.note,
        entry.source,
      ]),
    ],
    title.value + '.csv',
  );
}

watch(
  () => props.scope,
  () => {
    if (selected.value?.scope !== props.scope) store.selectedRegionId = '';
    focusedEntry.value = '';
    query.value = '';
    store.category = '';
    railType.value = '';
  },
  { immediate: true },
);
</script>

<template>
  <section class="page-heading">
    <h2>{{ title }}</h2>
    <p>从地图或目录选择地区，记录到访和旅行内容。</p>
  </section>
  <div class="toolbar">
    <select
      aria-label="地区"
      :value="scope === 'china' ? province : store.selectedRegionId"
      @change="select(($event.target as HTMLSelectElement).value)"
    >
      <option value="">全部地区</option>
      <option
        v-for="region in roots"
        :key="region.id"
        :value="region.id"
      >
        {{ region.name }}
      </option>
    </select>
    <template v-if="scope === 'china'">
      <select
        :value="city"
        aria-label="地市"
        @change="select(($event.target as HTMLSelectElement).value || province)"
      >
        <option value="">全部地市</option>
        <option
          v-for="region in cities"
          :key="region.id"
          :value="region.id"
        >
          {{ region.name }}
        </option>
      </select>
      <select
        :value="selected?.level === 2 ? selected.id : ''"
        aria-label="县区"
        @change="select(($event.target as HTMLSelectElement).value || city || province)"
      >
        <option value="">全部县区</option>
        <option
          v-for="region in counties"
          :key="region.id"
          :value="region.id"
        >
          {{ region.name }}
        </option>
      </select>
      <select
        v-model="level"
        aria-label="地图层级"
      >
        <option value="province">省级地图</option>
        <option value="city">地市地图</option>
        <option value="county">县区地图</option>
      </select>
    </template>
    <select
      v-model="store.category"
      aria-label="项目类别"
    >
      <option value="">全部类别</option>
      <option
        v-for="category in index.catalog.categories"
        :key="category.id"
        :value="category.id"
      >
        {{ category.name }}
      </option>
    </select>
    <select
      v-model="status"
      aria-label="到访筛选"
    >
      <option value="">全部记录</option>
      <option value="visited">已标记</option>
      <option value="unvisited">未标记</option>
    </select>
    <select
      v-if="scope === 'japan'"
      v-model="railType"
      aria-label="日本铁路类型"
    >
      <option value="">全部铁路类型</option>
      <option value="J">JR</option>
      <option value="R">其他轨道</option>
    </select>
    <input
      v-model="query"
      type="search"
      placeholder="搜索地区、地点、别名、线路"
      aria-label="搜索目录"
    />
    <button @click="csv">导出筛选 CSV</button>
    <button
      v-if="focusedEntry"
      @click="focusedEntry = ''"
    >
      清除项目定位
    </button>
  </div>
  <div
    v-if="searchRegions.length"
    class="chip-list"
  >
    <button
      v-for="region in searchRegions"
      :key="region.id"
      @click="
        select(region.id);
        query = '';
      "
    >
      {{ index.paths.get(region.id) }}
    </button>
  </div>
  <div class="map-layout">
    <MapSurface
      :scope="scope"
      :selected="store.selectedRegionId"
      :level="level"
      :category="store.category"
      :points="rows"
      @select="select"
      @point="locatePoint"
    />
    <aside class="inspector">
      <h2>{{ selected?.name || title }}</h2>
      <VisitStateSelect
        v-if="selected"
        :region-id="selected.id"
      />
      <p
        v-if="selected"
        class="note"
      >
        {{ index.paths.get(selected.id) }}
      </p>
      <label v-if="scope === 'china'"
        ><input
          v-model="descendants"
          type="checkbox"
        />包含下辖地区</label
      >
      <div
        v-if="selected"
        class="chip-list"
      >
        <button
          v-for="child in index.children.get(selected.id)"
          :key="child.id"
          @click="select(child.id)"
        >
          {{ child.name }}
        </button>
      </div>
      <EntryList
        :rows="rows"
        :selected-region-id="store.selectedRegionId"
        @locate="locate"
      />
      <form
        v-if="selected && store.category"
        @submit.prevent="addEntry"
      >
        <h3>增加个人项目</h3>
        <input
          v-model="customName"
          required
          maxlength="1000"
          placeholder="项目名称"
          aria-label="个人项目名称"
        />
        <button type="submit">添加</button>
      </form>
    </aside>
  </div>
</template>
