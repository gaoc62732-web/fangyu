<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { VISIT_LABELS, type MapLevel, type Scope } from '@fangyu/contracts';
import type { EntryView } from '@fangyu/domain';
import { useAppStore } from '../app/store.js';
import MapSurface from '../components/MapSurface.vue';
import VisitStateSelect from '../components/VisitStateSelect.vue';
import CategoryEntryList from '../components/CategoryEntryList.vue';
import { exportCsv } from '../features/exports/download.js';

const props = defineProps<{ scope: Scope }>();
const store = useAppStore();
const query = ref('');
const status = ref('');
const descendants = ref(true);
const showAllChildren = ref(false);
const focusedEntry = ref('');
const customName = ref('');
const railType = ref('');
const localImportMessage = ref('');
const localImportBusy = ref(false);
const localMode = location.hostname === '127.0.0.1';
const session = computed(() => store.session!);
const emptyRecords = computed(() => {
  void store.revision;
  const snapshot = session.value.snapshot();
  return (
    !Object.values(snapshot.regions).some((state) => state !== 'unvisited') &&
    !Object.values(snapshot.entries).some((record) => record.visited || record.subitemIds.length)
  );
});
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
const availableCategories = computed(() => {
  const ids = new Set(
    index.value.catalog.entries
      .filter((entry) => index.value.entryRegions(entry, props.scope).length)
      .map((entry) => entry.categoryId),
  );
  return index.value.catalog.categories.filter((category) => ids.has(category.id));
});
const selected = computed(() => index.value.regions.get(store.selectedRegionId));
const childRegions = computed(() => index.value.children.get(store.selectedRegionId) || []);
const visibleChildren = computed(() =>
  showAllChildren.value ? childRegions.value : childRegions.value.slice(0, 18),
);
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
function changeLevel(value: Exclude<MapLevel, 'country'>) {
  level.value = value;
}
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
      (!railType.value || (railType.value === 'J'
        ? entry.railTypes?.includes('J')
        : entry.categoryId === 'railway-station' && !entry.railTypes?.includes('J'))) &&
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
  showAllChildren.value = false;
}

function locate(entry: EntryView) {
  const owner = index.value.entryRegions(entry, props.scope)[0];
  if (owner) store.selectedRegionId = owner;
  focusedEntry.value = entry.id;
  showAllChildren.value = false;
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

async function importLocalRecords() {
  if (localImportBusy.value) return;
  localImportBusy.value = true;
  localImportMessage.value = '';
  try {
    const response = await fetch('/local-records.json', { cache: 'no-store' });
    if (!response.ok) throw Error('本机迁移记录不存在，请使用「导入已有记录」选择 JSON 备份。');
    await store.restore(await response.json());
    localImportMessage.value = '旧版记录已载入并保存。';
  } catch (cause) {
    localImportMessage.value = String(cause);
  } finally {
    localImportBusy.value = false;
  }
}

watch(
  () => props.scope,
  () => {
    if (selected.value?.scope !== props.scope) store.selectedRegionId = '';
    focusedEntry.value = '';
    query.value = '';
    status.value = '';
    store.category = '';
    railType.value = '';
  },
  { immediate: true },
);
</script>

<template>
  <section class="page-heading catalog-heading">
    <h2>{{ title }}</h2>
    <p>点选地图查看地区与旅行内容。</p>
    <RouterLink
      to="/imports"
      class="import-shortcut"
      >导入已有记录 / 恢复备份</RouterLink
    >
    <button
      v-if="scope === 'china' && emptyRecords && localMode"
      class="import-shortcut"
      :disabled="localImportBusy"
      @click="importLocalRecords"
    >
      一键载入本机旧版记录
    </button>
    <span
      v-if="localImportMessage"
      role="status"
      >{{ localImportMessage }}</span
    >
  </section>
  <div class="toolbar catalog-primary-controls">
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
    </template>
    <input
      v-model="query"
      type="search"
      placeholder="搜索政区、地点、别名或线路"
      aria-label="搜索目录"
    />
    <details class="catalog-filter-panel">
      <summary>更多筛选与导出</summary>
      <div class="toolbar">
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
          <option value="R">其他铁道</option>
        </select>
        <button @click="csv">导出筛选 CSV</button>
        <button
          v-if="focusedEntry"
          @click="focusedEntry = ''"
        >
          清除项目定位
        </button>
      </div>
    </details>
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
      :points="scope === 'china' ? rows : []"
      @select="select"
      @point="locatePoint"
      @level="changeLevel"
    >
      <template #content-controls>
        <div class="map-content-controls">
          <label for="map-category">地图内容</label>
          <select
            id="map-category"
            v-model="store.category"
            aria-label="地图内容类别"
          >
            <option value="">全部类别</option>
            <option
              v-for="category in availableCategories"
              :key="category.id"
              :value="category.id"
            >
              {{ scope === 'japan' && category.id === 'railway-station' ? '日本铁道车站' : category.name }}
            </option>
          </select>
          <span>选择类别后，地图与右栏只显示该类内容。</span>
        </div>
      </template>
    </MapSurface>
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
      <section
        v-if="childRegions.length"
        class="inspector-children"
      >
        <h3>
          下辖地区 <small>{{ childRegions.length }}</small>
        </h3>
        <div class="child-region-list">
          <button
            v-for="child in visibleChildren"
            :key="child.id"
            @click="select(child.id)"
          >
            <i :style="{ background: store.colors[session.visitState(child.id)] }"></i>
            {{ child.name }}
            <small>{{ VISIT_LABELS[session.visitState(child.id)] }}</small>
          </button>
        </div>
        <button
          v-if="childRegions.length > 18"
          class="children-more"
          @click="showAllChildren = !showAllChildren"
        >
          {{ showAllChildren ? '收起下辖地区' : `显示全部 ${childRegions.length} 个地区` }}
        </button>
      </section>
      <p
        v-if="!selected && !query && !focusedEntry"
        class="inspector-prompt"
      >
        请先在地图上点选政区，或用上方搜索查找项目。
      </p>
      <CategoryEntryList
        v-else
        :rows="rows"
        :scope="scope"
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
