<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { VISIT_LABELS, SCOPE_CONFIGS, getScopeConfig, type Scope } from '@fangyu/contracts';
import { useAppStore } from '../app/store.js';
import MapSurface from '../components/MapSurface.vue';
import VisitStateSelect from '../components/VisitStateSelect.vue';
import TopicCoverage from '../components/TopicCoverage.vue';
import PointIcon from '../components/PointIcon.vue';
import PointSelect from '../components/PointSelect.vue';
import { useCatalogNavigation } from '../features/catalog/use-catalog-navigation.js';
import { useResizablePanel } from '../features/maps/use-resizable-panel.js';
import { searchText } from '../features/search-text.js';
const props = defineProps<{ scope: Scope }>();
const store = useAppStore();
const route = useRoute();
const router = useRouter();
const session = computed(() => store.session!);
const index = computed(() => session.value.index);
const config = computed(() => getScopeConfig(props.scope));
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
  showAllChildren,
  select,
} = useCatalogNavigation(scope);
const workspace = ref<HTMLElement>();
const panelElement = ref<HTMLElement>();
const { width, maxWidth, resizing, down, move, up, key } = useResizablePanel(workspace);
const panelOpen = ref(false);
const filterOpen = ref(false);
const scopeMenuOpen = ref(false);
const explorer = ref<HTMLElement>();
let explorerHovered = false;
function closeExplorer() {
  if (explorer.value?.contains(document.activeElement))
    explorer.value.querySelector<HTMLButtonElement>('.region-map-button')?.focus();
  filterOpen.value = false;
  scopeMenuOpen.value = false;
}
function enterExplorer(event: PointerEvent) {
  if (event.pointerType === 'mouse') {
    explorerHovered = true;
    filterOpen.value = true;
  }
}
function leaveExplorer(event: PointerEvent) {
  if (event.pointerType === 'mouse') {
    explorerHovered = false;
    closeExplorer();
  }
}
function clickExplorer(event: MouseEvent) {
  if (explorerHovered && event.detail > 0) filterOpen.value = true;
  else if (filterOpen.value) closeExplorer();
  else filterOpen.value = true;
}
function focusOutExplorer(event: FocusEvent) {
  if (!explorer.value?.contains(event.relatedTarget as Node | null)) closeExplorer();
}
function outsideExplorer(event: PointerEvent) {
  if (filterOpen.value && !explorer.value?.contains(event.target as Node)) closeExplorer();
}
onMounted(() => document.addEventListener('pointerdown', outsideExplorer));
onBeforeUnmount(() => document.removeEventListener('pointerdown', outsideExplorer));
const query = ref('');
const status = ref('');
const camera = computed(() =>
  store.regionalMap?.scope === props.scope ? store.regionalMap.camera : undefined,
);
const matching = computed(() => {
  void store.revision;
  const text = searchText(query.value.trim());
  return regions.value.filter(
    (region) =>
      (!text ||
        searchText(
          `${region.name} ${region.aliases.join(' ')} ${region.code} ${index.value.paths.get(region.id)}`,
        ).includes(text)) &&
      (!status.value ||
        (session.value.visitState(region.id) !== 'unvisited') === (status.value === 'visited')),
  );
});
const directory = computed(() =>
  query.value || status.value
    ? matching.value.slice(0, 160)
    : selected.value
      ? visibleChildren.value
      : regionGroups.value.flatMap((group) => group.items),
);
const regionCount = computed(() => {
  void store.revision;
  return regions.value.filter((r) => session.value.visitState(r.id) !== 'unvisited').length;
});
watch(
  () => selected.value?.id,
  (id) => {
    if (id) panelOpen.value = true;
  },
  { immediate: true },
);
watch(scope, () => {
  query.value = '';
  status.value = '';
  scopeMenuOpen.value = false;
  panelOpen.value = false;
});
function choose(id: string) {
  select(id);
  panelOpen.value = true;
}
function chooseSearch(id: string) {
  choose(id);
  query.value = '';
}
function switchScope(value: string) {
  closeExplorer();
  void router.push('/regions/' + value);
}
async function openPanel() {
  panelOpen.value = true;
  await nextTick();
  panelElement.value?.focus({ preventScroll: true });
}
</script>
<template>
  <section
    ref="workspace"
    class="region-page"
    :class="{ resizing }"
    :style="{ '--region-panel-width': width + 'px' }"
  >
    <div class="region-map-main">
      <MapSurface
        :scope="scope"
        :selected="store.selectedRegionId"
        :level="level"
        :initial-camera="camera"
        :points="[]"
        region-mode
        @select="choose"
        @level="changeLevel"
        @overview="choose('')"
      />
      <div
        ref="explorer"
        class="region-explorer"
        @pointerenter="enterExplorer"
        @pointerleave="leaveExplorer"
        @focusout="focusOutExplorer"
        @keydown.esc="closeExplorer"
      >
        <button
          class="region-map-button"
          aria-label="区域探索筛选"
          :aria-expanded="filterOpen"
          @click="clickExplorer"
        >
          <PointIcon name="compass" />
        </button>
        <div
          v-if="filterOpen"
          class="region-explorer-menu"
        >
          <PointSelect
            label="区域点卯范围"
            :model-value="scope"
            :options="SCOPE_CONFIGS.map((c) => ({ value: c.id, label: c.name }))"
            :open="scopeMenuOpen"
            @update:open="scopeMenuOpen = $event"
            @update:model-value="switchScope"
          />
          <select
            aria-label="地区"
            :value="
              scope === 'china'
                ? province
                : scope === 'france'
                  ? franceRoot?.id || ''
                  : store.selectedRegionId
            "
            @change="choose(($event.target as HTMLSelectElement).value)"
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
              @change="choose(($event.target as HTMLSelectElement).value || province)"
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
              @change="choose(($event.target as HTMLSelectElement).value || city || province)"
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
              @change="choose(($event.target as HTMLSelectElement).value || franceRoot!.id)"
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
              @change="choose(($event.target as HTMLSelectElement).value || franceDepartment!.id)"
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
        </div>
      </div>
      <button
        class="region-directory-button region-map-button"
        aria-label="地区目录"
        @click="openPanel"
      >
        <PointIcon name="list" />
      </button>
      <button
        v-if="selected && !panelOpen"
        class="region-reopen"
        @click="openPanel"
      >
        {{ selected.name
        }}<PointIcon
          name="arrow"
          :size="16"
        />
      </button>
      <footer class="region-caption">
        <span>{{ config.name }} · {{ regionCount }} / {{ regions.length }} 个地区已标记</span>
        <div>
          <span role="status">{{ store.saveStatus }}</span
          ><button
            aria-label="撤销最近操作"
            :disabled="!store.canUndo"
            @click="store.undo()"
          >
            <PointIcon
              name="undo"
              :size="16"
            />
          </button>
        </div>
      </footer>
    </div>
    <aside
      v-if="panelOpen"
      ref="panelElement"
      class="region-panel"
      aria-label="地区资料"
      tabindex="-1"
      @keydown.esc="panelOpen = false"
    >
      <div
        class="region-resize"
        role="separator"
        tabindex="0"
        aria-label="调整地区资料栏宽度"
        aria-orientation="vertical"
        :aria-valuemin="320"
        :aria-valuemax="maxWidth"
        :aria-valuenow="Math.round(width)"
        @pointerdown="down"
        @pointermove="move"
        @pointerup="up"
        @pointercancel="up"
        @lostpointercapture="up"
        @keydown="key"
      />
      <header class="region-panel-head">
        <div class="region-panel-kicker">
          <span>{{ config.boundaryLabel }}</span
          ><button
            aria-label="收起地区资料栏"
            @click="panelOpen = false"
          >
            <PointIcon name="close" />
          </button>
        </div>
        <h1>{{ selected?.name || config.name }}</h1>
        <VisitStateSelect
          v-if="selected"
          :region-id="selected.id"
          :propagate="scope !== 'france'"
        />
        <span
          v-else
          class="region-description"
          >选择地图中的地区，或在目录中查找。</span
        >
      </header>
      <div class="region-panel-body">
        <RouterLink
          v-if="route.query.from === 'achievements'"
          to="/achievements"
          class="region-backlink"
          >返回旅行成就</RouterLink
        >
        <dl
          v-if="selected"
          class="region-facts"
        >
          <div>
            <dt>地区路径</dt>
            <dd>{{ index.paths.get(selected.id) }}</dd>
          </div>
          <div>
            <dt>地区代码</dt>
            <dd>{{ selected.code }}</dd>
          </div>
          <div v-if="selected.originalName">
            <dt>原文名称</dt>
            <dd>{{ selected.originalName }}</dd>
          </div>
        </dl>
        <nav
          v-if="selected && scope === 'france'"
          class="region-breadcrumbs"
          aria-label="法国地区路径"
        >
          <button @click="choose('')">法国全部大区</button
          ><button
            v-for="region in francePath"
            :key="region.id"
            :aria-current="region.id === selected.id ? 'location' : undefined"
            @click="choose(region.id)"
          >
            {{ region.name }}</button
          ><button @click="franceBack">返回上一级</button>
        </nav>
        <button
          v-else-if="selected"
          class="region-backlink"
          @click="
            choose(
              selected.parentId && index.regions.get(selected.parentId)?.scope === scope
                ? selected.parentId
                : '',
            )
          "
        >
          <PointIcon
            name="back"
            :size="16"
          />返回上一级
        </button>
        <div
          v-if="scope === 'france'"
          class="region-statistics"
        >
          <span
            v-for="item in franceStatistics"
            :key="item.label"
            >{{ item.label }}：{{ item.count }} / {{ item.total }} 已到访</span
          >
        </div>
        <label class="region-search"
          ><PointIcon name="search" /><input
            v-model="query"
            type="search"
            aria-label="搜索行政区"
            placeholder="搜索地区、代码或别名"
        /></label>
        <select
          v-model="status"
          aria-label="区域到访筛选"
        >
          <option value="">全部状态</option>
          <option value="visited">已标记</option>
          <option value="unvisited">未标记</option>
        </select>
        <div class="region-directory-heading">
          <h2>{{ query || status ? '查找结果' : selected ? '下辖地区' : '地区目录' }}</h2>
          <span>{{
            query || status ? matching.length : selected ? childRegions.length : directory.length
          }}</span>
        </div>
        <p
          v-if="!directory.length"
          class="region-description"
        >
          {{ selected && !query && !status ? '没有已收录的下辖地区。' : '没有符合条件的地区。' }}
        </p>
        <button
          v-for="region in directory"
          :key="region.id"
          class="region-row"
          @click="query ? chooseSearch(region.id) : choose(region.id)"
        >
          <i :style="{ background: store.colors[session.visitState(region.id)] }" /><span>{{
            region.name
          }}</span
          ><small>{{ VISIT_LABELS[session.visitState(region.id)] }}</small
          ><PointIcon
            name="chevron"
            :size="14"
          />
        </button>
        <p
          v-if="(query || status) && matching.length > directory.length"
          class="region-description"
        >
          显示前 {{ directory.length }} 项，请缩小查找范围。
        </p>
        <button
          v-if="selected && !query && !status && scope !== 'france' && childRegions.length > 18"
          class="region-show-all"
          @click="showAllChildren = !showAllChildren"
        >
          {{ showAllChildren ? '收起下辖地区' : `显示全部 ${childRegions.length} 个地区` }}
        </button>
        <TopicCoverage :scope="scope" />
      </div>
    </aside>
  </section>
</template>
<style scoped>
.region-page {
  height: calc(100dvh - 56px);
  min-height: 480px;
  display: flex;
  overflow: hidden;
  background: var(--atlas-paper);
  position: relative;
}
.region-map-main {
  position: relative;
  flex: 1;
  min-width: 0;
  padding-bottom: 40px;
}
.region-map-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border: 1px solid var(--atlas-line);
  border-radius: 12px;
  background: var(--atlas-paper);
  padding: 0;
}
.region-map-button:hover {
  background: var(--atlas-soft);
}
.region-explorer {
  position: absolute;
  top: 24px;
  left: 24px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  z-index: 7;
}
.region-explorer-menu {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  max-width: calc(100vw - 150px);
  padding: 4px 8px;
  background: var(--atlas-paper);
  border: 1px solid var(--atlas-line);
  border-radius: 12px;
}
.region-explorer-menu select {
  width: auto;
  max-width: 190px;
  height: 34px;
  border: 0;
  background: transparent;
  padding: 0 6px;
}
.region-directory-button {
  position: absolute;
  left: 24px;
  top: 80px;
  z-index: 3;
}
.region-reopen {
  position: absolute;
  right: 80px;
  top: 24px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--atlas-paper);
  padding: 10px 14px;
}
.region-caption {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 40px;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  border-top: 1px solid var(--atlas-line);
  background: var(--atlas-paper);
  padding: 0 24px;
  font-size: 14px;
}
.region-caption div {
  display: flex;
  align-items: center;
  gap: 12px;
}
.region-caption button {
  padding: 0;
  border: 0;
  background: transparent;
}
.region-panel {
  position: relative;
  width: var(--region-panel-width);
  flex: none;
  display: flex;
  flex-direction: column;
  min-width: 0;
  border-left: 1px solid var(--atlas-line);
  background: var(--atlas-paper);
  outline: none;
}
.region-panel-head {
  flex: none;
  padding: 30px 30px 26px;
  border-bottom: 1px solid var(--atlas-line);
}
.region-panel-kicker {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  font-size: 14px;
  margin-bottom: 18px;
}
.region-panel-kicker button {
  display: flex;
  padding: 0;
  border: 0;
  background: transparent;
}
.region-panel-head h1 {
  font: 300 32px/1.45 var(--atlas-title-font);
  margin: 0 0 20px;
  overflow-wrap: anywhere;
}
.region-panel-head :deep(.state-select) {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  font-size: 14px;
}
.region-panel-head :deep(select) {
  min-width: 160px;
  font-size: 16px;
}
.region-panel-head :deep(small) {
  font-size: 14px;
}
.region-panel-body {
  overflow: auto;
  min-height: 0;
  flex: 1;
  padding: 24px 30px 32px;
}
.region-facts {
  margin: 0 0 22px;
  font-size: 14px;
}
.region-facts div {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 16px;
  margin-bottom: 12px;
}
.region-facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.region-backlink {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  background: transparent;
  padding: 0;
  margin-bottom: 24px;
  color: var(--atlas-ink);
  text-decoration: none;
  font-size: 14px;
}
.region-description {
  font-size: 14px;
  line-height: 1.8;
}
.region-search {
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid var(--atlas-line);
  margin: 18px 0 14px;
}
.region-search input {
  width: 100%;
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 12px 0;
  min-width: 0;
}
.region-panel-body > select {
  width: 100%;
}
.region-directory-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 24px 0 10px;
  font-size: 14px;
}
.region-directory-heading h2 {
  font-size: 16px;
  font-weight: 400;
  margin: 0;
}
.region-row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 9px;
  text-align: left;
  border: 0;
  border-radius: 0;
  border-bottom: 1px solid var(--atlas-line);
  background: transparent;
  padding: 15px 0;
}
.region-row i {
  width: 9px;
  height: 9px;
  flex: none;
  border-radius: 2px;
  border: 1px solid #56645630;
}
.region-row span {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.region-row small {
  font-size: 14px;
  white-space: nowrap;
}
.region-row svg {
  transform: rotate(-90deg);
}
.region-row:hover {
  background: var(--atlas-soft);
}
.region-show-all {
  width: 100%;
  margin-top: 14px;
}
.region-breadcrumbs {
  gap: 8px;
  margin-bottom: 20px;
}
.region-breadcrumbs button {
  font-size: 14px;
  padding: 5px 8px;
}
.region-statistics {
  display: grid;
  gap: 8px;
  font-size: 14px;
}
.region-resize {
  position: absolute;
  z-index: 4;
  top: 0;
  bottom: 0;
  left: -5px;
  width: 10px;
  cursor: col-resize;
  touch-action: none;
}
.region-resize:focus-visible {
  outline: 2px solid var(--atlas-accent);
  outline-offset: -4px;
}
.resizing {
  user-select: none;
  cursor: col-resize;
}
@media (max-width: 740px) {
  .region-panel {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: min(350px, 90vw);
    z-index: 9;
  }
  .region-resize {
    display: none;
  }
  .region-explorer {
    top: 16px;
    left: 16px;
  }
  .region-directory-button {
    left: 16px;
    top: 70px;
  }
  .region-explorer-menu {
    max-width: calc(100vw - 88px);
  }
  .region-caption {
    padding: 0 16px;
    font-size: 14px;
  }
  .region-caption div > span {
    display: none;
  }
  .region-panel-head {
    padding: 24px;
  }
  .region-panel-body {
    padding: 20px 24px;
  }
}
</style>
