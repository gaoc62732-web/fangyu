<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRef, watch, watchEffect } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { SCOPE_CONFIGS, getScopeConfig, type CatalogEntry, type Scope } from '@fangyu/contracts';
import { childVisited, pointView } from '@fangyu/domain';
import { useAppStore } from '../app/store.js';
import MapSurface from '../components/MapSurface.vue';
import VisitStateSelect from '../components/VisitStateSelect.vue';
import TopicCoverage from '../components/TopicCoverage.vue';
import PointIcon from '../components/PointIcon.vue';
import PointSelect from '../components/PointSelect.vue';
import HelpTip from '../components/HelpTip.vue';
import { useCatalogNavigation } from '../features/catalog/use-catalog-navigation.js';
import { useResizablePanel } from '../features/maps/use-resizable-panel.js';
import { useSharedMap } from '../features/maps/shared-map.js';
import { searchText } from '../features/search-text.js';
const props = defineProps<{ scope: Scope }>();
const store = useAppStore();
const route = useRoute();
const router = useRouter();
const sharedMap = useSharedMap();
const fallbackMapProps = computed(() => ({
  scope: scope.value,
  selected: store.selectedRegionId,
  selectionMuted: !panelOpen.value && Boolean(selected.value),
  level: level.value,
  points: [],
  initialCamera: camera.value,
  regionMode: true,
}));
const session = computed(() => store.session!);
const index = computed(() => session.value.index);
const config = computed(() => getScopeConfig(props.scope));
const scope = toRef(props, 'scope');
const {
  regions,
  selected,
  childRegions,
  regionGroups,
  franceStatistics,
  level,
  changeLevel,
  select,
} = useCatalogNavigation(scope);
const workspace = ref<HTMLElement>();
const explorerElement = ref<HTMLElement>();
const explorerInput = ref<HTMLInputElement>();
const { width, maxWidth, resizing, down, move, up, key } = useResizablePanel(workspace);
const panelOpen = ref(false);
const explorerSearchOpen = ref(false);
const scopeMenuOpen = ref(false);
const explorerQuery = ref('');
const draftRegionId = ref('');
const searchTargetId = ref('');
const suggestionsOpen = ref(false);
const expandedDirectory = ref<Record<string, boolean>>({});
const expandedRouteGroups = ref<Record<string, boolean>>({});
const expandedPointGroup = ref('');
const panelBody = ref<HTMLElement>();
let collapsingPointGroup = '';
let pointCollapseAnchor = '';
let pointCollapseFrame = 0;
let pointCollapseTimer = 0;
let pointCollapsePinned = false;
let pointCollapseElement: Element | undefined;
const regionBreadcrumbs = computed(() =>
  selected.value
    ? index.value.ancestors(selected.value.id).filter((region) => region.scope === scope.value)
    : [],
);
const camera = computed(() =>
  store.regionalMap?.scope === props.scope ? store.regionalMap.camera : undefined,
);
watchEffect(() => {
  Object.assign(sharedMap.view, {
    mode: 'regions',
    scope: scope.value,
    selected: store.selectedRegionId,
    selectionMuted: !panelOpen.value && Boolean(selected.value),
    level: level.value,
    category: '',
    points: [],
    focus: null,
    highlightedPointIds: [],
    focusPoints: null,
    initialCamera: camera.value,
    previewRegions: [],
    rightInset: panelOpen.value ? `${width.value}px` : '0px',
    onSelect: choose,
    onPoint: () => {},
    onLevel: changeLevel,
    onOverview: () => choose(''),
    onCluster: () => {},
  });
});
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
const directoryRoots = computed(() =>
  selected.value ? childRegions.value : regionGroups.value.flatMap((group) => group.items),
);
const directoryTree = computed(() => {
  const rows: { region: (typeof regions.value)[number]; depth: number; hasChildren: boolean }[] = [];
  const visit = (items: (typeof regions.value)[number][], depth: number) => {
    for (const region of items) {
      const children = index.value.children.get(region.id) || [];
      rows.push({ region, depth, hasChildren: children.length > 0 });
      if (children.length && expandedDirectory.value[region.id]) visit(children, depth + 1);
    }
  };
  visit(directoryRoots.value, 0);
  return rows;
});
const selectedRegionTitles = computed(() => [
  ...(selected.value?.cityTitles || []),
  ...(selected.value?.inheritedCityTitles || []),
]);
function toggleDirectory(id: string) {
  expandedDirectory.value[id] = !expandedDirectory.value[id];
}
function directoryKeydown(event: KeyboardEvent, id: string) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    toggleDirectory(id);
  }
}
function linkedRegionIds(entry: CatalogEntry) {
  return [
    ...new Set([
      ...index.value.entryRegions(entry, scope.value),
      ...entry.regionIds.map((id) => index.value.resolveRegion(id)),
    ]),
  ];
}
function pointItemsForRegion(entries: CatalogEntry[], regionId: string) {
  return entries.flatMap((entry) => {
    const children = entry.subitems.flatMap((child) => {
      const childRegionIds = (child.regionIds?.length ? child.regionIds : entry.regionIds).map(
        (id) => index.value.resolveRegion(id),
      );
      if (!childRegionIds.some((id) => id === regionId || index.value.belongsTo(id, regionId))) return [];
      return [{
        id: `${entry.id}__subitem__${child.id}`,
        name: child.name,
        entry,
        subitemId: child.id,
        checked: childVisited(session.value, { ...child, entryId: entry.id, subitemId: child.id }),
      }];
    });
    return [{
      id: entry.id,
      name: entry.name,
      entry,
      checked: pointView(session.value, entry).checked,
      children,
    }];
  });
}
function pointItemCount(items: ReturnType<typeof pointItemsForRegion>) {
  return items.reduce((count, item) => count + 1 + item.children.length, 0);
}
function pointCheckedCount(items: ReturnType<typeof pointItemsForRegion>) {
  return items.reduce(
    (count, item) => count + Number(item.checked) + item.children.filter((child) => child.checked).length,
    0,
  );
}
const excludedPointCategories = new Set(['historic-city', 'railway-station', 'urban-rail']);
const relatedEntries = computed(() => {
  void store.revision;
  const region = selected.value;
  if (!region) return [];
  return session.value.allEntries().filter((entry) => {
    if (entry.scope !== scope.value) return false;
    return linkedRegionIds(entry).some(
      (id) => id === region.id || index.value.belongsTo(id, region.id),
    );
  });
});
const pointGroups = computed(() => {
  const groups = new Map<string, typeof relatedEntries.value>();
  for (const entry of relatedEntries.value) {
    if (excludedPointCategories.has(entry.categoryId)) continue;
    const entries = groups.get(entry.categoryId) || [];
    entries.push(entry);
    groups.set(entry.categoryId, entries);
  }
  return [...groups].map(([categoryId, entries]) => {
    const items = pointItemsForRegion(entries, selected.value!.id);
    return {
      categoryId,
      name: index.value.catalog.categories.find((item) => item.id === categoryId)?.name || categoryId,
      entries,
      items,
      itemCount: pointItemCount(items),
      checked: pointCheckedCount(items),
      subregions: childRegions.value.flatMap((region) => {
        const regionEntries = entries.filter((entry) =>
          linkedRegionIds(entry).some(
            (id) => id === region.id || index.value.belongsTo(id, region.id),
          ) || pointItemsForRegion([entry], region.id).some((item) => item.children.length),
        );
        const regionItems = pointItemsForRegion(regionEntries, region.id);
        return regionItems.length
          ? [{
              id: region.id,
              name: region.name,
              entries: regionEntries,
              items: regionItems,
              itemCount: pointItemCount(regionItems),
              checked: pointCheckedCount(regionItems),
            }]
          : [];
      }),
    };
  }).filter((group) => group.items.length);
});
function openPoint(entry: CatalogEntry, subitemId?: string) {
  void router.push({
    path: '/points',
    query: { entry: entry.id, subitem: subitemId, scope: scope.value },
  });
}
const routeGroups = computed(() =>
  [
    { key: 'railway', label: '铁路站点', categoryId: 'railway-station' },
    { key: 'urban-rail', label: '轨道交通线路', categoryId: 'urban-rail' },
  ]
    .map((group) => ({
      ...group,
      entries: relatedEntries.value.filter((entry) => entry.categoryId === group.categoryId),
    }))
    .filter((group) => group.entries.length),
);
function routeItems(entries: typeof relatedEntries.value) {
  const labels = new Set<string>();
  for (const entry of entries) {
    for (const label of [...(entry.lines || []), ...(entry.operators || [])]) {
      if (label.trim()) labels.add(label.trim());
    }
  }
  return labels.size ? [...labels] : [...new Set(entries.map((entry) => entry.name))];
}
function toggleRouteGroup(key: string) {
  expandedRouteGroups.value[key] = !expandedRouteGroups.value[key];
}
function togglePointGroup(categoryId: string) {
  const previous = expandedPointGroup.value;
  const next = expandedPointGroup.value === categoryId ? '' : categoryId;
  stopPointCollapse();
  expandedPointGroup.value = next;
  collapsingPointGroup = previous && next ? previous : '';
  pointCollapseAnchor = collapsingPointGroup ? next : '';
}
function stopPointCollapse() {
  cancelAnimationFrame(pointCollapseFrame);
  window.clearTimeout(pointCollapseTimer);
  pointCollapseFrame = 0;
  pointCollapseTimer = 0;
  collapsingPointGroup = '';
  pointCollapseAnchor = '';
  pointCollapsePinned = false;
  pointCollapseElement = undefined;
}
function startPointCollapse(element: Element) {
  const categoryId = element.closest<HTMLElement>('.region-point-group')?.dataset.pointCategory;
  const container = panelBody.value;
  if (!container || categoryId !== collapsingPointGroup || !pointCollapseAnchor) return;
  const anchor = [...container.querySelectorAll<HTMLElement>('.region-point-group')].find(
    (item) => item.dataset.pointCategory === pointCollapseAnchor,
  );
  if (!anchor) return;
  pointCollapseElement = element;
  pointCollapsePinned = false;
  pointCollapseTimer = window.setTimeout(() => finishPointCollapse(element), 280);
  const boundary = container.getBoundingClientRect().top;
  const keepContentInPlace = () => {
    if (pointCollapseElement !== element) return;
    if (!element.isConnected || !container.isConnected || !anchor.isConnected) {
      stopPointCollapse();
      return;
    }
    const delta = anchor.getBoundingClientRect().top - boundary;
    if (pointCollapsePinned || delta < 0) {
      pointCollapsePinned = true;
      container.scrollTop += delta;
    }
    pointCollapseFrame = requestAnimationFrame(keepContentInPlace);
  };
  pointCollapseFrame = requestAnimationFrame(keepContentInPlace);
}
function finishPointCollapse(element: Element) {
  if (element !== pointCollapseElement) return;
  const container = panelBody.value;
  const anchor = [...(container?.querySelectorAll<HTMLElement>('.region-point-group') || [])].find(
    (item) => item.dataset.pointCategory === pointCollapseAnchor,
  );
  if (container && anchor && pointCollapsePinned) {
    const delta = anchor.getBoundingClientRect().top - container.getBoundingClientRect().top;
    container.scrollTop += delta;
  }
  stopPointCollapse();
}
const specialNotice = computed(() => selected.value?.notices || []);
const regionCount = computed(() => {
  void store.revision;
  return regions.value.filter((r) => session.value.visitState(r.id) !== 'unvisited').length;
});
watch(
  [() => selected.value?.id, () => JSON.stringify(store.chinaBoundarySettings)] as const,
  ([id, settingsKey], previous) => {
    const affiliationChanged = previous && settingsKey !== previous[1];
    if (affiliationChanged && id === previous[0]) return;
    expandedPointGroup.value = '';
    stopPointCollapse();
    if (id && !affiliationChanged) panelOpen.value = true;
  },
  { immediate: true },
);
watch(scope, () => {
  explorerQuery.value = '';
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
  panelOpen.value = Boolean(id) || scope.value !== 'china';
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
onMounted(() => document.addEventListener('pointerdown', outsideExplorer));
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', outsideExplorer);
  stopPointCollapse();
});
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
        v-if="!sharedMap.provided"
        v-bind="fallbackMapProps"
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
      <footer class="region-caption">
        <span>{{ config.name }} · {{ regionCount }} / {{ regions.length }} 个地区已标记</span>
        <div class="region-caption-tools">
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
      v-if="panelOpen && (selected || scope !== 'china')"
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
        <nav
          class="region-panel-breadcrumbs"
          :aria-label="`${config.name}地区路径`"
        >
          <template v-if="scope !== 'china'">
            <button
              type="button"
              :aria-current="selected ? undefined : 'location'"
              @click="choose('')"
            >
              {{ config.name }}
            </button>
            <span v-if="selected" aria-hidden="true">/</span>
          </template>
          <template
            v-for="region in regionBreadcrumbs"
            :key="region.id"
          >
            <button
              type="button"
              :aria-current="selected && region.id === selected.id ? 'location' : undefined"
              @click="choose(region.id)"
            >
              {{ region.name }}
            </button>
            <span
              v-if="selected && region.id !== selected.id"
              aria-hidden="true"
              >/</span
            >
          </template>
        </nav>
        <button
          class="region-panel-close"
          type="button"
          aria-label="收起地区资料栏"
          @click="panelOpen = false"
        >
          <PointIcon name="close" />
        </button>
        <div class="region-panel-title">
          <h1>{{ selected?.name || config.name }}</h1>
          <span
            v-if="selected?.code"
            class="region-code"
          >{{ selected.code }}</span>
        </div>
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
        <div v-if="selectedRegionTitles.length" class="region-titles">
          <div
            v-for="title in selectedRegionTitles"
            :key="`${title.id}-${title.inheritedFrom || selected?.id}`"
            class="region-title"
          >
            <PointIcon name="compass" :size="14" />
            <span>{{ title.name }}</span>
            <HelpTip v-if="title.helpTip" :text="title.helpTip" />
          </div>
        </div>
      </header>
      <div ref="panelBody" class="region-panel-body">
        <RouterLink
          v-if="route.query.from === 'achievements'"
          to="/achievements"
          class="region-backlink"
          >返回旅行成就</RouterLink
        >
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
        <div
          v-if="selected && specialNotice.length"
          class="region-notice"
        >
          <PointIcon name="info" :size="16" />
          <span>
            <span
              v-for="notice in specialNotice"
              :key="notice"
              class="region-notice-line"
              >{{ notice }}</span
            >
          </span>
        </div>
        <section
          v-if="selected"
          class="region-section region-points"
        >
          <div class="region-directory-heading">
            <h2>关联点位</h2>
          </div>
          <p
            v-if="!pointGroups.length"
            class="region-description"
          >暂无已收录点位。</p>
          <div
            v-for="group in pointGroups"
            :key="group.categoryId"
            class="region-point-group"
            :class="{
              'is-expandable': childRegions.length,
            }"
            :data-point-category="group.categoryId"
          >
            <button
              v-if="childRegions.length"
              class="region-point-group-head"
              type="button"
              :aria-expanded="expandedPointGroup === group.categoryId"
              @click="togglePointGroup(group.categoryId)"
            >
              <span>{{ group.name }}</span>
              <small>{{ group.checked }} / {{ group.itemCount }}</small>
              <PointIcon
                name="chevron"
                :size="14"
                :class="{ 'is-open': expandedPointGroup === group.categoryId }"
              />
            </button>
            <div v-else class="region-point-group-head is-static">
              <span>{{ group.name }}</span>
              <small>{{ group.checked }} / {{ group.itemCount }}</small>
            </div>
            <div
              class="region-point-progress region-point-main-progress"
              :class="{ 'is-collapsed': expandedPointGroup === group.categoryId }"
              role="progressbar"
              :aria-hidden="expandedPointGroup === group.categoryId"
              :aria-label="group.name + '点亮进度'"
              :aria-valuemin="0"
              :aria-valuemax="group.itemCount"
              :aria-valuenow="group.checked"
            >
              <span :style="{ width: (group.checked / group.itemCount) * 100 + '%' }" />
            </div>
            <Transition
              name="region-point-expand"
              @before-leave="startPointCollapse"
              @after-leave="finishPointCollapse"
            >
              <div
                v-if="!childRegions.length || expandedPointGroup === group.categoryId"
                class="region-point-expand-shell"
              >
                <div class="region-point-content">
                  <template v-if="group.itemCount > 20 && group.subregions.length">
                    <p class="region-point-overflow-hint">
                      <span class="region-point-hint-icon"><PointIcon name="info" :size="14" /></span>
                      <span>该类别点位较多，请点击下辖地区查看具体点位。</span>
                    </p>
                    <button
                      v-for="region in group.subregions"
                      :key="region.id"
                      class="region-point-subregion"
                      type="button"
                      :aria-label="`查看${region.name}，已点亮 ${region.checked} / ${region.itemCount}`"
                      @click="choose(region.id)"
                    >
                      <span class="region-point-subregion-name">{{ region.name }}</span>
                      <small>{{ region.checked }} / {{ region.itemCount }}</small>
                      <span
                        class="region-point-progress"
                        role="progressbar"
                        :aria-label="region.name + group.name + '点亮进度'"
                        :aria-valuemin="0"
                        :aria-valuemax="region.itemCount"
                        :aria-valuenow="region.checked"
                      >
                        <span :style="{ width: (region.checked / region.itemCount) * 100 + '%' }" />
                      </span>
                      <PointIcon name="arrow" :size="14" />
                    </button>
                  </template>
                  <div v-else class="region-point-items">
                    <div
                      v-for="item in group.items"
                      :key="item.id"
                      class="region-point-item-group"
                    >
                      <button
                        class="region-point-item"
                        type="button"
                        :title="item.name"
                        :aria-label="`打开点位点卯：${item.name}`"
                        @click="openPoint(item.entry)"
                      >
                        <i :class="{ 'is-checked': item.checked }" />
                        <span class="region-point-item-name">{{ item.name }}</span>
                        <PointIcon name="arrow" :size="14" />
                      </button>
                      <div v-if="item.children.length" class="region-point-subitems">
                        <button
                          v-for="child in item.children"
                          :key="child.id"
                          class="region-point-item"
                          type="button"
                          :title="child.name"
                          :aria-label="`打开点位点卯：${child.name}`"
                          @click="openPoint(item.entry, child.subitemId)"
                        >
                          <i :class="{ 'is-checked': child.checked }" />
                          <span class="region-point-item-name">{{ child.name }}</span>
                          <PointIcon name="arrow" :size="14" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Transition>
          </div>
        </section>
        <section
          v-if="routeGroups.length"
          class="region-section region-routes"
        >
          <div class="region-directory-heading">
            <h2>关联线路</h2>
          </div>
          <div
            v-for="group in routeGroups"
            :key="group.key"
            class="region-route-group"
          >
            <button
              class="region-route-head"
              type="button"
              :aria-expanded="!!expandedRouteGroups[group.key]"
              @click="toggleRouteGroup(group.key)"
            >
              <span>{{ group.label }}</span>
              <small>{{ group.entries.length }} 项</small>
              <PointIcon
                name="chevron"
                :size="14"
                :class="{ 'is-open': expandedRouteGroups[group.key] }"
              />
            </button>
            <div
              v-if="expandedRouteGroups[group.key]"
              class="region-route-items"
            >
              <span
                v-for="item in routeItems(group.entries)"
                :key="item"
                >{{ item }}</span
              >
            </div>
          </div>
        </section>
        <section v-if="!selected || directoryTree.length" class="region-section region-directory">
          <div class="region-directory-heading">
            <h2>{{ selected ? '下辖地区' : '地区目录' }}</h2>
            <span>{{ directoryRoots.length }}</span>
          </div>
          <div
            v-for="row in directoryTree"
            :key="row.region.id"
            class="region-row"
            :style="{ '--region-depth': row.depth }"
          >
            <button
              class="region-row-main"
              type="button"
              @click="choose(row.region.id)"
            >
              <i :style="{ background: store.colors[session.visitState(row.region.id)] }" />
              <span>{{ row.region.name }}</span>
              <span
                v-for="title in row.region.cityTitles || []"
                :key="title.id"
                class="region-row-title-icon"
                :title="title.name"
                :aria-label="title.name"
              >
                <PointIcon name="compass" :size="13" />
              </span>
            </button>
            <button
              v-if="row.hasChildren"
              class="region-row-toggle"
              type="button"
              :aria-label="`${expandedDirectory[row.region.id] ? '收起' : '展开'}${row.region.name}`"
              :aria-expanded="!!expandedDirectory[row.region.id]"
              @click="toggleDirectory(row.region.id)"
              @keydown="directoryKeydown($event, row.region.id)"
            >
              <PointIcon
                name="chevron"
                :size="14"
                :class="{ 'is-open': expandedDirectory[row.region.id] }"
              />
            </button>
          </div>
        </section>
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
  background: transparent;
  position: relative;
  z-index: 1;
  pointer-events: none;
}
.region-map-main {
  position: absolute;
  inset: 0;
  padding-bottom: 40px;
  pointer-events: none;
}
.region-explorer,
.region-caption { pointer-events: auto; }
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
.region-caption-tools {
  position: relative;
  gap: 14px;
}
.region-caption button {
  padding: 0;
  border: 0;
  background: transparent;
}
.region-panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 2;
  width: var(--region-panel-width);
  display: flex;
  flex-direction: column;
  min-width: 0;
  border-left: 1px solid var(--atlas-line);
  background: var(--atlas-paper);
  outline: none;
  pointer-events: auto;
}
.region-panel-head {
  position: relative;
  flex: none;
  padding: 14px 44px 10px 24px;
  border-bottom: 1px solid var(--atlas-line);
}
.region-panel-breadcrumbs {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin: 0 0 13px;
  overflow: hidden;
  color: var(--atlas-ink);
  font-size: 12px;
  line-height: 1.4;
  white-space: nowrap;
}
.region-panel-breadcrumbs button {
  min-width: 0;
  overflow: hidden;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  font-size: inherit;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.region-panel-breadcrumbs button[aria-current='location'] {
  color: var(--atlas-ink);
  font-weight: 500;
}
.region-panel-breadcrumbs span {
  flex: none;
  opacity: 0.45;
}
.region-panel-close {
  position: absolute;
  top: 14px;
  right: 16px;
  display: flex;
  padding: 0;
  border: 0;
  color: var(--atlas-ink);
  background: transparent;
  cursor: pointer;
}
.region-panel-title {
  position: relative;
  display: flex;
  align-items: flex-start;
  min-width: 0;
  padding-right: 18px;
}
.region-panel-title h1 {
  min-width: 0;
  flex: 1;
  margin: 0 0 15px;
  overflow-wrap: anywhere;
  font: 300 30px/1.35 var(--atlas-title-font);
}
.region-code {
  position: absolute;
  top: 0;
  right: -24px;
  max-height: 76px;
  overflow: hidden;
  color: var(--atlas-ink);
  opacity: 0.38;
  font: 11px/1.1 var(--atlas-font);
  letter-spacing: 0.08em;
  writing-mode: vertical-rl;
}
.region-panel-head :deep(.state-select) {
  gap: 4px;
  width: calc(100% + 20px);
  font-size: 13px;
}
.region-titles {
  display: grid;
  gap: 4px;
  margin-top: 8px;
}
.region-title {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #b4232c;
  font-size: 13px;
  line-height: 1.5;
}
.region-title > svg {
  flex: none;
}
.region-title > span {
  overflow-wrap: anywhere;
}
.region-title :deep(.help-tip-button) {
  color: #b4232c;
}
.region-panel-body {
  overflow: auto;
  min-height: 0;
  flex: 1;
  padding: 12px 24px 32px;
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
.region-section {
  margin: 22px 0 0;
}
.region-section:first-of-type {
  margin-top: 4px;
}
.region-points:first-of-type {
  margin-top: 0;
}
.region-points {
  margin-top: 0;
}
.region-section h2 {
  font-size: 16px;
  font-weight: 400;
  margin: 0;
}
.region-overview p {
  margin: 8px 0 0;
  font-size: 14px;
  line-height: 1.7;
}
.region-notice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 22px 0 0;
  padding: 11px 12px;
  border: 1px solid #c49a2a88;
  border-radius: 8px;
  background: #f7e4a155;
  color: var(--atlas-ink);
  font-size: 13px;
  line-height: 1.6;
}
.region-notice svg {
  flex: none;
  color: #a27812;
}
.region-notice-line {
  display: block;
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
.region-points > .region-directory-heading {
  margin-top: 0;
}
.region-row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 0;
  min-height: 42px;
  padding: 0;
  border: 0;
  border-bottom: 1px solid var(--atlas-line);
  background: transparent;
  text-align: left;
}
.region-row-main,
.region-row-toggle {
  min-height: 42px;
  border: 0;
  border-radius: 0;
  background: transparent;
}
.region-row-main {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  gap: 9px;
  padding: 0 0 0 calc(var(--region-depth, 0) * 18px);
  text-align: left;
}
.region-row-toggle {
  display: grid;
  place-items: center;
  width: 32px;
  padding: 0;
}
.region-row-main:hover,
.region-row-toggle:hover {
  background: var(--atlas-soft);
}
.region-row-main i {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 2px;
  border: 1px solid #56645630;
}
.region-row-main span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.region-row-main .region-row-title-icon {
  display: inline-flex;
  flex: none;
  color: #b4232c;
}
.region-row-toggle svg,
.region-point-group-head svg,
.region-route-head svg {
  transition: transform 160ms ease;
  transform: rotate(-90deg);
}
.region-row-toggle svg.is-open,
.region-point-group-head svg.is-open,
.region-route-head svg.is-open {
  transform: rotate(0deg);
}
.region-point-group,
.region-route-group {
  border-bottom: 1px solid var(--atlas-line);
}
.region-point-group.is-expandable {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}
.region-point-group-head,
.region-route-head {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 40px;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
}
.region-point-group-head:not(.is-static):hover,
.region-point-item:hover,
.region-point-subregion:hover {
  background: var(--atlas-soft);
}
.region-point-group.is-expandable > .region-point-group-head {
  grid-row: 1;
}
.region-point-group.is-expandable > .region-point-main-progress,
.region-point-group.is-expandable > .region-point-expand-shell {
  grid-row: 2;
  grid-column: 1;
}
.region-point-group-head span,
.region-route-head span {
  flex: 1;
  min-width: 0;
}
.region-point-group-head small,
.region-route-head small {
  color: var(--atlas-ink);
  opacity: 0.65;
  font-size: 12px;
}
.region-point-group-head.is-static {
  cursor: default;
}
.region-point-progress {
  display: block;
  height: 4px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--atlas-line);
}
.region-point-progress > span {
  display: block;
  height: 100%;
  background: #57877a;
  transition: width 180ms ease;
}
.region-point-content {
  min-height: 0;
  overflow: hidden;
  padding-bottom: 8px;
}
.region-point-expand-shell {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  min-height: 0;
  overflow: hidden;
  background: var(--atlas-paper);
}
.region-point-expand-enter-active,
.region-point-expand-leave-active {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  opacity: 1;
  transition:
    grid-template-rows 220ms ease,
    opacity 160ms ease;
}
.region-point-expand-enter-from,
.region-point-expand-leave-to {
  grid-template-rows: minmax(0, 0fr);
  opacity: 0;
}
.region-point-main-progress {
  height: 4px;
  margin-bottom: 8px;
  opacity: 1;
  transition: opacity 150ms ease;
}
.region-point-main-progress.is-collapsed {
  opacity: 0;
  pointer-events: none;
}
.region-point-overflow-hint {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 8px 0;
  color: var(--atlas-ink);
  opacity: 0.62;
  font-size: 12px;
  line-height: 1.5;
}
.region-point-overflow-hint svg {
  width: 14px;
  height: 14px;
}
.region-point-hint-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 18px;
  height: 18px;
}
.region-point-subregion {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(48px, 82px) 16px;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 36px;
  padding: 4px 0;
  border: 0;
  border-bottom: 1px solid var(--atlas-line);
  border-radius: 0;
  background: transparent;
  text-align: left;
}
.region-point-subregion-name {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 13px;
}
.region-point-subregion small {
  color: var(--atlas-ink);
  opacity: 0.68;
  font-size: 11px;
  white-space: nowrap;
}
.region-point-subregion > svg {
  opacity: 0.65;
}
.region-point-subregion .region-point-progress {
  width: 100%;
  margin: 0;
}
.region-point-items {
  display: grid;
}
.region-point-item-group {
  border-bottom: 1px solid var(--atlas-line);
}
.region-point-item-group:last-child {
  border-bottom: 0;
}
.region-point-item-group > .region-point-item {
  border-bottom: 0;
}
.region-point-subitems {
  display: grid;
  margin: 0 0 8px 8px;
  padding-left: 12px;
  border-left: 1px solid var(--atlas-line);
}
.region-point-subitems .region-point-item {
  min-height: 36px;
  padding: 5px 0;
}
.region-route-items {
  display: grid;
  padding: 0 0 8px;
}
.region-route-items span {
  max-width: 100%;
  padding: 9px 0;
  border-bottom: 1px solid var(--atlas-line);
  overflow-wrap: anywhere;
  font-size: 13px;
  line-height: 1.4;
}
.region-route-items span:last-child {
  border-bottom: 0;
}
.region-point-item {
  display: grid;
  grid-template-columns: 9px minmax(0, 1fr) 16px;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 42px;
  padding: 6px 0;
  border: 0;
  border-bottom: 1px solid var(--atlas-line);
  border-radius: 0;
  background: transparent;
  text-align: left;
}
.region-point-item > i {
  width: 8px;
  height: 8px;
  border: 1px solid #82948b;
  border-radius: 2px;
}
.region-point-item > i.is-checked {
  border-color: #57877a;
  background: #57877a;
}
.region-point-item-name {
  display: -webkit-box;
  min-width: 0;
  overflow: hidden;
  overflow-wrap: anywhere;
  font-size: 13px;
  line-height: 1.4;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}
.region-point-item > svg {
  opacity: 0.6;
}
.region-point-items .region-point-item:last-child,
.region-point-content > .region-point-subregion:last-child {
  border-bottom: 0;
}
.region-directory {
  margin-top: 26px;
}
.region-directory .region-directory-heading {
  margin-top: 0;
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
  background: transparent;
}
.region-show-all {
  width: 100%;
  margin-top: 14px;
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
  pointer-events: auto;
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
  .region-caption-tools {
    gap: 8px;
  }
  .region-caption-tools :deep(.basemap-control span) {
    display: none;
  }
  .region-caption-tools :deep(.basemap-control select) {
    width: 126px;
  }
  .region-caption div > span {
    display: none;
  }
  .region-panel-head {
    padding: 14px 40px 18px 20px;
  }
  .region-panel-body {
    padding: 18px 20px 28px;
  }
}
</style>
