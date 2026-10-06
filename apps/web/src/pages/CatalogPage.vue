<script setup lang="ts">
import { computed, ref, toRef } from 'vue';
import { useRoute } from 'vue-router';
import { VISIT_LABELS, getScopeConfig, type Scope } from '@fangyu/contracts';
import { useAppStore } from '../app/store.js';
import MapSurface from '../components/MapSurface.vue';
import VisitStateSelect from '../components/VisitStateSelect.vue';
import CategoryEntryList from '../components/CategoryEntryList.vue';
import HeritageProjects from '../components/HeritageProjects.vue';
import TopicCoverage from '../components/TopicCoverage.vue';
import FootballGrounds from '../components/FootballGrounds.vue';
import NationalHeritage from '../components/NationalHeritage.vue';
import { exportCsv } from '../features/exports/download.js';
import { useCatalogNavigation } from '../features/catalog/use-catalog-navigation.js';
import { useCatalogEntries } from '../features/catalog/use-catalog-entries.js';

const props = defineProps<{ scope: Scope }>();
const store = useAppStore();
const route = useRoute();
const customName = ref('');
const localImportMessage = ref('');
const localImportBusy = ref(false);
const localMode = location.hostname === '127.0.0.1';
const session = computed(() => store.session!);
const emptyRecords = computed(() => {
  void store.revision;
  const snapshot = session.value.snapshot();
  return (
    !Object.values(snapshot.regions).some((state) => state !== 'unvisited') &&
    !Object.values(snapshot.entries).some(
      (record) => record.visited || record.subitemIds.length || record.stadiumExperiences?.length,
    )
  );
});
const index = computed(() => session.value.index);
const title = computed(() =>
  props.scope === 'china'
    ? '中国旅游手册'
    : props.scope === 'world'
      ? '世界旅游手册'
      : getScopeConfig(props.scope).title,
);
const scope = toRef(props, 'scope');
const {
  regions,
  selected,
  childRegions,
  visibleChildren,
  regionGroups,
  francePath,
  franceRoot,
  franceDepartment,
  franceDepartments,
  franceArrondissements,
  inIleDeFrance,
  inParis,
  franceStatistics,
  franceBack,
  province,
  city,
  cities,
  counties,
  level,
  changeLevel,
  focusedEntry,
  showAllChildren,
  select,
  locate,
} = useCatalogNavigation(scope);
const {
  query,
  status,
  descendants,
  railType,
  availableCategories,
  rows,
  searchRegions,
  mapPoints,
  focusCoordinates,
} = useCatalogEntries(scope, focusedEntry, regions);

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
</script>

<template>
  <section class="page-heading catalog-heading">
    <h2>{{ title }}</h2>
    <RouterLink
      v-if="['malaysia', 'singapore', 'brunei'].includes(scope) && route.path !== '/malay-region'"
      :to="{ path: '/malay-region', query: { country: scope } }"
      class="import-shortcut"
      >返回马新文专题</RouterLink
    >
    <RouterLink
      v-if="route.query.from === 'achievements'"
      to="/achievements"
      class="import-shortcut"
      >返回旅行成就</RouterLink
    >
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
      :value="
        scope === 'china'
          ? province
          : scope === 'france'
            ? franceRoot?.id || ''
            : store.selectedRegionId
      "
      @change="select(($event.target as HTMLSelectElement).value)"
    >
      <option value="">全部地区</option>
      <optgroup
        v-for="group in regionGroups"
        :key="group.label"
        :label="group.label"
      >
        <option
          v-for="region in group.items"
          :key="region.id"
          :value="region.id"
        >
          {{ region.name }}
        </option>
      </optgroup>
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
    <template v-if="scope === 'france' && inIleDeFrance">
      <select
        aria-label="法兰西岛省级单位"
        :value="franceDepartment?.id || ''"
        @change="select(($event.target as HTMLSelectElement).value || franceRoot!.id)"
      >
        <option value="">全部8个省级单位</option>
        <option
          v-for="region in franceDepartments"
          :key="region.id"
          :value="region.id"
        >
          {{ region.name }}
        </option>
      </select>
      <select
        v-if="inParis"
        aria-label="巴黎市区"
        :value="selected?.level === 3 ? selected.id : ''"
        @change="select(($event.target as HTMLSelectElement).value || franceDepartment!.id)"
      >
        <option value="">全部20个市区</option>
        <option
          v-for="region in franceArrondissements"
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
  <section
    v-if="scope === 'france'"
    class="france-drilldown"
    aria-label="法国分层导航与统计"
  >
    <nav
      class="toolbar"
      aria-label="法国地区路径"
    >
      <button @click="select('')">法国全部大区</button>
      <button
        v-for="region in francePath"
        :key="region.id"
        :aria-current="region.id === selected?.id ? 'location' : undefined"
        @click="select(region.id)"
      >
        {{ region.name }}
      </button>
      <button
        v-if="selected"
        @click="franceBack"
      >
        返回上一级
      </button>
    </nav>
    <div class="chip-list france-layer-statistics">
      <span
        v-for="item in franceStatistics"
        :key="item.label"
        >{{ item.label }}：已到访 {{ item.count }} / {{ item.total }}</span
      >
    </div>
  </section>
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
    <p
      v-if="!regions.length"
      class="note"
      role="status"
    >
      暂无地区数据。
    </p>
    <MapSurface
      v-if="regions.length"
      :scope="scope"
      :selected="store.selectedRegionId"
      :level="level"
      :category="store.category"
      :points="mapPoints"
      :focus="focusCoordinates"
      @select="select"
      @point="locatePoint"
      @level="changeLevel"
      @overview="select('')"
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
              {{
                scope === 'japan' && category.id === 'railway-station'
                  ? '日本铁道车站'
                  : category.name
              }}
            </option>
          </select>
          <span v-if="store.category && scope === 'china'"
            >配色：{{
              availableCategories.find((category) => category.id === store.category)?.name
            }}到访</span
          >
          <small v-if="mapPoints.some((entry) => entry.coordinateAttribution)"
            >部分球场坐标：© OpenStreetMap contributors ·
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
              >ODbL</a
            ></small
          >
        </div>
      </template>
    </MapSurface>
    <aside class="inspector">
      <h2>{{ selected?.name || title }}</h2>
      <details
        v-if="selected?.nameZh && selected.originalName"
        class="original-name"
      >
        <summary>原文名称 / Original name</summary>
        <span>{{ selected.originalName }}</span>
      </details>
      <VisitStateSelect
        v-if="selected"
        :region-id="selected.id"
        :propagate="scope !== 'france'"
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
          v-if="scope !== 'france' && childRegions.length > 18"
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
        选择地区或搜索地点。
      </p>
      <CategoryEntryList
        v-if="selected || query || focusedEntry || store.category"
        :rows="rows"
        :scope="scope"
        :selected-region-id="store.selectedRegionId"
        @locate="locate"
      />
      <HeritageProjects
        v-if="
          !store.category ||
          store.category === 'world-heritage' ||
          store.category === 'world-heritage-component'
        "
        :scope="scope"
        :region-id="store.selectedRegionId"
        :query="query"
        @locate="locate"
      />
      <FootballGrounds
        v-if="!store.category || store.category === 'football-stadium'"
        :scope="scope"
        @locate="locate"
      />
      <NationalHeritage
        v-if="!store.category || store.category.startsWith('vn-national-special')"
        :scope="scope"
        :region-id="store.selectedRegionId"
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
  <TopicCoverage :scope="scope" />
</template>
