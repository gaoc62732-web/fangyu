<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { VISIT_LABELS, getScopeConfig, type MapLevel, type Scope } from '@fangyu/contracts';
import type { EntryView } from '@fangyu/domain';
import { useAppStore } from '../app/store.js';
import MapSurface from '../components/MapSurface.vue';
import VisitStateSelect from '../components/VisitStateSelect.vue';
import CategoryEntryList from '../components/CategoryEntryList.vue';
import HeritageProjects from '../components/HeritageProjects.vue';
import TopicCoverage from '../components/TopicCoverage.vue';
import FootballGrounds from '../components/FootballGrounds.vue';
import NationalHeritage from '../components/NationalHeritage.vue';
import { exportCsv } from '../features/exports/download.js';
import { searchText } from '../features/search-text.js';

const props = defineProps<{ scope: Scope }>();
const store = useAppStore();
const route = useRoute();
const router = useRouter();
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
  props.scope === 'france' || showAllChildren.value
    ? childRegions.value
    : childRegions.value.slice(0, 18),
);
const roots = computed(() =>
  regions.value.filter((region) =>
    props.scope === 'china'
      ? region.level === 0
      : props.scope === 'france'
        ? region.level === 1
        : true,
  ),
);
const regionGroups = computed(() => {
  const groups = new Map<string, typeof roots.value>();
  for (const region of roots.value) {
    const label =
      props.scope === 'france'
        ? region.kind?.startsWith('metropolitan-')
          ? '法国本土（13）'
          : '海外地区层级（5）'
        : props.scope === 'usa'
          ? region.kind === 'state'
            ? '州（50）'
            : '哥伦比亚特区（1）'
          : props.scope === 'spain'
            ? region.kind === 'autonomous-community'
              ? '自治社区（17）'
              : '自治市（2）'
            : props.scope === 'uk'
              ? region.constituentCountry || '历史郡'
              : props.scope === 'malaysia'
                ? region.kind === 'state'
                  ? '州（13） · States'
                  : '联邦直辖区（3） · Federal territories'
                : props.scope === 'thailand'
                  ? region.kind === 'special-administrative-area'
                    ? '曼谷 · Bangkok'
                    : '府（76） · Provinces'
                  : getScopeConfig(props.scope).boundaryLabel;
    groups.set(label, [...(groups.get(label) || []), region]);
  }
  return [...groups].map(([label, items]) => ({ label, items }));
});
const path = computed(() => index.value.ancestors(store.selectedRegionId));
const francePath = computed(() => path.value.filter((region) => region.scope === 'france'));
const franceRoot = computed(() => francePath.value.find((region) => region.level === 1));
const franceDepartment = computed(() => francePath.value.find((region) => region.level === 2));
const franceDepartments = computed(() => regions.value.filter((region) => region.level === 2));
const franceArrondissements = computed(() => regions.value.filter((region) => region.level === 3));
const inIleDeFrance = computed(() => franceRoot.value?.code === 'FR-IDF');
const inParis = computed(() => franceDepartment.value?.sourceCode === '75');
const franceStatistics = computed(() => {
  void store.revision;
  return [
    { label: '法国大区', items: roots.value },
    { label: '法兰西岛省级单位', items: franceDepartments.value },
    { label: '巴黎市区', items: franceArrondissements.value },
  ].map(({ label, items }) => ({
    label,
    total: items.length,
    count: items.filter((region) => session.value.arrived(region.id)).length,
  }));
});
function franceBack() {
  select(francePath.value.at(-2)?.id || '');
}
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
    if (props.scope === 'france')
      return inParis.value ? 'county' : inIleDeFrance.value ? 'city' : 'province';
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
    const text = searchText(
      [
        entry.name,
        entry.path,
        entry.code,
        entry.description,
        ...entry.aliases,
        ...(entry.lines || []),
        ...(entry.operators || []),
      ].join(' '),
    );
    return (
      owners.length &&
      within &&
      (!store.category || entry.categoryId === store.category) &&
      (!status.value || entry.visited === (status.value === 'visited')) &&
      (!focusedEntry.value || entry.id === focusedEntry.value) &&
      (!railType.value ||
        (railType.value === 'J'
          ? entry.railTypes?.includes('J')
          : entry.categoryId === 'railway-station' && !entry.railTypes?.includes('J'))) &&
      (!query.value || text.includes(searchText(query.value.trim())))
    );
  }),
);
const searchRegions = computed(() =>
  query.value.trim()
    ? regions.value
        .filter((region) =>
          searchText([region.name, region.code, ...region.aliases].join(' ')).includes(
            searchText(query.value.trim()),
          ),
        )
        .slice(0, 40)
    : [],
);
const mapPoints = computed(() =>
  (props.scope === 'china' || store.category
    ? rows.value
    : rows.value.filter((entry) =>
        ['world-heritage-component', 'football-stadium', 'vn-national-special-component'].includes(
          entry.categoryId,
        ),
      )
  ).filter((entry) => !entry.coordinateReferenceOnly && entry.ordinaryPointEligible !== false),
);
const focusCoordinates = computed(() => {
  const entry = index.value.entries.get(focusedEntry.value);
  return entry?.coordinateReferenceOnly ||
    entry?.ordinaryPointEligible === false ||
    entry?.coordinateStatus?.includes('representative')
    ? null
    : entry?.coordinates || null;
});

function select(id: string) {
  store.selectedRegionId = id;
  focusedEntry.value = '';
  showAllChildren.value = false;
  if (props.scope === 'france' && (route.query.region || '') !== id) {
    void router.push({ query: { ...route.query, region: id || undefined } });
  }
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
watch(
  [() => route.query.region, () => props.scope],
  ([id]) => {
    if (typeof id === 'string' && index.value.regions.get(id)?.scope === props.scope) {
      store.selectedRegionId = id;
      focusedEntry.value = '';
    } else if (props.scope === 'france') {
      store.selectedRegionId = '';
      focusedEntry.value = '';
    }
  },
  { immediate: true },
);
</script>

<template>
  <section class="page-heading catalog-heading">
    <h2>{{ title }}</h2>
    <p>点选地图查看地区与旅行内容。</p>
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
  <TopicCoverage :scope="scope" />
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
    <p class="note">
      各层分别记录、分别计数，不合并为一个总数。标记大区不会填充下级；本页地区状态也不会自动修改上级。仅法兰西岛开放省级下钻，巴黎开放20区；Paris
      Centre 为第1—4区合署管理，仍保留20个地理区。
    </p>
    <p
      v-if="selected && selected.level > 1"
      class="note"
    >
      现有地点保留原大区归属，尚未分配到省或市区；此层地点列表可能为空。
    </p>
    <details class="note">
      <summary>下钻边界来源与许可</summary>
      <p>
        省界：<a
          href="https://www.data.gouv.fr/datasets/contours-administratifs"
          target="_blank"
          rel="noopener noreferrer"
          >data.gouv.fr Contours administratifs</a
        >，2025年100米简化版；巴黎区界：<a
          href="https://opendata.paris.fr/explore/dataset/arrondissements/information/"
          target="_blank"
          rel="noopener noreferrer"
          >Ville de Paris — Arrondissements</a
        >，来源元数据修改日期2016-03-04。均按
        <a
          href="https://opendatacommons.org/licenses/odbl/1.0/"
          target="_blank"
          rel="noopener noreferrer"
          >ODbL 1.0</a
        >
        使用，层间边缘可能有精度差异。成员清单按INSEE COG 2026核对。
      </p>
    </details>
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
      此国家专题的数据仍在核验，尚未接入当前预览。区划、遗产点和球场不以缺失数据或代表坐标冒充完整收录。
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
          <span>选择类别后，地图与右栏只显示该类内容。</span>
          <span v-if="store.category && scope === 'china'"
            >当前颜色反映该类别的地点记录；查看地区造访颜色请选择“全部类别”。</span
          >
          <span v-else-if="store.category">点位与列表按类别筛选，区域底色保留地区造访状态。</span>
          <small v-if="mapPoints.some((entry) => entry.coordinateAttribution)"
            >部分球场坐标：© OpenStreetMap contributors ·
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
              >ODbL</a
            >；逐地点来源见列表。</small
          >
        </div>
      </template>
    </MapSurface>
    <aside class="inspector">
      <h2>{{ selected?.name || title }}</h2>
      <small v-if="selected?.nameTranslationNeedsReview">译名待核 / Provisional name</small>
      <details
        v-if="selected?.nameZh && selected.originalName"
        class="original-name"
      >
        <summary>原文名称 / Original name</summary>
        <span>{{ selected.originalName }}</span>
        <small v-if="selected.nameTranslationNote">{{ selected.nameTranslationNote }}</small>
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
        请先在地图上点选政区，或用上方搜索查找项目。
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
</template>
