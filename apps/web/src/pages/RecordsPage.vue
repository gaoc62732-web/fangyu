<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { EntryView } from '@fangyu/domain';
import { useAppStore } from '../app/store.js';
import EntryList from '../components/EntryList.vue';
import { exportCsv } from '../features/exports/download.js';

const store = useAppStore();
const router = useRouter();
const scope = ref('china');
const category = ref('');
const query = ref('');
const status = ref('');
const railGroup = ref('');
const selectedRegionId = ref('');
const index = computed(() => store.session!.index);
const regions = computed(() => index.value.catalog.regions.filter((region) => region.scope === scope.value));
const roots = computed(() =>
  regions.value.filter((region) => !region.parentId || !regions.value.some((parent) => parent.id === region.parentId)),
);
const selectedPath = computed(() => index.value.ancestors(selectedRegionId.value));
const firstRegion = computed(() => selectedPath.value[0]?.id || '');
const secondRegion = computed(() => selectedPath.value[1]?.id || '');
const thirdRegion = computed(() => selectedPath.value[2]?.id || '');
const secondOptions = computed(() =>
  regions.value.filter((region) => region.parentId === firstRegion.value),
);
const thirdOptions = computed(() =>
  regions.value.filter((region) => region.parentId === secondRegion.value),
);
const categoryOptions = computed(() => {
  const ids = new Set(store.rows.filter((entry) => !scope.value || entry.scope === scope.value).map((entry) => entry.categoryId));
  return index.value.catalog.categories.filter((item) => ids.has(item.id));
});
type GroupedEntry = EntryView & { groupEntryIds?: string[]; regionPaths?: string[] };
const wideMonuments = computed(() => {
  const groups = new Map<string, { count: number; provinces: Set<string> }>();
  for (const entry of store.rows) {
    if (entry.scope !== 'china' || entry.categoryId !== 'cultural-monument') continue;
    const key = entry.name.trim();
    const group = groups.get(key) || { count: 0, provinces: new Set<string>() };
    group.count++;
    const root = index.value.ancestors(entry.regionIds[0] || '')[0];
    if (root) group.provinces.add(root.id);
    groups.set(key, group);
  }
  return new Set([...groups].filter(([, group]) => group.count >= 4 && group.provinces.size >= 3).map(([name]) => name));
});
function groupKey(entry: EntryView) {
  const base = `${entry.scope}:${entry.categoryId}:${entry.name.trim()}`;
  if (['world-heritage', 'national-park', 'global-geopark'].includes(entry.categoryId)) return base;
  const path = index.value.ancestors(entry.regionIds[0] || '');
  const province = path[0]?.id || entry.regionIds[0] || '';
  if (entry.categoryId === 'cultural-monument')
    return `${base}:${wideMonuments.value.has(entry.name.trim()) ? 'national' : province}`;
  if (['scenic-area', 'national-geopark', 'five-a-scenic'].includes(entry.categoryId))
    return `${base}:${province}`;
  if (entry.categoryId === 'urban-rail') return `${base}:${path.find((region) => region.level === 1)?.id || province}`;
  return `${entry.scope}:record:${entry.recordId}`;
}
const groupedRows = computed<GroupedEntry[]>(() => {
  const groups = new Map<string, EntryView[]>();
  for (const entry of store.rows) {
    if (scope.value && entry.scope !== scope.value) continue;
    const key = groupKey(entry);
    const members = groups.get(key) || [];
    members.push(entry);
    groups.set(key, members);
  }
  return [...groups.values()].map((members) => {
    const first = members[0]!;
    if (members.length === 1) return first;
    const regionIds = [...new Set(members.flatMap((member) => member.regionIds))];
    const regionPaths = regionIds.map((id) => index.value.paths.get(id) || id);
    const checked = members.every((member) => member.checked);
    return {
      ...first,
      regionIds,
      path: regionPaths.join('；'),
      regionPaths,
      groupEntryIds: [...new Set(members.map((member) => member.id))],
      checked,
      visited: members.some((member) => member.visited),
      partial: !checked && members.some((member) => member.visited),
      subitems: [],
    };
  });
});
watch(scope, () => {
  selectedRegionId.value = '';
  category.value = '';
  railGroup.value = '';
});
watch(category, () => { railGroup.value = ''; });
const rows = computed(() =>
  groupedRows.value.filter(
    (entry) =>
      (!selectedRegionId.value ||
        entry.regionIds.some((id) =>
          index.value.belongsTo(id, selectedRegionId.value),
        )) &&
      (!category.value || entry.categoryId === category.value) &&
      (!railGroup.value ||
        (railGroup.value === 'jr' ? entry.railTypes?.includes('J') : !entry.railTypes?.includes('J'))) &&
      (!status.value || entry.visited === (status.value === 'marked')) &&
      (!query.value ||
        [entry.name, entry.path, entry.code, ...entry.aliases]
          .join(' ')
          .toLowerCase()
          .includes(query.value.toLowerCase())),
  ),
);

function locate(entry: EntryView) {
  store.selectedRegionId = selectedRegionId.value && entry.regionIds.some((id) => index.value.belongsTo(id, selectedRegionId.value))
    ? selectedRegionId.value : entry.regionIds[0] || '';
  store.category = entry.categoryId;
  void router.push('/' + entry.scope);
}

function csv() {
  exportCsv(
    [
      ['ID', '范围', '类别', '名称', '所属地区', '到访', '部分标记', '备注', '来源'],
      ...rows.value.map((entry) => [
        entry.id,
        entry.scope,
        entry.categoryId,
        entry.name,
        entry.path,
        entry.checked,
        entry.partial,
        entry.note,
        entry.source,
      ]),
    ],
    '方舆要素列表.csv',
  );
}
</script>

<template>
  <section class="page-heading">
    <h2>要素列表</h2>
    <p>先选地区，再按类别查看、标记和导出。跨政区的同一项目合并显示；勾选会同步更新其全部所属政区记录。</p>
  </section>
  <div class="toolbar">
    <input
      v-model="query"
      type="search"
      placeholder="名称、地区、代码或别名"
      aria-label="搜索要素"
    />
    <select
      v-model="scope"
      aria-label="范围"
    >
      <option value="">全部范围</option>
      <option value="china">中国</option>
      <option value="world">世界</option>
      <option value="japan">日本</option>
      <option value="korea">韩国</option>
    </select>
    <label v-if="scope" class="records-region-filter">
      地区
      <select
        :value="firstRegion"
        aria-label="一级地区"
        @change="selectedRegionId = ($event.target as HTMLSelectElement).value"
      >
        <option value="">全部地区</option>
        <option v-for="region in roots" :key="region.id" :value="region.id">{{ region.name }}</option>
      </select>
    </label>
    <label v-if="firstRegion && secondOptions.length" class="records-region-filter">
      下级地区
      <select
        :value="secondRegion"
        aria-label="二级地区"
        @change="selectedRegionId = ($event.target as HTMLSelectElement).value || firstRegion"
      >
        <option value="">全部下级地区</option>
        <option v-for="region in secondOptions" :key="region.id" :value="region.id">{{ region.name }}</option>
      </select>
    </label>
    <label v-if="secondRegion && thirdOptions.length" class="records-region-filter">
      县区
      <select
        :value="thirdRegion"
        aria-label="三级地区"
        @change="selectedRegionId = ($event.target as HTMLSelectElement).value || secondRegion"
      >
        <option value="">全部县区</option>
        <option v-for="region in thirdOptions" :key="region.id" :value="region.id">{{ region.name }}</option>
      </select>
    </label>
    <select
      v-model="category"
      aria-label="类别"
    >
      <option value="">全部类别</option>
      <option
        v-for="item in categoryOptions"
        :key="item.id"
        :value="item.id"
      >
        {{ scope === 'japan' && item.id === 'railway-station' ? '日本铁道车站' : item.name }}
      </option>
    </select>
    <select
      v-if="scope === 'japan' && category === 'railway-station'"
      v-model="railGroup"
      aria-label="日本铁道分类"
    >
      <option value="">全部铁道车站</option>
      <option value="jr">JR 车站</option>
      <option value="other">其他铁道车站</option>
    </select>
    <select
      v-model="status"
      aria-label="到访状态"
    >
      <option value="">全部状态</option>
      <option value="marked">已标记（含部分）</option>
      <option value="blank">未标记</option>
    </select>
    <button @click="csv">导出筛选结果 CSV</button>
  </div>
  <p v-if="selectedRegionId" class="records-region-path">
    当前地区：{{ index.paths.get(selectedRegionId) }}
    <button type="button" @click="selectedRegionId = ''">清除地区</button>
  </p>
  <section class="card">
    <EntryList
      :rows="rows"
      :page-size="100"
      @locate="locate"
    />
  </section>
</template>
