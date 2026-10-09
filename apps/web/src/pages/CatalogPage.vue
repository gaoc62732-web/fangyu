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
  franceStatistics,
  franceBack,
  level,
  changeLevel,
  showAllChildren,
  select,
} = useCatalogNavigation(scope);
const workspace = ref<HTMLElement>();
const panelElement = ref<HTMLElement>();
const explorerElement = ref<HTMLElement>();
const explorerInput = ref<HTMLInputElement>();
const { width, maxWidth, resizing, down, move, up, key } = useResizablePanel(workspace);
const panelOpen = ref(false);
const explorerSearchOpen = ref(false);
const scopeMenuOpen = ref(false);
const query = ref('');
const explorerQuery = ref('');
const status = ref('');
const draftRegionId = ref('');
const searchTargetId = ref('');
const suggestionsOpen = ref(false);
const camera = computed(() =>
  store.regionalMap?.scope === props.scope ? store.regionalMap.camera : undefined,
);
const draftPath = computed(() =>
  draftRegionId.value
    ? index.value.ancestors(draftRegionId.value).filter((region) => region.scope === scope.value)
    : [],
);
const draftProvince = computed(
  () => draftPath.value.find((region) => region.scope === 'china' && region.level === 0)?.id || '',
);
const chinaProvinces = computed(() => regions.value.filter((region) => region.level === 0));
const draftCity = computed(
  () => draftPath.value.find((region) => region.scope === 'china' && region.level === 1)?.id || '',
);
const draftCounty = computed(
  () => draftPath.value.find((region) => region.scope === 'china' && region.level === 2)?.id || '',
);
const chinaTextCanvas = typeof document === 'undefined' ? null : document.createElement('canvas');
const chinaTextContext = chinaTextCanvas?.getContext('2d');
function chinaLevelWidthPixels(id: string, placeholder: string) {
  const label = id ? index.value.regions.get(id)?.name || placeholder : placeholder;
  let textWidth = Array.from(label).length * 13;
  if (chinaTextContext && typeof document !== 'undefined') {
    const fontFamily = getComputedStyle(document.documentElement).getPropertyValue('--atlas-font').trim();
    chinaTextContext.font = `13px ${fontFamily || 'sans-serif'}`;
    textWidth = chinaTextContext.measureText(label).width;
  }
  return Math.ceil(Math.max(textWidth, 7 * 13) + 88);
}
function chinaLevelWidth(id: string, placeholder: string) {
  return `${chinaLevelWidthPixels(id, placeholder)}px`;
}
const chinaLevelsWidth = computed(
  () =>
    `${chinaLevelWidthPixels(draftProvince.value, '省') + chinaLevelWidthPixels(draftCity.value, '市') + chinaLevelWidthPixels(draftCounty.value, '县')}px`,
);
const draftFranceRoot = computed(() => draftPath.value.find((region) => region.level === 1));
const draftFranceDepartment = computed(() => draftPath.value.find((region) => region.level === 2));
const franceDraftLevelCount = computed(() =>
  draftFranceDepartment.value?.sourceCode === '75'
    ? 3
    : draftFranceRoot.value?.code === 'FR-IDF'
      ? 2
      : 1,
);
const draftFranceDepartments = computed(() =>
  regions.value.filter(
    (region) => region.level === 2 && region.parentId === draftFranceRoot.value?.id,
  ),
);
const draftFranceArrondissements = computed(() =>
  regions.value.filter(
    (region) => region.level === 3 && region.parentId === draftFranceDepartment.value?.id,
  ),
);
const chinaCities = computed(() =>
  regions.value.filter((region) => region.level === 1 && region.parentId === draftProvince.value),
);
const chinaCounties = computed(() =>
  regions.value.filter(
    (region) =>
      region.level === 2 &&
      draftProvince.value &&
      index.value.belongsTo(region.id, draftCity.value || draftProvince.value),
  ),
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
const searchSuggestions = computed(() => {
  const text = searchText(explorerQuery.value.trim());
  if (!text) return [];
  const matches = regions.value.filter((region) =>
    searchText(`${region.name} ${region.aliases.join(' ')} ${region.code}`).includes(text),
  );
  const rank = (region: (typeof regions.value)[number]) => {
    const name = searchText(region.name);
    return name === text ? 0 : name.startsWith(text) ? 1 : 2;
  };
  return matches.sort((a, b) => rank(a) - rank(b)).slice(0, 8);
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
  explorerQuery.value = '';
  status.value = '';
  draftRegionId.value = '';
  searchTargetId.value = '';
  suggestionsOpen.value = false;
  scopeMenuOpen.value = false;
  panelOpen.value = false;
});
watch(
  () => selected.value?.id,
  (id) => {
    draftRegionId.value = id || '';
  },
  { immediate: true },
);
function focusOutExplorer(event: FocusEvent) {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null))
    suggestionsOpen.value = false;
}
function closeExplorerSearch() {
  explorerSearchOpen.value = false;
  suggestionsOpen.value = false;
}
function outsideExplorer(event: PointerEvent) {
  if (explorerSearchOpen.value && !explorerElement.value?.contains(event.target as Node))
    closeExplorerSearch();
}
async function openExplorerSearch() {
  explorerSearchOpen.value = true;
  await nextTick();
  explorerInput.value?.focus({ preventScroll: true });
}
function choose(id: string) {
  select(id);
  panelOpen.value = true;
}
function updateSearchQuery(event: Event) {
  explorerQuery.value = (event.target as HTMLInputElement).value;
  searchTargetId.value = '';
  suggestionsOpen.value = !!explorerQuery.value.trim();
}
function chooseDraft(id: string) {
  draftRegionId.value = id;
  searchTargetId.value = id;
  explorerQuery.value = index.value.regions.get(id)?.name || '';
  suggestionsOpen.value = false;
}
function chooseSuggestion(id: string) {
  chooseDraft(id);
}
function chooseSearch(id: string) {
  choose(id);
  query.value = '';
}
function submitSearch() {
  const target = index.value.regions.get(searchTargetId.value);
  if (!target || target.scope !== scope.value) return;
  if (target.scope === 'china') {
    changeLevel(target.level === 0 ? 'province' : target.level === 1 ? 'city' : 'county');
  }
  choose(target.id);
  suggestionsOpen.value = false;
}
function switchScope(value: string) {
  scopeMenuOpen.value = false;
  void router.push('/regions/' + value);
}
async function openPanel() {
  panelOpen.value = true;
  await nextTick();
  panelElement.value?.focus({ preventScroll: true });
}
onMounted(() => document.addEventListener('pointerdown', outsideExplorer));
onBeforeUnmount(() => document.removeEventListener('pointerdown', outsideExplorer));
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
        ref="explorerElement"
        class="region-explorer"
        @focusout="focusOutExplorer"
      >
        <div
          class="region-explorer-menu"
          :class="{ 'is-expanded': explorerSearchOpen }"
        >
          <div class="region-explorer-scope">
            <PointSelect
              :label="`${config.name}范围`"
              :model-value="scope"
              :options="SCOPE_CONFIGS.map((c) => ({ value: c.id, label: c.name }))"
              :open="scopeMenuOpen"
              :hover-open="false"
              @update:open="scopeMenuOpen = $event"
              @update:model-value="switchScope"
            />
          </div>
          <div
            class="region-explorer-main"
            :style="{ '--china-levels-width': scope === 'china' ? chinaLevelsWidth : undefined }"
          >
            <button
              v-if="!explorerSearchOpen"
              class="region-explorer-toggle"
              type="button"
              aria-label="展开地区搜索和选择"
              :aria-expanded="explorerSearchOpen"
              @click="openExplorerSearch"
            >
              <PointIcon name="search" />
            </button>
            <Transition name="region-explorer-reveal">
              <div
                v-if="explorerSearchOpen"
                class="region-explorer-content"
              >
            <form
              class="region-explorer-search"
              role="search"
              @submit.prevent="submitSearch"
            >
              <input
                ref="explorerInput"
                :value="explorerQuery"
                type="search"
                aria-label="搜索地区"
                placeholder="搜索地区"
                autocomplete="off"
                @input="updateSearchQuery"
                @keydown.esc="suggestionsOpen ? (suggestionsOpen = false) : closeExplorerSearch()"
              />
              <button
                type="submit"
                aria-label="搜索并跳转到所选地区"
                :disabled="!searchTargetId"
              >
                <PointIcon name="search" />
              </button>
            </form>
            <div
              v-if="scope === 'china'"
              class="region-explorer-levels is-china"
            >
              <div
                class="region-explorer-level"
                :style="{ '--region-level-width': chinaLevelWidth(draftProvince, '省') }"
              >
                <select
                  :value="draftProvince"
                  aria-label="省"
                  required
                  @change="chooseDraft(($event.target as HTMLSelectElement).value)"
                >
                  <option
                    value=""
                    disabled
                    hidden
                  ></option>
                  <option
                    v-for="region in chinaProvinces"
                    :key="region.id"
                    :value="region.id"
                  >
                    {{ region.name }}
                  </option>
                </select>
                <span
                  v-if="!draftProvince"
                  class="region-explorer-placeholder"
                  aria-hidden="true"
                  >省</span
                >
              </div>
              <div
                class="region-explorer-level"
                :style="{ '--region-level-width': chinaLevelWidth(draftCity, '市') }"
              >
                <select
                  :value="draftCity"
                  aria-label="市"
                  :disabled="!draftProvince"
                  required
                  @change="chooseDraft(($event.target as HTMLSelectElement).value || draftProvince)"
                >
                  <option
                    value=""
                    disabled
                    hidden
                  ></option>
                  <option
                    v-for="region in chinaCities"
                    :key="region.id"
                    :value="region.id"
                  >
                    {{ region.name }}
                  </option>
                </select>
                <span
                  v-if="!draftCity"
                  class="region-explorer-placeholder"
                  aria-hidden="true"
                  >市</span
                >
              </div>
              <div
                class="region-explorer-level"
                :style="{ '--region-level-width': chinaLevelWidth(draftCounty, '县') }"
              >
                <select
                  :value="draftCounty"
                  aria-label="县"
                  :disabled="!draftProvince"
                  required
                  @change="chooseDraft(($event.target as HTMLSelectElement).value || draftCity || draftProvince)"
                >
                  <option
                    value=""
                    disabled
                    hidden
                  ></option>
                  <option
                    v-for="region in chinaCounties"
                    :key="region.id"
                    :value="region.id"
                  >
                    {{ region.name }}
                  </option>
                </select>
                <span
                  v-if="!draftCounty"
                  class="region-explorer-placeholder"
                  aria-hidden="true"
                  >县</span
                >
              </div>
            </div>
            <div
              v-else-if="scope === 'france'"
              class="region-explorer-levels"
              :class="{
                'is-single': franceDraftLevelCount === 1,
                'is-double': franceDraftLevelCount === 2,
              }"
            >
              <select
                :value="draftFranceRoot?.id || ''"
                aria-label="大区"
                @change="chooseDraft(($event.target as HTMLSelectElement).value)"
              >
                <option value="">大区</option>
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
              <select
                v-if="draftFranceRoot?.code === 'FR-IDF'"
                :value="draftFranceDepartment?.id || ''"
                aria-label="省级单位"
                @change="chooseDraft(($event.target as HTMLSelectElement).value || draftFranceRoot!.id)"
              >
                <option value="">省级单位</option>
                <option
                  v-for="region in draftFranceDepartments"
                  :key="region.id"
                  :value="region.id"
                >
                  {{ region.name }}
                </option>
              </select>
              <select
                v-if="draftFranceDepartment?.sourceCode === '75'"
                :value="draftPath.find((region) => region.level === 3)?.id || ''"
                aria-label="市区"
                @change="chooseDraft(($event.target as HTMLSelectElement).value || draftFranceDepartment!.id)"
              >
                <option value="">市区</option>
                <option
                  v-for="region in draftFranceArrondissements"
                  :key="region.id"
                  :value="region.id"
                >
                  {{ region.name }}
                </option>
              </select>
            </div>
            <div
              v-else
              class="region-explorer-levels is-single"
            >
              <select
                :value="draftRegionId"
                aria-label="地区"
                @change="chooseDraft(($event.target as HTMLSelectElement).value)"
              >
                <option value="">地区</option>
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
            </div>
              </div>
            </Transition>
            <div
              v-if="suggestionsOpen"
              class="region-explorer-suggestions"
              role="listbox"
              aria-label="地区搜索建议"
            >
              <button
                v-for="region in searchSuggestions"
                :key="region.id"
                type="button"
                role="option"
                :aria-selected="searchTargetId === region.id"
                @click="chooseSuggestion(region.id)"
              >
                <span>{{ region.name }}</span>
                <small>{{ index.paths.get(region.id) }}</small>
              </button>
              <p v-if="!searchSuggestions.length">没有找到匹配地区</p>
            </div>
          </div>
        </div>
      </div>
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
.region-explorer {
  position: absolute;
  top: 24px;
  left: 12px;
  z-index: 7;
  width: max-content;
  max-width: calc(100% - 24px);
}
.region-explorer-menu {
  position: relative;
  z-index: 2;
  display: grid;
  grid-template-columns: max-content 56px;
  grid-template-rows: 48px;
  width: max-content;
  max-width: 100%;
  padding: 0;
  background: var(--atlas-paper);
  border: 1px solid var(--atlas-line);
  border-radius: 12px;
  box-shadow: 0 8px 24px rgb(20 28 22 / 12%);
  interpolate-size: allow-keywords;
  transition: width 240ms ease, grid-template-rows 240ms ease;
}
.region-explorer-menu.is-expanded {
  grid-template-columns: max-content max-content;
  grid-template-rows: 84px;
  width: max-content;
  max-width: 100%;
}
.region-explorer-scope {
  display: flex;
  min-width: max-content;
  border-right: 1px solid var(--atlas-line);
}
.region-explorer-scope :deep(.point-select) {
  width: max-content;
}
.region-explorer-scope :deep(.point-select-trigger) {
  height: 100%;
  min-height: 48px;
  flex-direction: row;
  justify-content: center;
  gap: 8px;
  padding: 8px 14px;
  text-align: center;
}
.region-explorer-scope :deep(.point-select-trigger > span) {
  flex: none;
  white-space: normal;
  line-height: 1.35;
  text-align: center;
}
.region-explorer-main {
  position: relative;
  min-width: 0;
  width: 56px;
  max-width: 100%;
  transition: width 240ms ease;
}
.region-explorer-menu.is-expanded .region-explorer-main {
  width: var(--china-levels-width, max-content);
}
.region-explorer-toggle {
  display: grid;
  place-items: center;
  width: 56px;
  height: 48px;
  padding: 0;
  border: 0;
  border-radius: 0 11px 11px 0;
  background: transparent;
}
.region-explorer-toggle:hover {
  background: var(--atlas-soft);
}
.region-explorer-content {
  min-width: 0;
  width: 100%;
  max-width: 100%;
}
.region-explorer-reveal-enter-active,
.region-explorer-reveal-leave-active {
  transition: opacity 180ms ease, clip-path 240ms ease;
}
.region-explorer-reveal-enter-from,
.region-explorer-reveal-leave-to {
  opacity: 0;
  clip-path: inset(0 100% 100% 0);
}
.region-explorer-search {
  display: flex;
  align-items: center;
  height: 48px;
  gap: 10px;
  width: 100%;
  padding: 0 10px 0 16px;
  border-bottom: 1px solid var(--atlas-line);
}
.region-explorer-search input {
  width: 100%;
  min-width: 0;
  padding: 8px 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  color: var(--atlas-ink);
  font-size: 14px;
}
.region-explorer-search input:focus {
  outline: none;
}
.region-explorer-search button {
  display: grid;
  place-items: center;
  flex: none;
  width: 38px;
  height: 38px;
  padding: 0;
  border: 0;
  background: transparent;
}
.region-explorer-search button:hover:not(:disabled) {
  background: var(--atlas-soft);
}
.region-explorer-levels {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  min-height: 36px;
}
.region-explorer-levels.is-china {
  display: flex;
  width: max-content;
  min-width: max-content;
  max-width: none;
  overflow: visible;
}
.region-explorer-levels.is-china .region-explorer-level {
  font-size: 13px;
}
.region-explorer-levels.is-single {
  grid-template-columns: minmax(0, 1fr);
}
.region-explorer-levels.is-double {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.region-explorer-level {
  position: relative;
  width: var(--region-level-width, calc(7em + 88px));
  min-width: 0;
  flex: 0 0 var(--region-level-width, calc(7em + 88px));
  border-right: 1px solid var(--atlas-line);
  transition: flex-basis 220ms ease, min-width 220ms ease;
}
.region-explorer-level:last-child {
  border-right: 0;
}
.region-explorer-levels select {
  width: 100%;
  min-width: 0;
  height: 36px;
  padding: 0 12px;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background: transparent;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.region-explorer-levels.is-china select {
  padding: 0 48px 0 12px;
  font-size: 13px;
}
.region-explorer-levels.is-china select:focus,
.region-explorer-levels.is-china select:focus-visible {
  outline: none !important;
  box-shadow: none !important;
}
.region-explorer-levels > select:not(:last-child) {
  border-right: 1px solid var(--atlas-line);
}
.region-explorer-placeholder {
  position: absolute;
  top: 50%;
  left: 12px;
  transform: translateY(-50%);
  color: var(--atlas-ink);
  opacity: 0.7;
  pointer-events: none;
  font-size: 14px;
  font-weight: 400;
}
.region-explorer-suggestions {
  position: absolute;
  z-index: 4;
  top: 48px;
  left: 0;
  right: 0;
  max-height: min(300px, 48vh);
  overflow-y: auto;
  border: 1px solid var(--atlas-line);
  border-radius: 0 0 10px 10px;
  background: var(--atlas-paper);
  box-shadow: 0 8px 24px rgb(20 28 22 / 14%);
}
.region-explorer-suggestions button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  width: 100%;
  min-height: 42px;
  padding: 8px 14px;
  border: 0;
  border-radius: 0;
  background: transparent;
  text-align: left;
}
.region-explorer-suggestions button:hover,
.region-explorer-suggestions button[aria-selected='true'] {
  background: var(--atlas-soft);
}
.region-explorer-suggestions button span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.region-explorer-suggestions button small {
  flex: none;
  max-width: 58%;
  overflow: hidden;
  color: var(--atlas-ink);
  opacity: 0.7;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.region-explorer-suggestions p {
  margin: 0;
  padding: 14px;
  font-size: 14px;
}
.region-explorer-levels select:disabled {
  opacity: 0.5;
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
    width: calc(100% - 32px);
    max-width: none;
  }
  .region-explorer-menu {
    max-width: 100%;
  }
  .region-explorer-menu.is-expanded {
    grid-template-columns: max-content minmax(0, 1fr);
    width: 100%;
  }
  .region-explorer-menu.is-expanded .region-explorer-main {
    width: 100%;
  }
  .region-explorer-scope :deep(.point-select-trigger) {
    padding: 8px 10px;
  }
  .region-explorer-search {
    gap: 6px;
    padding: 0 6px 0 10px;
  }
  .region-explorer-search input {
    font-size: 14px;
  }
  .region-explorer-levels.is-china select {
    padding: 0 40px 0 8px;
    font-size: 13px;
  }
  .region-explorer-menu.is-expanded {
    grid-template-rows: 156px;
  }
  .region-explorer-levels.is-china {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    width: 100%;
    max-width: none;
    overflow: visible;
  }
  .region-explorer-levels.is-china .region-explorer-level {
    width: 100%;
    min-width: 0;
    flex-basis: auto;
    border-right: 0;
    border-bottom: 1px solid var(--atlas-line);
  }
  .region-explorer-levels.is-china .region-explorer-level:last-child {
    border-bottom: 0;
  }
  .region-explorer-placeholder {
    left: 6px;
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
