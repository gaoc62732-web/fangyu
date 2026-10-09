<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useVirtualizer } from '@tanstack/vue-virtual';
import {
  SCOPE_IDS,
  isScope,
  getScopeConfig,
  type Scope,
  type MapLevel,
  type CatalogEntry,
} from '@fangyu/contracts';
import {
  pointGroup,
  pointView,
  childVisited,
  pointRecordIsShared,
  relatedPoints,
  pointRegions,
  drawablePoint,
  applyPointCheckin,
  type PointChange,
  type PointGroup,
} from '@fangyu/domain';
import MapSurface from '../components/MapSurface.vue';
import PointIcon from '../components/PointIcon.vue';
import PointSelect from '../components/PointSelect.vue';
import { useAppStore } from '../app/store.js';

const store = useAppStore();
const route = useRoute();
const session = computed(() => store.session!);
const inherited = store.regionalMap;
const scope = ref<Scope>(inherited?.scope || 'china');
const selectedRegion = ref(inherited?.selected || store.selectedRegionId);
const level = ref<MapLevel>(inherited?.level || session.value.preferences.mapLevel);
const initialCamera = ref(inherited?.camera);
const category = ref(store.category);
const openFilter = ref<'scope' | 'category' | null>(null);
const explorerExpanded = ref(false);
let explorerHovered = false;
const explorer = ref<HTMLElement>();
function closeExplorer() {
  if (explorer.value?.contains(document.activeElement))
    explorer.value.querySelector<HTMLButtonElement>('.atlas-explorer-trigger')?.focus();
  openFilter.value = null;
  explorerExpanded.value = false;
}
function enterExplorer(event: PointerEvent) {
  if (event.pointerType === 'mouse') {
    explorerHovered = true;
    explorerExpanded.value = true;
  }
}
function leaveExplorer(event: PointerEvent) {
  if (event.pointerType === 'mouse') {
    explorerHovered = false;
    closeExplorer();
  }
}
function clickExplorer(event: MouseEvent) {
  explorerExpanded.value = explorerHovered && event.detail > 0 ? true : !explorerExpanded.value;
}
function focusOutExplorer(event: FocusEvent) {
  if (!explorer.value?.contains(event.relatedTarget as Node | null)) closeExplorer();
}
function outsideExplorer(event: PointerEvent) {
  if (explorerExpanded.value && !explorer.value?.contains(event.target as Node)) closeExplorer();
}
onMounted(() => document.addEventListener('pointerdown', outsideExplorer));
onBeforeUnmount(() => document.removeEventListener('pointerdown', outsideExplorer));
const scopeOptions = SCOPE_IDS.map((id) => ({ value: id, label: getScopeConfig(id).title }));
const selectedId = ref('');
const panel = ref<'detail' | 'list' | null>(null);
const panelElement = ref<HTMLElement>();
const panelBody = ref<HTMLElement>();
const workspace = ref<HTMLElement>();
const workspaceWidth = ref(window.innerWidth);
const preferredPanelWidth = ref(390);
const maxPanelWidth = computed(() => Math.max(320, Math.min(680, workspaceWidth.value - 320)));
const panelWidth = computed(() => Math.min(maxPanelWidth.value, preferredPanelWidth.value));
const resizingPanel = ref(false);
let resizeStart: { x: number; width: number } | undefined;
let workspaceObserver: ResizeObserver | undefined;
function setPanelWidth(width: number) {
  preferredPanelWidth.value = Math.max(320, Math.min(maxPanelWidth.value, width));
}
function startPanelResize(event: PointerEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  resizeStart = { x: event.clientX, width: panelWidth.value };
  resizingPanel.value = true;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}
function movePanelResize(event: PointerEvent) {
  if (resizeStart) setPanelWidth(resizeStart.width + resizeStart.x - event.clientX);
}
function stopPanelResize() {
  resizeStart = undefined;
  resizingPanel.value = false;
}
function keyPanelResize(event: KeyboardEvent) {
  if (event.key === 'ArrowLeft') setPanelWidth(panelWidth.value + 20);
  else if (event.key === 'ArrowRight') setPanelWidth(panelWidth.value - 20);
  else if (event.key === 'Home') setPanelWidth(320);
  else if (event.key === 'End') setPanelWidth(maxPanelWidth.value);
  else return;
  event.preventDefault();
}
onMounted(() => {
  workspaceObserver = new ResizeObserver(() => {
    if (workspace.value) workspaceWidth.value = workspace.value.clientWidth;
  });
  if (workspace.value) workspaceObserver.observe(workspace.value);
});
onBeforeUnmount(() => workspaceObserver?.disconnect());
const query = ref('');
const clusterIds = ref<string[]>([]);
const message = ref('');
const pending = ref<{
  stage: 'children' | 'identities' | 'regions';
  changes: PointChange[];
  group?: PointGroup;
  choices: string[];
  options: { id: string; name: string; disabled?: boolean }[];
}>();
const scopeEntries = computed(() =>
  store.rows.filter((e) => session.value.index.entryRegions(e, scope.value).length),
);
const categories = computed(() => {
  const ids = new Set(scopeEntries.value.map((e) => e.categoryId));
  return session.value.index.catalog.categories.filter((c) => ids.has(c.id));
});
watch(
  categories,
  (choices) => {
    if (!choices.some((c) => c.id === category.value))
      category.value =
        choices.find((c) =>
          scopeEntries.value.some((e) => e.categoryId === c.id && drawablePoint(e)),
        )?.id ||
        choices[0]?.id ||
        '';
  },
  { immediate: true },
);
const entries = computed(() =>
  scopeEntries.value
    .filter((e) => e.categoryId === category.value)
    .map((e) => pointView(session.value, e)),
);
const mappedCount = computed(() => entries.value.filter(drawablePoint).length);
const listing = computed(() =>
  entries.value.filter(
    (e) =>
      (!clusterIds.value.length || clusterIds.value.includes(e.id)) &&
      (!query.value ||
        `${e.name} ${e.aliases.join(' ')} ${e.path}`
          .toLowerCase()
          .includes(query.value.toLowerCase())),
  ),
);
const listVirtualizer = useVirtualizer(
  computed(() => ({
    count: listing.value.length,
    getScrollElement: () => panelBody.value || null,
    estimateSize: () => 92,
    overscan: 6,
    initialRect: { width: 310, height: 500 },
  })),
);
watch(listing, () => listVirtualizer.value.scrollToOffset(0));
const active = computed(() => {
  void store.revision;
  const entry = store.rows.find((e) => e.id === selectedId.value);
  return entry ? pointView(session.value, entry) : undefined;
});
const group = computed(() => (active.value ? pointGroup(session.value, active.value) : undefined));
const shared = computed(() =>
  active.value ? pointRecordIsShared(session.value, active.value) : false,
);
const related = computed(() => (active.value ? relatedPoints(session.value, active.value) : []));
const sharedIdentities = computed(() =>
  active.value
    ? (session.value.index.byRecord.get(active.value.recordId) || []).filter(
        (e) => e.id !== active.value!.id && e.categoryId !== active.value!.categoryId,
      )
    : [],
);
const parentProjects = computed(() =>
  active.value
    ? (session.value.index.catalog.heritageProjects || [])
        .filter((p) => p.componentEntryIds.includes(active.value!.id))
        .flatMap((p) => p.legacyEntryIds.slice(0, 1).map((id) => session.value.entry(id)))
    : [],
);
const progress = computed(() =>
  group.value ? group.value.children.filter((c) => childVisited(session.value, c)).length : 0,
);
const previewRegions = computed(() =>
  pending.value?.stage === 'regions'
    ? pending.value.choices
    : active.value
      ? pointRegions(session.value, active.value, scope.value).filter(
          (id) => session.value.index.regions.get(id)?.scope === scope.value,
        )
      : [],
);
const categoryName = (id: string) =>
  session.value.index.catalog.categories.find((c) => c.id === id)?.name || id;
const stateLabel = computed(() =>
  active.value?.checked ? '已点亮' : active.value?.partial ? '部分到访' : '未点亮',
);
const actionLabel = computed(() =>
  group.value ? '选择到访的组成地点' : active.value?.checked ? '取消点亮' : '点亮此地点',
);

async function focusPanel() {
  await nextTick();
  panelElement.value?.focus({ preventScroll: true });
}
function openEntry(entry: CatalogEntry) {
  if (pending.value) finish();
  category.value = entry.categoryId;
  selectedId.value = entry.id;
  panel.value = 'detail';
  clusterIds.value = [];
  message.value = '';
  void focusPanel();
}
function choosePoint(id: string) {
  const entry = store.rows.find((e) => e.id === id);
  if (entry) openEntry(entry);
}
// Existing record-list location links now open the point module directly.
watch(
  () => [route.query.entry, route.query.scope],
  ([id, requestedScope]) => {
    if (typeof id !== 'string') return;
    const entry = store.rows.find((e) => e.id === id);
    if (!entry) return;
    const targetScope =
      typeof requestedScope === 'string' &&
      isScope(requestedScope) &&
      session.value.index.entryRegions(entry, requestedScope).length
        ? requestedScope
        : entry.scope;
    if (scope.value !== targetScope) {
      scope.value = targetScope;
      switchScope();
    }
    if (drawablePoint(entry)) initialCamera.value = { center: entry.coordinates!, zoom: 14 };
    openEntry(entry);
  },
  { immediate: true },
);
function openList(ids: string[] = []) {
  if (pending.value) finish();
  clusterIds.value = ids;
  query.value = '';
  panel.value = 'list';
  void focusPanel();
}
function closePanel() {
  if (pending.value) finish();
  panel.value = null;
}
function switchScope() {
  if (pending.value) finish();
  selectedRegion.value = '';
  initialCamera.value = undefined;
  selectedId.value = '';
  panel.value = null;
  clusterIds.value = [];
}
function changeCategory() {
  if (pending.value) finish();
  selectedId.value = '';
  clusterIds.value = [];
  if (panel.value === 'detail') panel.value = null;
}
function finish(regions: string[] = []) {
  const changes = pending.value?.changes || [];
  if (changes.length) {
    if (store.commit((current) => applyPointCheckin(current, changes, regions)))
      message.value = '已保存到访记录';
  }
  pending.value = undefined;
}
function addedEntries(changes: PointChange[]) {
  return changes
    .filter(
      (c) =>
        (c.visited && !session.value.view(session.value.entry(c.entryId)).checked) ||
        c.subitemIds?.some((id) => !session.value.subitemVisited(c.entryId, id)),
    )
    .map((c) => session.value.entry(c.entryId));
}
function regionStep(changes: PointChange[]) {
  const additions = addedEntries(changes);
  const ids = [...new Set(additions.flatMap((e) => pointRegions(session.value, e, scope.value)))];
  const unvisited = ids.filter((id) => !session.value.arrived(id));
  if (!unvisited.length || policies.value.regions === 'never') {
    pending.value = { stage: 'regions', changes, choices: [], options: [] };
    finish();
    return;
  }
  // Several covered regions always require an explicit actual-visit choice.
  if (policies.value.regions === 'auto' && ids.length === 1) {
    pending.value = { stage: 'regions', changes, choices: [], options: [] };
    finish(unvisited);
    return;
  }
  pending.value = {
    stage: 'regions',
    changes,
    choices: ids.length === 1 ? unvisited : [],
    options: unvisited.map((id) => ({
      id,
      name: session.value.index.paths.get(id) || session.value.index.regions.get(id)!.name,
    })),
  };
}
function identityStep(changes: PointChange[]) {
  const primaryIds = new Set(changes.map((c) => c.entryId));
  const identities = [
    ...new Map(
      addedEntries(changes).flatMap((e) =>
        relatedPoints(session.value, e)
          .filter(
            (r) =>
              r.kind === 'same-place' &&
              r.entry.categoryId !== e.categoryId &&
              !primaryIds.has(r.entry.id) &&
              !pointRecordIsShared(session.value, r.entry) &&
              !pointGroup(session.value, r.entry) &&
              !session.value.view(r.entry).checked,
          )
          .map((r) => [r.entry.id, r.entry] as const),
      ),
    ).values(),
  ];
  if (!identities.length || policies.value.identities === 'never') {
    regionStep(changes);
    return;
  }
  if (policies.value.identities === 'auto') {
    regionStep([...changes, ...identities.map((e) => ({ entryId: e.id, visited: true }))]);
    return;
  }
  pending.value = {
    stage: 'identities',
    changes,
    choices: [],
    options: identities.map((e) => ({
      id: e.id,
      name: `${categoryName(e.categoryId)} · ${e.name}`,
    })),
  };
}
function groupChanges(selected: string[]) {
  const currentGroup = group.value!;
  const selectedSet = new Set(selected);
  if (currentGroup.children.some((c) => c.subitemId))
    return [
      {
        entryId: active.value!.id,
        visited: false,
        subitemIds: selected,
      },
    ];
  return currentGroup.children
    .filter((c) => selectedSet.has(c.id) !== childVisited(session.value, c))
    .map((c) => ({ entryId: c.entryId, visited: selectedSet.has(c.id) }));
}
function beginCheckin() {
  if (!active.value || shared.value) return;
  if (group.value) {
    if (!group.value.children.length) {
      message.value = '该项目尚未收录组成地点，暂不能记录总项目完成状态。';
      return;
    }
    const options = group.value.children.map((c) => ({
      id: c.id,
      name: c.name,
      disabled: pointRecordIsShared(session.value, session.value.entry(c.entryId)),
    }));
    if (policies.value.children === 'auto' && !options.some((o) => o.disabled)) {
      identityStep(groupChanges(options.map((o) => o.id)));
      return;
    }
    pending.value = {
      stage: 'children',
      changes: [],
      group: group.value,
      choices: group.value.children.filter((c) => childVisited(session.value, c)).map((c) => c.id),
      options,
    };
    return;
  }
  const change = { entryId: active.value.id, visited: !active.value.checked };
  if (!change.visited) {
    pending.value = { stage: 'regions', changes: [change], choices: [], options: [] };
    finish();
  } else identityStep([change]);
}
function confirmStep() {
  const draft = pending.value;
  if (!draft) return;
  if (draft.stage === 'children') identityStep(groupChanges(draft.choices));
  else if (draft.stage === 'identities')
    regionStep([...draft.changes, ...draft.choices.map((entryId) => ({ entryId, visited: true }))]);
  else finish(draft.choices);
}
function skipStep() {
  const draft = pending.value;
  if (!draft) return;
  if (draft.stage === 'children') pending.value = undefined;
  else if (draft.stage === 'identities') regionStep(draft.changes);
  else finish();
}
function selectAllChildren() {
  if (pending.value?.stage !== 'children') return;
  const preserved = pending.value.choices.filter(
    (id) => pending.value!.options.find((o) => o.id === id)?.disabled,
  );
  pending.value.choices = [
    ...preserved,
    ...pending.value.options.filter((o) => !o.disabled).map((o) => o.id),
  ];
}
onBeforeUnmount(() => {
  if (pending.value) finish();
});
</script>

<template>
  <section class="point-page">
    <div
      ref="workspace"
      class="point-workspace"
      :class="{ 'has-panel': panel, 'resizing-panel': resizingPanel }"
      :style="{ '--point-panel-width': panelWidth + 'px' }"
    >
      <div class="point-map">
        <MapSurface
          :scope="scope"
          :selected="selectedRegion"
          :level="level"
          :category="category"
          :points="entries"
          :initial-camera="initialCamera"
          :preview-regions="previewRegions"
          point-mode
          @point="choosePoint"
          @cluster="openList"
          @level="level = $event"
        />
        <div
          ref="explorer"
          class="point-filters"
          :class="{ expanded: explorerExpanded }"
          @pointerenter="enterExplorer"
          @pointerleave="leaveExplorer"
          @focusout="focusOutExplorer"
          @keydown.esc.prevent="closeExplorer"
        >
          <button
            class="atlas-explorer-trigger"
            aria-label="探索筛选"
            :aria-expanded="explorerExpanded"
            title="探索范围与地点类别"
            @click="clickExplorer"
            @keydown.down.prevent="explorerExpanded = true"
          >
            <PointIcon name="compass" />
          </button>
          <div
            v-if="explorerExpanded"
            class="atlas-filter-options"
          >
            <PointSelect
              class="atlas-scope-select"
              label="点位地图区域"
              :model-value="scope"
              :options="scopeOptions"
              :open="openFilter === 'scope'"
              @update:model-value="scope = $event as Scope"
              @update:open="
                openFilter = $event ? 'scope' : openFilter === 'scope' ? null : openFilter
              "
              @change="switchScope"
            />
            <PointSelect
              class="atlas-category-select"
              label="点位类别"
              v-model="category"
              :options="categories.map((c) => ({ value: c.id, label: c.name }))"
              :open="openFilter === 'category'"
              @update:open="
                openFilter = $event ? 'category' : openFilter === 'category' ? null : openFilter
              "
              @change="changeCategory"
            />
          </div>
        </div>
        <button
          class="atlas-directory-trigger"
          aria-label="地点目录"
          :aria-expanded="panel === 'list'"
          @click="openList()"
        >
          <PointIcon name="list" /><span>地点目录</span>
        </button>
        <button
          v-if="!panel && active"
          class="restore-details"
          @click="
            panel = 'detail';
            focusPanel();
          "
        >
          <span>{{ active.nameZh || active.name }}</span
          ><PointIcon
            name="arrow"
            :size="16"
          />
        </button>
        <footer class="point-page-caption">
          <span role="status">{{
            message ||
            (mappedCount
              ? `${mappedCount.toLocaleString()} 处地图点位`
              : '本类别暂无可显示点位，可从地点目录记录到访')
          }}</span>
          <div>
            <span class="atlas-save-state">{{ store.saveStatus }}</span
            ><button
              :disabled="!store.canUndo || !!pending"
              aria-label="撤销"
              @click="
                store.undo();
                message = '已撤销上一步';
              "
            >
              <PointIcon
                name="undo"
                :size="15"
              />
            </button>
          </div>
        </footer>
      </div>
      <aside
        v-if="panel"
        ref="panelElement"
        class="point-panel"
        tabindex="-1"
        aria-label="点位资料栏"
        @keydown.esc="closePanel"
      >
        <div
          class="point-panel-resize"
          role="separator"
          aria-label="调整资料栏宽度"
          aria-orientation="vertical"
          :aria-valuenow="panelWidth"
          :aria-valuemin="320"
          :aria-valuemax="maxPanelWidth"
          tabindex="0"
          title="左右拖动调整资料栏宽度；方向键每次调整 20px"
          @pointerdown="startPanelResize"
          @pointermove="movePanelResize"
          @pointerup="stopPanelResize"
          @pointercancel="stopPanelResize"
          @lostpointercapture="stopPanelResize"
          @keydown="keyPanelResize"
        >
          <span />
        </div>
        <div class="point-panel-head">
          <div class="point-panel-tools">
            <span>{{
              panel === 'list'
                ? 'EXPLORE THE COLLECTION'
                : 'PLACE / ' + categoryName(active?.categoryId || category)
            }}</span
            ><button
              class="close-panel"
              aria-label="收起资料栏"
              @click="closePanel"
            >
              <PointIcon
                name="close"
                :size="18"
              />
            </button>
          </div>
          <template v-if="panel === 'detail' && active">
            <h3 :title="active.name">{{ active.nameZh || active.name }}</h3>
            <p
              v-if="active.nameEn"
              class="english-name"
            >
              {{ active.nameEn }}
            </p>
            <div class="point-status">
              <i :class="{ lit: active.visited }" />{{ pending ? '到访地点已选择' : stateLabel
              }}<span v-if="group"
                >{{ progress }} <b>/ {{ group.children.length }}</b></span
              >
            </div>
            <button
              v-if="!pending"
              class="point-primary-action"
              :disabled="shared"
              @click="beginCheckin"
            >
              <PointIcon
                :name="active.checked && !group ? 'undo' : 'check'"
                :size="17"
              /><span>{{ actionLabel }}</span
              ><PointIcon
                name="arrow"
                :size="16"
              />
            </button>
            <div
              v-else
              class="atlas-confirm-step"
            >
              <span>确认记录</span><i /><span>{{
                pending.stage === 'children'
                  ? '组成地点'
                  : pending.stage === 'identities'
                    ? '其他身份'
                    : '行政区划'
              }}</span>
            </div>
          </template>
          <template v-else
            ><h3>{{ clusterIds.length ? '附近地点' : '地点目录' }}</h3>
            <p class="atlas-panel-lead">
              {{ categoryName(category) }} <span>· {{ entries.length.toLocaleString() }} 处</span>
            </p>
            <label class="atlas-search"
              ><PointIcon
                name="search"
                :size="17" /><input
                v-model="query"
                aria-label="搜索点位"
                placeholder="搜索地点或行政区" /></label
          ></template>
        </div>
        <div
          ref="panelBody"
          class="point-panel-body"
        >
          <template v-if="panel === 'list'">
            <div
              class="point-virtual-list"
              :style="{ height: listVirtualizer.getTotalSize() + 'px' }"
            >
              <button
                v-for="row in listVirtualizer.getVirtualItems()"
                :key="listing[row.index]!.id"
                class="point-list-row"
                :style="{ transform: `translateY(${row.start}px)` }"
                @click="openEntry(listing[row.index]!)"
              >
                <span
                  ><strong>{{ listing[row.index]!.nameZh || listing[row.index]!.name }}</strong
                  ><small>{{ listing[row.index]!.path || '暂无所属行政区资料' }}</small></span
                ><span
                  class="point-list-state"
                  :class="{ lit: listing[row.index]!.visited }"
                  >{{
                    listing[row.index]!.checked
                      ? '已点亮'
                      : listing[row.index]!.partial
                        ? '部分到访'
                        : drawablePoint(listing[row.index]!)
                          ? '↗'
                          : '暂无坐标'
                  }}</span
                >
              </button>
            </div>
            <p
              v-if="!listing.length"
              class="atlas-quiet-note"
            >
              没有符合条件的地点。
            </p>
          </template>
          <template v-else-if="active">
            <section
              v-if="pending"
              class="point-confirmation"
              aria-live="polite"
            >
              <h4>
                {{
                  pending.stage === 'children'
                    ? '这次到访了哪些组成地点？'
                    : pending.stage === 'identities'
                      ? '也记录它的其他身份？'
                      : '一并点亮所在行政区划？'
                }}
              </h4>
              <p>
                {{
                  pending.stage === 'children'
                    ? '该项目包含多处地点。您可以确认全部点亮，也可以仅选择实际去过的子项。'
                    : pending.stage === 'regions'
                      ? '勾选实际到访的行政区，地图会高亮对应范围。'
                      : '同一地点在多个类别下的点卯状态分别保存。'
                }}
              </p>
              <p
                v-if="pending.stage === 'children' && !pending.group?.complete"
                class="atlas-quiet-note"
              >
                清单尚不完整，仅计算已收录地点的进度。
              </p>
              <button
                v-if="pending.stage === 'children'"
                class="select-all"
                @click="selectAllChildren"
              >
                <PointIcon
                  name="check"
                  :size="14"
                />选择全部已收录地点
              </button>
              <div class="point-choices">
                <label
                  v-for="option in pending.options"
                  :key="option.id"
                  class="point-choice"
                  :class="{ chosen: pending.choices.includes(option.id) }"
                  ><input
                    v-model="pending.choices"
                    type="checkbox"
                    :value="option.id"
                    :disabled="option.disabled"
                  /><span
                    >{{ option.name
                    }}<small v-if="option.disabled">旧跨类别共用记录，暂不能修改</small></span
                  ></label
                >
              </div>
            </section>
            <template v-else>
              <p
                v-if="shared"
                class="atlas-quiet-note"
              >
                此地点与其他类别共用旧记录。保留现有状态，待拆分记录后开放此处点亮。
              </p>
              <dl class="point-facts">
                <div>
                  <dt>所在行政区</dt>
                  <dd>{{ active.path || '暂未收录' }}</dd>
                </div>
                <div v-if="active.designation">
                  <dt>认定类别</dt>
                  <dd>{{ active.designation }}</dd>
                </div>
                <div v-if="active.code">
                  <dt>编号</dt>
                  <dd>{{ active.code }}</dd>
                </div>
                <div v-if="active.year">
                  <dt>认定年份</dt>
                  <dd>{{ active.year }}</dd>
                </div>
                <div v-if="active.heritageType">
                  <dt>遗产类型</dt>
                  <dd>{{ active.heritageType }}</dd>
                </div>
              </dl>
              <section
                v-if="group"
                class="point-detail-section"
              >
                <div class="atlas-section-heading">
                  <h4>组成地点</h4>
                  <span>{{ progress }} / {{ group.children.length }}</span>
                </div>
                <p class="atlas-quiet-note">
                  {{ group.complete ? '组成地点已完整收录' : '清单尚不完整，仅显示已收录地点进度' }}
                </p>
                <button
                  v-for="child in group.children"
                  :key="child.id"
                  class="point-related-row"
                  :disabled="!!child.subitemId"
                  @click="choosePoint(child.entryId)"
                >
                  <span>{{ child.name }}</span
                  ><small :class="{ lit: childVisited(session, child) }">{{
                    childVisited(session, child) ? '已点亮' : '未点亮'
                  }}</small>
                </button>
                <p
                  v-if="!group.children.length"
                  class="atlas-quiet-note"
                >
                  尚未收录组成地点。
                </p>
              </section>
              <section
                v-if="parentProjects.length"
                class="point-detail-section"
              >
                <h4>所属总项目</h4>
                <button
                  v-for="parent in parentProjects"
                  :key="parent.id"
                  class="point-related-row"
                  @click="openEntry(parent)"
                >
                  <span>{{ parent.nameZh || parent.name }}</span
                  ><PointIcon
                    name="arrow"
                    :size="15"
                  />
                </button>
              </section>
              <section
                v-if="related.length || sharedIdentities.length"
                class="point-detail-section"
              >
                <h4>关联身份</h4>
                <button
                  v-for="r in related"
                  :key="r.entry.id"
                  class="point-related-row"
                  @click="openEntry(r.entry)"
                >
                  <span>{{ r.entry.nameZh || r.entry.name }}</span
                  ><small>{{
                    r.kind === 'same-place'
                      ? categoryName(r.entry.categoryId)
                      : r.kind === 'contains'
                        ? '包含关系'
                        : '部分重叠'
                  }}</small></button
                ><button
                  v-for="entry in sharedIdentities"
                  :key="entry.id"
                  class="point-related-row"
                  @click="openEntry(entry)"
                >
                  <span>{{ entry.nameZh || entry.name }}</span
                  ><small>{{ categoryName(entry.categoryId) }} · 旧共用记录</small>
                </button>
              </section>
              <section
                v-if="active.description"
                class="point-detail-section"
              >
                <h4>关于这个地点</h4>
                <p class="atlas-description">{{ active.description }}</p>
              </section>
              <p
                v-if="!active.description"
                class="atlas-quiet-note atlas-empty-description"
              >
                地点简介尚未收录。
              </p>
              <p
                v-if="!drawablePoint(active)"
                class="atlas-quiet-note"
              >
                暂无可展示的点位坐标。你仍可在此查看资料、记录到访。
              </p>
              <p
                v-if="active.note"
                class="atlas-description"
              >
                {{ active.note }}
              </p>
            </template>
          </template>
        </div>
        <footer
          v-if="pending"
          class="atlas-confirm-footer"
        >
          <div class="point-confirm-actions">
            <button
              class="point-primary-action"
              @click="confirmStep"
            >
              <span>{{ pending.stage === 'children' ? '确认所选地点' : '确认关联' }}</span
              ><PointIcon
                name="arrow"
                :size="16"
              /></button
            ><button
              class="atlas-skip"
              @click="skipStep"
            >
              {{ pending.stage === 'children' ? '返回资料' : '跳过关联' }}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.point-page {
  --point-paper: #fffefa;
  --point-line: #e7e7de;
  --point-ink: #30372e;
  --point-muted: #4b5348;
  --point-decoration: #858a7f;
  --point-title-size: 32px;
  --point-body-size: 16px;
  --point-meta-size: 14px;
  --point-accent: #343d32;
  --point-gold: #9b7c45;
  height: calc(100dvh - 56px);
  min-height: 480px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--point-paper);
  color: var(--point-ink);
  font:
    400 16px/1.6 'Segoe UI',
    'PingFang SC',
    'Hiragino Sans GB',
    'Microsoft YaHei UI',
    'Microsoft YaHei',
    sans-serif;
}
.point-page button,
.point-page select,
.point-page input {
  font: inherit;
  color: inherit;
  border: 0;
  background: transparent;
  box-shadow: none;
  outline-offset: 4px;
}
.point-page button {
  cursor: pointer;
  font-weight: 300;
  border-radius: 0;
}
.point-page button:disabled {
  cursor: default;
  opacity: 0.45;
}
.point-page button:focus-visible,
.point-page a:focus-visible,
.point-page select:focus-visible,
.point-page input:focus-visible {
  outline: 2px solid #a18b5d;
}
.atlas-header {
  height: 56px;
  min-height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 32px;
  border-bottom: 1px solid var(--point-line);
  z-index: 6;
}
.atlas-brand {
  display: flex;
  align-items: center;
  gap: 13px;
}
.atlas-brand > svg {
  color: #6e785f;
}
.atlas-brand > span {
  font-family: inherit;
  font-weight: 300;
  font-size: 22px;
  letter-spacing: 0.12em;
}
.atlas-brand i {
  height: 17px;
  width: 1px;
  background: #d7d9cc;
  margin: 0 5px;
}
.atlas-brand h1 {
  margin: 0;
  font-size: var(--point-body-size);
  font-weight: 400;
  letter-spacing: 0.13em;
}
.atlas-header-actions {
  display: flex;
  align-items: center;
  gap: 28px;
}
.atlas-header-actions button,
.atlas-header-actions a {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  font-size: var(--point-body-size);
  color: var(--point-ink);
  text-decoration: none;
}
.atlas-header-actions a {
}
.point-workspace {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.point-map {
  min-width: 0;
  flex: 1;
  position: relative;
  background: #edf1e9;
}
.point-map :deep(.map-card) {
  height: 100%;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  min-height: 0;
}
.point-map :deep(.map-surface) {
  height: 100%;
  min-height: 0;
}
.point-map :deep(.maplibregl-ctrl-attrib) {
  font-size: 12px;
  background: #fffefaac;
}
.point-map :deep(.maplibregl-ctrl-bottom-right) {
  bottom: 40px;
}
.point-filters {
  position: absolute;
  top: 24px;
  left: 24px;
  z-index: 4;
  display: flex;
  align-items: flex-start;
  width: max-content;
  max-width: calc(100% - 100px);
  gap: 8px;
}
.point-page .atlas-explorer-trigger,
.point-page .atlas-directory-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  padding: 0;
  background: var(--point-paper);
  border: 1px solid #e2e3dd;
  border-radius: 12px;
  box-shadow: none;
}
.atlas-filter-options {
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 4px;
  background: #fffefaf5;
  backdrop-filter: blur(12px);
  border: 1px solid #dfdfd4;
  box-shadow: none;
  border-radius: 14px;
}
.atlas-scope-select {
  flex: 0 1 190px;
  width: 190px;
}
.atlas-category-select {
  flex: 0 1 280px;
  width: 280px;
  border-left: 1px solid var(--point-line);
}
.point-page .atlas-directory-trigger {
  position: absolute;
  z-index: 3;
  top: 80px;
  left: 24px;
}
.atlas-directory-trigger > span {
  display: none;
}
.point-page .atlas-directory-trigger:hover,
.point-page .atlas-explorer-trigger:hover {
  background: #f2f2e9;
}
.point-page-caption {
  position: absolute;
  z-index: 2;
  left: 0;
  bottom: 0;
  right: 0;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 24px;
  font-size: var(--point-meta-size);
  color: var(--point-ink);
  background: #fffefadf;
  backdrop-filter: blur(12px);
  border-top: 1px solid #e6e6dc;
}
.point-page-caption > div {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}
.point-page-caption button {
  padding: 0;
  display: flex;
}
.atlas-save-state {
  font-size: var(--point-meta-size);
}
.point-panel {
  position: relative;
  flex: 0 0 var(--point-panel-width, 390px);
  width: var(--point-panel-width, 390px);
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-left: 1px solid #ddded3;
  background: var(--point-paper);
  outline: none;
  z-index: 5;
}
.point-panel-resize {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -5px;
  width: 10px;
  z-index: 6;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: col-resize;
  touch-action: none;
}
.point-panel-resize span {
  width: 2px;
  height: 40px;
  border-radius: 2px;
  background: #c7cbbf;
}
.point-panel-resize:hover,
.point-panel-resize:focus-visible,
.resizing-panel .point-panel-resize {
  background: #343d3212;
  outline: none;
}
.point-panel-resize:hover span,
.point-panel-resize:focus-visible span,
.resizing-panel .point-panel-resize span {
  background: var(--point-accent);
}
.resizing-panel {
  user-select: none;
  cursor: col-resize;
}
.point-panel-head {
  flex: 0 0 auto;
  padding: 29px 30px 26px;
  border-bottom: 1px solid var(--point-line);
}
.point-panel-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
}
.point-panel-tools > span {
  color: var(--point-ink);
  font-size: var(--point-meta-size);
  letter-spacing: 0.12em;
}
.close-panel {
  padding: 4px !important;
  display: flex;
  color: var(--point-ink) !important;
}
.close-panel:hover {
  color: var(--point-ink) !important;
}
.point-panel h3 {
  font-family: inherit;
  font-size: var(--point-title-size);
  font-weight: 300;
  line-height: 1.45;
  margin: 0 0 9px;
  letter-spacing: 0;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.english-name {
  margin: 0 0 18px;
  color: var(--point-ink);
  font-size: var(--point-meta-size);
  line-height: 1.7;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.point-status {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 17px 0 23px;
  font-size: var(--point-meta-size);
  color: var(--point-ink);
}
.point-status i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #aeb2a2;
}
.point-status i.lit {
  background: var(--point-gold);
}
.point-status span {
  margin-left: auto;
  color: var(--point-ink);
  font-size: var(--point-body-size);
  font-variant-numeric: tabular-nums;
}
.point-status b {
  font-size: var(--point-meta-size);
  font-weight: 400;
  color: var(--point-ink);
}
.point-page .point-primary-action {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 48px;
  padding: 0 17px;
  background: var(--point-accent);
  color: #fffefa;
  border-radius: 8px;
  font-size: var(--point-body-size);
  font-weight: 300;
  letter-spacing: 0.02em;
}
.point-primary-action > svg:last-child {
  margin-left: auto;
}
.point-panel-head .point-primary-action {
  width: fit-content;
  max-width: 100%;
  height: auto;
  min-height: 48px;
  padding: 12px 17px;
}
.point-primary-action:hover {
  background: #47523f;
}
.point-primary-action:disabled {
  background: #b0b4a5 !important;
}
.point-panel-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: #d5d7ca transparent;
  padding: 0 30px 30px;
}
.point-facts {
  margin: 24px 0;
}
.point-facts > div {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 16px;
  margin: 12px 0;
  font-size: var(--point-body-size);
  line-height: 1.65;
}
.point-facts dt {
  color: var(--point-ink);
  font-size: var(--point-meta-size);
}
.point-facts dd {
  margin: 0;
  color: var(--point-ink);
}
.point-detail-section {
  border-top: 1px solid var(--point-line);
  padding: 25px 0 8px;
}
.point-detail-section h4 {
  font-size: var(--point-body-size);
  font-weight: 400;
  letter-spacing: 0.07em;
  margin: 0 0 16px;
}
.atlas-section-heading {
  display: flex;
  justify-content: space-between;
}
.atlas-section-heading > span {
  font-size: var(--point-meta-size);
  color: var(--point-ink);
}
.atlas-quiet-note {
  font-size: var(--point-meta-size);
  line-height: 1.9;
  color: var(--point-ink);
  margin: 17px 0;
}
.atlas-empty-description {
  margin: 32px 0 10px;
  padding-top: 20px;
  border-top: 1px solid var(--point-line);
}
.atlas-description {
  font-size: var(--point-body-size);
  line-height: 2;
  color: var(--point-ink);
  white-space: pre-line;
}
.point-related-row,
.point-list-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  width: 100%;
  text-align: left;
  padding: 16px 0 !important;
  border-bottom: 1px solid var(--point-line) !important;
  font-size: var(--point-body-size) !important;
  color: var(--point-ink) !important;
}
.point-related-row:hover,
.point-list-row:hover {
  color: #2f3929 !important;
}
.point-related-row small {
  font-size: var(--point-meta-size);
  color: var(--point-ink);
}
.point-related-row small.lit,
.point-list-state.lit {
  color: var(--point-gold);
}
.point-page .point-related-row:disabled {
  opacity: 1;
}
.atlas-panel-lead {
  font-size: var(--point-meta-size);
  color: var(--point-ink);
  line-height: 1.8;
  margin: 12px 0 23px;
}
.atlas-panel-lead span {
  color: var(--point-ink);
}
.atlas-search {
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid #ced2c2;
  color: var(--point-ink);
  padding: 10px 0;
}
.atlas-search input {
  width: 100%;
  padding: 0;
  min-width: 0;
  font-size: var(--point-body-size);
}
.atlas-search input::placeholder {
  color: var(--point-ink);
}
.point-virtual-list {
  position: relative;
}
.point-list-row {
  position: absolute;
  inset: 0 0 auto;
  height: 92px;
}
.point-list-row > span:first-child {
  min-width: 0;
}
.point-list-row strong {
  display: block;
  font-weight: 400;
  font-size: var(--point-body-size);
  color: var(--point-ink);
}
.point-list-row small {
  display: block;
  font-size: var(--point-meta-size);
  color: var(--point-ink);
  margin-top: 5px;
}
.point-list-row strong,
.point-list-row small {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.point-list-state {
  flex-shrink: 0;
  font-size: var(--point-meta-size);
  color: var(--point-ink);
}
.atlas-confirm-step {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--point-meta-size);
  color: var(--point-ink);
}
.atlas-confirm-step i {
  height: 1px;
  width: 20px;
  background: #d4d9c7;
}
.atlas-confirm-step span:last-child {
  color: var(--point-ink);
}
.point-confirmation {
  padding: 29px 0 0;
}
.point-confirmation h4 {
  margin: 0 0 14px;
  font-size: 24px;
  font-weight: 400;
  line-height: 1.6;
  letter-spacing: 0.02em;
}
.point-confirmation > p {
  font-size: var(--point-body-size);
  line-height: 1.9;
  color: var(--point-ink);
}
.point-page .select-all {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--point-ink);
  font-size: var(--point-body-size);
  padding: 9px 0;
  margin: 12px 0 10px;
}
.point-choices {
  display: grid;
  gap: 10px;
  margin-top: 25px;
}
.point-choice {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 17px 15px;
  border: 1px solid var(--point-line);
  border-radius: 9px;
  font-size: var(--point-body-size);
  line-height: 1.8;
  color: var(--point-ink);
  cursor: pointer;
}
.point-choice.chosen {
  border-color: #bdc5ac;
  background: #f3f4eb;
  color: var(--point-ink);
}
.point-choice input {
  margin: 5px 0 0;
  accent-color: #566249;
  width: 18px;
  height: 18px;
}
.point-choice small {
  display: block;
  color: var(--point-ink);
  font-size: var(--point-meta-size);
}
.atlas-confirm-footer {
  flex: 0 0 auto;
  padding: 21px 30px;
  border-top: 1px solid var(--point-line);
  background: var(--point-paper);
}
.point-confirm-actions {
  display: grid;
  gap: 8px;
}
.point-page .atlas-skip {
  padding: 9px;
  font-size: var(--point-body-size);
  color: var(--point-ink);
}
.restore-details {
  position: absolute;
  right: 24px;
  top: 80px;
  max-width: 250px;
  padding: 14px 18px !important;
  display: flex;
  align-items: center;
  gap: 14px;
  border-radius: 12px !important;
  border: 1px solid #dedfd2 !important;
  background: #fffefaf2 !important;
  box-shadow: 0 4px 18px #424b3110 !important;
  font-size: var(--point-body-size) !important;
  color: var(--point-ink) !important;
}
@media (max-width: 1050px) {
  .point-panel-head {
    padding: 25px 26px;
  }
  .point-panel-body {
    padding: 0 26px 26px;
  }
  .atlas-confirm-footer {
    padding: 20px 26px;
  }
}
@media (max-width: 740px) {
  .atlas-header {
    height: 56px;
    min-height: 56px;
    padding: 0 18px;
  }
  .atlas-brand {
    gap: 9px;
  }
  .atlas-brand > span {
    font-size: 19px;
  }
  .atlas-brand i {
    margin: 0 2px;
  }
  .atlas-header-actions {
    gap: 14px;
  }
  .atlas-header-actions button span {
    display: none;
  }
  .atlas-header-actions a {
    padding-left: 14px;
    font-size: var(--point-meta-size);
  }
  .atlas-brand h1 {
    font-size: var(--point-body-size);
  }
  .point-workspace {
    position: relative;
  }
  .point-panel {
    position: absolute;
    inset: 0 0 0 auto;
    width: min(350px, 90vw);
    box-shadow: -12px 0 50px #30392a10;
  }
  .point-panel-resize {
    display: none;
  }
  .point-filters {
    left: 16px;
    top: 16px;
    max-width: calc(100% - 84px);
    gap: 6px;
  }
  .atlas-filter-options {
    backdrop-filter: none;
    padding: 2px;
  }
  .atlas-scope-select {
    flex: 1 1 100px;
  }
  .atlas-category-select {
    flex: 1.5 1 150px;
  }
  .point-page .atlas-directory-trigger {
    left: 16px;
    top: 70px;
  }
  .point-page-caption {
    padding: 0 14px;
    font-size: var(--point-meta-size);
  }
  .atlas-save-state {
    display: none;
  }
  .point-panel-head {
    padding: 23px 25px;
  }
  .point-panel-tools {
    margin-bottom: 18px;
  }
  .point-panel h3 {
    font-size: var(--point-title-size);
  }
  .point-panel-body {
    padding: 0 25px 25px;
  }
  .atlas-confirm-footer {
    padding: 18px 25px;
  }
  .restore-details {
    top: auto;
    bottom: 55px;
    right: 18px;
  }
}
</style>
