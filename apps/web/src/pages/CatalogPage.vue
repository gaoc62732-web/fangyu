<script setup lang="ts">
import { computed, nextTick, onActivated, ref, shallowRef, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { HandbookSession } from '@fangyu/domain';
import type { Scope } from '@fangyu/contracts';
import { useAppStore } from '../app/store.js';
import { useWorkspace, SCOPE_NAMES, type Bounds, type CatalogQuery } from '../app/workspace.js';
import type { CatalogQueryResult } from '../features/catalog/query.js';
import { CATEGORY_GROUPS } from '../features/catalog/categories.js';
import MapSurface from '../components/MapSurface.vue';
import CatalogList from '../components/CatalogList.vue';
import EntryDetails from '../components/EntryDetails.vue';
import VisitStateSelect from '../components/VisitStateSelect.vue';
import AppDialog from '../components/AppDialog.vue';
import FootprintExport from '../components/FootprintExport.vue';
import { exportCsv } from '../features/exports/download.js';
const store = useAppStore(),
  workspace = useWorkspace(),
  route = useRoute(),
  router = useRouter();
const scope = computed(() => workspace.state.scope);
const current = computed(() => workspace.state.scopes[scope.value]);
const index = computed(() => store.session!.index);
const region = computed(() => index.value.regions.get(current.value.selectedRegion));
const map = ref<InstanceType<typeof MapSurface>>(),
  detail = ref<InstanceType<typeof EntryDetails>>();
const regionPicker = ref(false),
  regionSearch = ref(''),
  pickerParent = ref('');
const categoryPicker = ref(false),
  addOpen = ref(false),
  exportOpen = ref(false);
const personalName = ref(''),
  personalCategory = ref('world-heritage');
const batch = ref(false),
  batchSelected = ref(new Set<string>()),
  batchReview = ref(false),
  batchVisited = ref(true);
const candidates = ref<string[]>([]),
  previewRegion = ref('');
const retainedIds = ref<string[]>([]);
const busy = ref(false),
  queryError = ref(''),
  requestSerial = ref(0);
const emptyResult = (): CatalogQueryResult => ({
  ids: [],
  groups: [],
  coordinateCount: 0,
  regions: [],
});
const result = shallowRef<CatalogQueryResult>(emptyResult());
const rowMap = computed(() => new Map(store.rows.map((e) => [e.id, e])));
const rows = computed(() =>
  result.value.ids.map((id) => rowMap.value.get(id)).filter((e): e is NonNullable<typeof e> => !!e),
);
const pointRows = computed(() => rows.value.filter((e) => e.coordinates));
const scopeCategories = computed(() => {
  const ids = new Set(
    store.rows
      .filter((e) => index.value.entryRegions(e, scope.value).length)
      .map((e) => e.categoryId),
  );
  return index.value.catalog.categories.filter((c) => ids.has(c.id));
});
const categoryName = (id: string) =>
  index.value.catalog.categories.find((c) => c.id === id)?.name || id;
const query = computed<CatalogQuery>(() => ({
  scope: scope.value,
  regionId:
    current.value.mode === 'region' || current.value.restrictTheme
      ? current.value.selectedRegion
      : '',
  descendants: current.value.descendants,
  categories: [...current.value.categories],
  text: current.value.query,
  status: current.value.status,
  missingCoordinates: current.value.missingCoordinates,
  railType: current.value.railType,
  bounds: current.value.bounds,
  retainedIds: [...retainedIds.value],
}));
const scopeLabel = computed(() =>
  query.value.regionId
    ? index.value.paths.get(query.value.regionId)
    : SCOPE_NAMES[scope.value] + '全域',
);
const contextKey = computed(() =>
  JSON.stringify({ ...query.value, retainedIds: [], mode: current.value.mode }),
);
const directoryContexts = new Map<string, { scroll: number; expanded: Record<string, boolean> }>();
watch(contextKey, (key, previous) => {
  const previousScope = JSON.parse(previous).scope as Scope;
  const prior = workspace.state.scopes[previousScope];
  directoryContexts.set(previous, { scroll: prior.scroll, expanded: { ...prior.expanded } });
  if (directoryContexts.size > 40) directoryContexts.delete(directoryContexts.keys().next().value!);
  const saved = directoryContexts.get(key);
  current.value.scroll = saved?.scroll || 0;
  current.value.expanded = saved ? { ...saved.expanded } : {};
});
const title = computed(() =>
  current.value.mode === 'theme'
    ? current.value.categories.length === 1
      ? categoryName(current.value.categories[0]!)
      : '类别探索'
    : region.value?.name || SCOPE_NAMES[scope.value] + '旅行手册',
);
const pickerRows = computed(() =>
  index.value.catalog.regions
    .filter(
      (r) =>
        r.scope === scope.value &&
        (regionSearch.value.trim()
          ? [r.name, r.code, ...r.aliases, index.value.paths.get(r.id)]
              .join(' ')
              .includes(regionSearch.value.trim())
          : r.parentId === (pickerParent.value || null)),
    )
    .slice(0, 80),
);
const children = computed(() => index.value.children.get(current.value.selectedRegion) || []);
const path = computed(() => index.value.ancestors(current.value.selectedRegion));
const guard = () => !current.value.detail || detail.value?.canLeave() !== false;
function clearDetail() {
  current.value.detail = '';
  current.value.detailRegion = '';
  candidates.value = [];
  previewRegion.value = '';
}
function openEntry(id: string) {
  if (!guard()) return;
  current.value.detail = id;
  current.value.detailRegion = query.value.regionId;
  current.value.collapsed = false;
  candidates.value = [];
  previewRegion.value = '';
}
function selectRegion(id: string, fit = true) {
  if (!guard()) return;
  clearDetail();
  current.value.selectedRegion = id;
  if (scope.value === 'china') {
    const level = index.value.regions.get(id)?.level;
    if (level === 2) current.value.map.level = 'county';
    else if (level === 1 && current.value.map.level === 'province')
      current.value.map.level = 'city';
  }
  current.value.mode = 'region';
  current.value.categories = [];
  current.value.query = '';
  current.value.bounds = null;
  current.value.missingCoordinates = false;
  regionPicker.value = false;
  current.value.collapsed = false;
  if (fit) nextTick(() => map.value?.fitRegion(id));
}
function mapRegion(id: string) {
  if (current.value.mode === 'theme') {
    if (!guard()) return;
    clearDetail();
    previewRegion.value = id;
    current.value.collapsed = false;
  } else selectRegion(id, false);
}
function startTheme(ids: string[]) {
  if (!guard()) return;
  clearDetail();
  current.value.mode = 'theme';
  current.value.categories = ids;
  current.value.restrictTheme = false;
  current.value.bounds = null;
  current.value.query = '';
  current.value.missingCoordinates = false;
  categoryPicker.value = false;
  current.value.collapsed = false;
}
function toggleCategory(id: string) {
  const set = new Set(current.value.mode === 'theme' ? current.value.categories : []);
  set.has(id) ? set.delete(id) : set.add(id);
  startTheme([...set]);
  categoryPicker.value = true;
}
function changeScope(value: string) {
  if (!guard()) return;
  workspace.state.scope = value as Scope;
  result.value = emptyResult();
  retainedIds.value = [];
  batchSelected.value = new Set();
  previewRegion.value = '';
  candidates.value = [];
}
function context(id: string) {
  const entry = rowMap.value.get(id)!;
  const owners = index.value.entryRegions(entry, scope.value);
  return owners.includes(query.value.regionId)
    ? query.value.regionId
    : owners.length === 1
      ? owners[0]!
      : '';
}
function mark(id: string, value: boolean, subitem?: string) {
  const owner = context(id);
  const entry = rowMap.value.get(id)!;
  if (value && !owner && index.value.entryRegions(entry, scope.value).length > 1) {
    openEntry(id);
    store.notice = '请选择本次实际到访地区，再标记项目。';
    return;
  }
  record(id, value, owner, subitem);
}
function record(id: string, value: boolean, owner: string, subitem?: string) {
  retainedIds.value = [...new Set([...retainedIds.value, id])];
  store.recordEntry(id, value, owner || undefined, subitem);
}
function searchArea(bounds: Bounds) {
  if (!guard()) return;
  clearDetail();
  current.value.bounds = bounds;
}
function resetFilters() {
  current.value.query = '';
  current.value.status = '';
  current.value.missingCoordinates = false;
  current.value.railType = '';
  current.value.bounds = null;
}
function toggleBatch(id: string) {
  const set = new Set(batchSelected.value);
  set.has(id) ? set.delete(id) : set.add(id);
  batchSelected.value = set;
}
const batchImpact = computed(() => {
  void store.revision;
  const session = new HandbookSession(index.value, store.session!.snapshot());
  const before = session.snapshot().regions;
  let ambiguous = 0;
  for (const id of batchSelected.value) {
    if (!rowMap.value.has(id)) continue;
    const owner = context(id);
    if (
      batchVisited.value &&
      !owner &&
      index.value.entryRegions(rowMap.value.get(id)!, scope.value).length > 1
    ) {
      ambiguous++;
      continue;
    }
    session.markEntry(id, batchVisited.value, owner || undefined);
  }
  return {
    regions: Object.keys(session.snapshot().regions).filter(
      (id) => before[id] !== session.visitState(id),
    ),
    ambiguous,
  };
});
function applyBatch() {
  if (batchImpact.value.ambiguous) return;
  const ids = [...batchSelected.value];
  if (
    store.commit((s) => {
      for (const id of ids) s.markEntry(id, batchVisited.value, context(id) || undefined);
    })
  ) {
    retainedIds.value = [...new Set([...retainedIds.value, ...ids])];
    store.notice =
      '已批量' + (batchVisited.value ? '记录' : '取消') + ' ' + ids.length + ' 个项目，可一次撤销';
    batchReview.value = false;
    batch.value = false;
    batchSelected.value = new Set();
  }
}
function add() {
  if (!region.value) return;
  if (store.commit((s) => s.addEntry(region.value!, personalCategory.value, personalName.value))) {
    addOpen.value = false;
    personalName.value = '';
    store.notice = '已添加个人项目';
  }
}
function csv() {
  exportCsv(
    [
      ['项目 ID', '名称', '类别', '所属地区', '到访', '部分标记', '有坐标', '备注'],
      ...rows.value.map((e) => [
        e.id,
        e.name,
        categoryName(e.categoryId),
        e.path,
        e.checked,
        e.partial,
        !!e.coordinates,
        e.note,
      ]),
    ],
    '方舆筛选清单.csv',
  );
}
watch(
  () => JSON.stringify({ ...query.value, retainedIds: [] }),
  () => {
    retainedIds.value = [];
    batchSelected.value = new Set();
  },
);
watch(
  [query, () => store.revision],
  async () => {
    const serial = ++requestSerial.value;
    busy.value = true;
    queryError.value = '';
    try {
      const response = await store.worker!.request<CatalogQueryResult>(
        'query',
        JSON.parse(JSON.stringify(query.value)),
      );
      if (serial === requestSerial.value) result.value = response;
    } catch (cause) {
      if (serial === requestSerial.value) queryError.value = String(cause);
    } finally {
      if (serial === requestSerial.value) busy.value = false;
    }
  },
  { immediate: true },
);
function routeContext() {
  if (route.path !== '/map') return;
  if (typeof route.query.scope === 'string' && route.query.scope in SCOPE_NAMES)
    workspace.state.scope = route.query.scope as Scope;
  if (route.query.view === 'list') current.value.view = 'list';
  const regionId =
    typeof route.query.region === 'string' ? route.query.region : store.selectedRegionId;
  if (regionId && index.value.regions.has(regionId)) {
    selectRegion(regionId);
    store.selectedRegionId = '';
  }
  if (typeof route.query.entry === 'string' && rowMap.value.has(route.query.entry))
    openEntry(route.query.entry);
  if (route.query.region || route.query.entry || route.query.scope || route.query.view)
    void router.replace({
      path: '/map',
      query: route.query.from ? { from: route.query.from } : {},
    });
}
watch(() => route.fullPath, routeContext, { immediate: true });
onActivated(routeContext);
watch(
  () => store.revision,
  () => {
    if (current.value.detail && !rowMap.value.has(current.value.detail)) clearDetail();
  },
);
onBeforeRouteLeave(() => guard());
</script>
<template>
  <div class="map-workspace">
    <div class="workspace-toolbar">
      <select
        :value="scope"
        aria-label="手册范围"
        class="scope-select"
        @change="changeScope(($event.target as HTMLSelectElement).value)"
      >
        <option
          v-for="(name, id) in SCOPE_NAMES"
          :key="id"
          :value="id"
        >
          {{ name }}
        </option>
      </select>
      <button
        class="region-picker-button"
        @click="
          regionPicker = true;
          pickerParent = '';
          regionSearch = '';
        "
      >
        ⌖ {{ region?.name || '选择地区' }} <span>⌄</span>
      </button>
      <div class="category-menu-anchor">
        <button
          :class="{ active: current.mode === 'theme' }"
          @click="categoryPicker = !categoryPicker"
        >
          按类别探索
          <span>{{
            current.mode === 'theme' && current.categories.length ? current.categories.length : '⌄'
          }}</span>
        </button>
        <div
          v-if="categoryPicker"
          class="category-menu"
        >
          <div class="section-heading">
            <strong>在{{ SCOPE_NAMES[scope] }}全域探索</strong
            ><button
              aria-label="关闭类别选择"
              @click="categoryPicker = false"
            >
              ×
            </button>
          </div>
          <section
            v-for="group in CATEGORY_GROUPS"
            :key="group.name"
          >
            <h4>{{ group.name }}</h4>
            <label
              v-for="cat in scopeCategories.filter((c) => group.ids.includes(c.id))"
              :key="cat.id"
              ><input
                type="checkbox"
                :checked="current.mode === 'theme' && current.categories.includes(cat.id)"
                @change="toggleCategory(cat.id)"
              />{{ cat.name }}</label
            >
          </section>
          <button
            class="text-button"
            @click="startTheme([])"
          >
            全部类别
          </button>
        </div>
      </div>
      <div class="search-box">
        <span aria-hidden="true">⌕</span
        ><input
          v-model="current.query"
          type="search"
          aria-label="搜索地区与项目"
          :placeholder="
            '搜索' +
            (region?.name && current.mode === 'region' ? region.name : SCOPE_NAMES[scope]) +
            '的地区、地点、代码、线路'
          "
        />
      </div>
      <div
        class="segmented"
        aria-label="工作区视图"
      >
        <button
          :aria-pressed="current.view === 'map'"
          @click="current.view = 'map'"
        >
          地图</button
        ><button
          :aria-pressed="current.view === 'list'"
          @click="current.view = 'list'"
        >
          清单
        </button>
      </div>
    </div>
    <div class="workspace-context">
      <div class="context-path">
        <button
          v-if="route.query.from === 'achievements'"
          @click="router.push('/achievements')"
        >
          ← 返回成就</button
        ><span class="eyebrow">{{ current.mode === 'theme' ? '类别探索' : '地区手册' }}</span
        ><button @click="selectRegion('')">{{ SCOPE_NAMES[scope] }}</button
        ><template v-if="current.mode === 'region'"
          ><button
            v-for="p in path"
            :key="p.id"
            @click="selectRegion(p.id)"
          >
            / {{ p.name }}
          </button></template
        ><template v-else
          ><span>/ {{ current.categories.map(categoryName).join('、') || '全部类别' }}</span
          ><label v-if="region"
            ><input
              v-model="current.restrictTheme"
              type="checkbox"
            />仅{{ region.name }}</label
          ></template
        ><span
          v-if="current.bounds"
          class="filter-badge"
          >地图视野 · 仅有坐标<button @click="current.bounds = null">×</button></span
        >
      </div>
      <div class="toolbar compact">
        <button @click="exportOpen = true">导出足迹图 ↗</button
        ><button @click="csv">导出清单</button>
      </div>
    </div>
    <div
      v-if="result.regions.length && current.query"
      class="region-search-strip"
    >
      <span>地区匹配</span
      ><button
        v-for="id in result.regions.slice(0, 6)"
        :key="id"
        @click="selectRegion(id)"
      >
        {{ index.paths.get(id) }}</button
      ><button
        v-if="result.regions.length > 6"
        @click="
          regionPicker = true;
          regionSearch = current.query;
        "
      >
        更多地区
      </button>
    </div>
    <div
      class="workspace-body"
      :class="{ 'list-view': current.view === 'list', 'sidebar-collapsed': current.collapsed }"
    >
      <div
        v-show="current.view === 'map'"
        class="map-main"
      >
        <div class="map-view-controls">
          <div class="segmented">
            <button
              :aria-pressed="current.map.preset === 'explore'"
              @click="current.map.preset = 'explore'"
            >
              探索</button
            ><button
              :aria-pressed="current.map.preset === 'footprints'"
              @click="current.map.preset = 'footprints'"
            >
              足迹
            </button>
          </div>
          <select
            v-if="scope === 'china'"
            v-model="current.map.level"
            aria-label="地图行政层级"
          >
            <option value="province">省级</option>
            <option value="city">市州盟级</option>
            <option value="county">县级</option></select
          ><select
            v-model="current.map.colorCategory"
            aria-label="地图填色方式"
          >
            <option value="">按旅行状态填色</option>
            <optgroup label="按单一类别到访填色">
              <option
                v-for="cat in scopeCategories"
                :key="cat.id"
                :value="cat.id"
              >
                {{ cat.name }}
              </option>
            </optgroup></select
          ><label
            ><input
              v-model="current.map.showPoints"
              type="checkbox"
            />显示点位</label
          ><button
            class="collapse-sidebar"
            @click="current.collapsed = !current.collapsed"
          >
            {{ current.collapsed ? '展开手册 ←' : '收起手册 →' }}
          </button>
        </div>
        <MapSurface
          ref="map"
          :scope="scope"
          :state="current.map"
          :selected="current.selectedRegion"
          :focused="current.detail"
          :points="pointRows"
          @select="mapRegion"
          @point="openEntry"
          @candidates="
            (ids) => {
              if (guard()) {
                clearDetail();
                candidates = ids;
                current.collapsed = false;
              }
            }
          "
          @camera="(camera) => (current.map.camera = camera)"
          @search="searchArea"
        />
      </div>
      <aside
        v-show="current.view === 'list' || !current.collapsed"
        class="directory-panel"
        :class="{ 'has-detail': !!current.detail }"
      >
        <div
          v-show="!current.detail && !candidates.length && !previewRegion"
          class="directory-content"
        >
          <header class="directory-heading">
            <span class="eyebrow">{{ scopeLabel }}</span>
            <div class="section-heading">
              <h2>{{ title }}</h2>
              <button
                v-if="region"
                class="icon-button"
                aria-label="添加个人项目"
                @click="addOpen = true"
              >
                ＋
              </button>
            </div>
            <VisitStateSelect
              v-if="region && current.mode === 'region'"
              :region-id="region.id"
            />
            <div class="directory-counts">
              <span
                ><strong>{{ result.ids.length.toLocaleString() }}</strong> 项收录</span
              ><span>{{ result.coordinateCount.toLocaleString() }} 项可上图</span
              ><button
                v-if="result.coordinateCount < result.ids.length && !current.missingCoordinates"
                class="text-button"
                @click="current.missingCoordinates = true"
              >
                查看缺坐标
              </button>
            </div>
            <label v-if="region && scope === 'china'"
              ><input
                v-model="current.descendants"
                type="checkbox"
              />包含下辖项目</label
            >
            <div
              v-if="children.length && current.mode === 'region'"
              class="children-nav"
            >
              <button
                v-for="child in children.slice(0, 8)"
                :key="child.id"
                @click="selectRegion(child.id)"
              >
                {{ child.name }}</button
              ><button
                v-if="children.length > 8"
                @click="
                  regionPicker = true;
                  pickerParent = region!.id;
                  regionSearch = '';
                "
              >
                全部下辖 {{ children.length }} ↗
              </button>
            </div>
          </header>
          <div class="directory-filters">
            <select
              v-model="current.status"
              aria-label="到访筛选"
            >
              <option value="">全部记录</option>
              <option value="visited">已标记（含部分）</option>
              <option value="unvisited">未标记</option>
              <option value="partial">仅部分标记</option></select
            ><select
              v-if="scope === 'japan'"
              v-model="current.railType"
              aria-label="铁路类型"
            >
              <option value="">全部铁路</option>
              <option value="J">JR 客运站</option>
              <option value="R">其他轨道站</option></select
            ><button
              :class="{ active: batch }"
              @click="
                batch = !batch;
                batchSelected = new Set();
              "
            >
              {{ batch ? '退出批量' : '批量选择' }}</button
            ><button
              v-if="current.status || current.query || current.missingCoordinates || current.bounds"
              class="text-button"
              @click="resetFilters"
            >
              清除筛选</button
            ><span
              v-if="current.missingCoordinates"
              class="filter-badge"
              >缺坐标</span
            >
          </div>
          <div
            v-if="batch"
            class="batch-toolbar"
          >
            <span>已选择 {{ batchSelected.size }} 项</span
            ><button @click="batchSelected = new Set(result.ids)">选择结果</button
            ><button
              :disabled="!batchSelected.size"
              @click="batchReview = true"
            >
              核对并应用
            </button>
          </div>
          <p
            v-if="queryError"
            class="inline-error"
            role="alert"
          >
            {{ queryError }}
          </p>
          <div
            class="query-progress"
            :class="{ busy }"
            role="status"
          >
            <span
              v-if="busy"
              class="sr-only"
              >正在查询目录</span
            >
          </div>
          <CatalogList
            :context-key="contextKey"
            :key="scope"
            :result="result"
            :expanded="current.expanded"
            :initial-scroll="current.scroll"
            :wide="current.view === 'list'"
            :batch="batch"
            :selected="batchSelected"
            :context-region="query.regionId"
            @open="openEntry"
            @mark="mark"
            @explore="(id) => startTheme([id])"
            @expand="(id, value) => (current.expanded[id] = value)"
            @scroll="(value) => (current.scroll = value)"
            @toggle="toggleBatch"
          />
          <details class="empty-categories">
            <summary>
              未收录内容的类别（{{ result.groups.filter((g) => !g.ids.length).length }}）
            </summary>
            <span
              v-for="g in result.groups.filter((g) => !g.ids.length)"
              :key="g.id"
              >{{ categoryName(g.id) }} · 0</span
            ><button
              :disabled="!region"
              @click="addOpen = true"
            >
              添加个人项目
            </button>
          </details>
        </div>
        <EntryDetails
          v-if="current.detail"
          ref="detail"
          :key="current.detail"
          :id="current.detail"
          :scope="scope"
          :context-region="current.detailRegion"
          @back="clearDetail"
          @region="selectRegion"
          @locate="
            (id) => {
              current.view = 'map';
              nextTick(() => map?.locate(id));
            }
          "
          @mark="record"
        />
        <div
          v-if="candidates.length"
          class="entry-detail"
        >
          <button
            class="text-button"
            @click="candidates = []"
          >
            ← 返回清单
          </button>
          <h2>此处有 {{ candidates.length }} 个项目</h2>
          <p class="note">请选择要查看的目录项目。</p>
          <button
            v-for="id in candidates"
            :key="id"
            class="candidate-row"
            @click="openEntry(id)"
          >
            {{ rowMap.get(id)?.name
            }}<small>{{ categoryName(rowMap.get(id)?.categoryId || '') }}</small>
          </button>
        </div>
        <div
          v-if="previewRegion"
          class="entry-detail"
        >
          <button
            class="text-button"
            @click="previewRegion = ''"
          >
            ← 返回主题清单</button
          ><span class="eyebrow">地区预览</span>
          <h2>{{ index.regions.get(previewRegion)?.name }}</h2>
          <p>{{ index.paths.get(previewRegion) }}</p>
          <VisitStateSelect :region-id="previewRegion" />
          <div class="toolbar">
            <button
              @click="
                current.selectedRegion = previewRegion;
                current.restrictTheme = true;
                previewRegion = '';
              "
            >
              仅看此地区</button
            ><button @click="selectRegion(previewRegion)">查看地区手册</button>
          </div>
        </div>
      </aside>
    </div>
    <AppDialog
      v-if="regionPicker"
      title="打开一个地方的旅行手册"
      @close="regionPicker = false"
      ><input
        v-model="regionSearch"
        class="full-width"
        type="search"
        placeholder="搜索地区、别名或行政代码"
        aria-label="查找地区"
      />
      <div class="toolbar">
        <button @click="selectRegion('')">{{ SCOPE_NAMES[scope] }}全域</button
        ><button
          v-if="pickerParent"
          @click="pickerParent = index.regions.get(pickerParent)?.parentId || ''"
        >
          返回上级
        </button>
      </div>
      <div class="region-grid">
        <div
          v-for="r in pickerRows"
          :key="r.id"
        >
          <button @click="selectRegion(r.id)">
            {{ r.name }}<small>{{ regionSearch ? index.paths.get(r.id) : r.code }}</small></button
          ><button
            v-if="index.children.get(r.id)?.length"
            :aria-label="'查看' + r.name + '下辖地区'"
            @click="
              pickerParent = r.id;
              regionSearch = '';
            "
          >
            ›
          </button>
        </div>
      </div>
      <p
        v-if="!pickerRows.length"
        class="empty"
      >
        没有匹配的地区。
      </p></AppDialog
    >
    <AppDialog
      v-if="addOpen"
      :title="'在' + (region?.name || '当前地区') + '添加个人项目'"
      @close="addOpen = false"
      ><form @submit.prevent="add">
        <label class="field"
          >类别<select v-model="personalCategory">
            <option
              v-for="cat in index.catalog.categories"
              :key="cat.id"
              :value="cat.id"
            >
              {{ cat.name }}
            </option>
          </select></label
        ><label class="field"
          >名称<input
            v-model="personalName"
            required
            maxlength="1000"
        /></label>
        <p class="note">项目归属当前地区。缺少坐标时仍可在清单中记录。</p>
        <button
          class="primary"
          :disabled="!region"
        >
          添加项目
        </button>
      </form></AppDialog
    >
    <AppDialog
      v-if="batchReview"
      title="核对批量记录"
      @close="batchReview = false"
      ><p>
        已选择 <strong>{{ batchSelected.size }}</strong> 个项目。
      </p>
      <select
        v-model="batchVisited"
        aria-label="批量操作"
      >
        <option :value="true">标记到访</option>
        <option :value="false">取消项目标记</option>
      </select>
      <p>
        本次将带入 {{ batchImpact.regions.length }} 个地区：{{
          batchImpact.regions.map((id) => index.regions.get(id)?.name).join('、') || '无'
        }}
      </p>
      <p
        v-if="batchImpact.ambiguous"
        class="inline-error"
      >
        {{ batchImpact.ambiguous }} 个项目有多个归属，请退出批量并在项目详情选择实际地区。
      </p>
      <p class="note">一次应用对应一次撤销。取消项目标记不会清除地区记录。</p>
      <button
        class="primary"
        :disabled="!!batchImpact.ambiguous"
        @click="applyBatch"
      >
        确认应用
      </button></AppDialog
    >
    <FootprintExport
      v-if="exportOpen"
      :scope="scope"
      :region-id="current.selectedRegion"
      :state="current.map"
      @close="exportOpen = false"
    />
  </div>
</template>
