<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useVirtualizer } from '@tanstack/vue-virtual';
import { SCOPE_CONFIGS, type CatalogEntry, type Scope } from '@fangyu/contracts';
import { useAppStore } from '../app/store.js';
import { searchText } from '../features/search-text.js';
import { pointSearchItems, type PointSearchResult } from '../features/points/point-search.js';
import { pointCategoryAppearance } from '../features/points/point-category-appearance.js';
import PointSelect from './PointSelect.vue';
import PointIcon from './PointIcon.vue';

const props = defineProps<{
  scope: Scope;
  category: string;
  categories: { id: string; name: string }[];
  entries: CatalogEntry[];
}>();
const emit = defineEmits<{
  'update:scope': [scope: Scope];
  'update:category': [category: string];
  search: [results: PointSearchResult[] | null];
  select: [item: PointSearchResult];
}>();
const store = useAppStore();
const index = computed(() => store.session!.index);
const root = ref<HTMLElement>();
const input = ref<HTMLInputElement>();
const resultsBody = ref<HTMLElement>();
const openSelect = ref<'scope' | 'category' | null>(null);
const searchOpen = ref(false);
const advancedSelect = ref<string | null>(null);
const advancedOpen = ref(false);
const resultsOpen = ref(false);
const query = ref('');
const selectedCategories = ref<string[]>([]);
const selectedRegions = ref<string[]>([]);
const applied = ref<{
  query: string;
  categories: string[];
  regions: string[];
  ids?: string[];
} | null>(null);
let searchTimer: ReturnType<typeof setTimeout> | undefined;
const scopeOptions = SCOPE_CONFIGS.map((config) => ({ value: config.id, label: config.name }));
const categoryOptions = computed(() => props.categories.map((item) => ({
  value: item.id, label: item.name, ...pointCategoryAppearance(item.id, item.name),
})));
const items = computed(() => pointSearchItems(props.entries, index.value, props.scope));
const results = computed(() => {
  const filters = applied.value;
  if (!filters) return [];
  const words = searchText(filters.query.trim()).split(/\s+/).filter(Boolean);
  const ids = filters.ids ? new Set(filters.ids) : null;
  return items.value.filter((item) =>
    (!ids || ids.has(item.id)) &&
    (!filters.categories.length || filters.categories.includes(item.entry.categoryId)) &&
    (!filters.regions.length || filters.regions.some((regionId) =>
      item.regionIds.some((id) => id === regionId || index.value.belongsTo(id, regionId)))) &&
    words.every((word) => item.text.includes(word)),
  );
});
watch([results, applied], () => emit('search', applied.value ? results.value : null));
const filterCount = computed(() => selectedCategories.value.length + selectedRegions.value.length);
const availableRegions = computed(() => {
  void store.revision;
  return index.value.catalog.regions.filter((region) => region.scope === props.scope);
});
const regionPath = computed(() => selectedRegions.value[0]
  ? index.value.ancestors(selectedRegions.value[0]).filter((region) => region.scope === props.scope)
  : []);
const regionLevels = computed(() => {
  const regions = availableRegions.value;
  const options = (items: typeof regions, label: string) => [
    { value: '', label }, ...items.map((region) => ({ value: region.id, label: region.name })),
  ];
  if (props.scope === 'china') {
    const province = regionPath.value.find((region) => region.level === 0)?.id || '';
    const city = regionPath.value.find((region) => region.level === 1)?.id || '';
    const county = regionPath.value.find((region) => region.level === 2)?.id || '';
    return [
      { key: 'province', label: '省', value: province, disabled: false, options: options(regions.filter((region) => region.level === 0), '省') },
      { key: 'city', label: '市', value: city, disabled: !province, options: options(regions.filter((region) => region.level === 1 && region.parentId === province), '市') },
      { key: 'county', label: '县', value: county, disabled: !province, options: options(regions.filter((region) => region.level === 2 && !!province && index.value.belongsTo(region.id, city || province)), '县') },
    ];
  }
  if (props.scope === 'france') {
    const root = regionPath.value.find((region) => region.level === 1);
    const department = regionPath.value.find((region) => region.level === 2);
    const levels = [{ key: 'root', label: '大区', value: root?.id || '', disabled: false, options: options(regions.filter((region) => region.level === 1), '大区') }];
    if (root?.code === 'FR-IDF') levels.push({ key: 'department', label: '省级单位', value: department?.id || '', disabled: false, options: options(regions.filter((region) => region.level === 2 && region.parentId === root.id), '省级单位') });
    if (department?.sourceCode === '75') levels.push({ key: 'district', label: '市区', value: regionPath.value.find((region) => region.level === 3)?.id || '', disabled: false, options: options(regions.filter((region) => region.level === 3 && region.parentId === department.id), '市区') });
    return levels;
  }
  return [{ key: 'root', label: props.scope === 'world' ? '国家或地区' : '地区', value: selectedRegions.value[0] || '', disabled: false, options: options(regions, props.scope === 'world' ? '国家或地区' : '地区') }];
});
const virtualizer = useVirtualizer(computed(() => ({
  count: results.value.length,
  getScrollElement: () => resultsBody.value || null,
  estimateSize: () => 72,
  overscan: 5,
  initialRect: { width: 440, height: 320 },
})));
watch(results, () => virtualizer.value.scrollToOffset(0));
function applySearch(closeAdvanced = true) {
  clearTimeout(searchTimer);
  applied.value = {
    query: query.value,
    categories: [...selectedCategories.value],
    regions: [...selectedRegions.value],
  };
  resultsOpen.value = true;
  openSelect.value = null;
  advancedSelect.value = null;
  if (closeAdvanced) advancedOpen.value = false;
}
function scheduleSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    if (!query.value.trim() && !filterCount.value) {
      applied.value = null;
      resultsOpen.value = false;
    } else applySearch(false);
  }, 180);
}
function clearSearch() {
  clearTimeout(searchTimer);
  query.value = '';
  selectedCategories.value = [];
  selectedRegions.value = [];
  applied.value = null;
  resultsOpen.value = false;
  advancedOpen.value = false;
  advancedSelect.value = null;
}
function changeScope(value: string) {
  clearSearch();
  emit('update:scope', value as Scope);
}
function changeCategory(value: string) {
  clearSearch();
  emit('update:category', value);
}
function changeRegion(position: number, id: string) {
  const target = id || regionLevels.value.slice(0, position).map((level) => level.value).filter(Boolean).at(-1) || '';
  selectedRegions.value = target ? [target] : [];
}
async function openSearch() {
  searchOpen.value = true;
  openSelect.value = null;
  await nextTick();
  input.value?.focus({ preventScroll: true });
}
function setMainSelect(key: 'scope' | 'category', open: boolean) {
  if (open) {
    openSelect.value = key;
    searchOpen.value = false;
    advancedOpen.value = false;
    resultsOpen.value = false;
    advancedSelect.value = null;
  } else if (openSelect.value === key) openSelect.value = null;
}
function setAdvancedSelect(key: string, open: boolean) {
  if (open) advancedSelect.value = key;
  else if (advancedSelect.value === key) advancedSelect.value = null;
}
function closePopovers() {
  openSelect.value = null;
  advancedOpen.value = false;
  resultsOpen.value = false;
  advancedSelect.value = null;
  searchOpen.value = false;
}
function outside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) closePopovers();
}
function focusOut(event: FocusEvent) {
  if (event.relatedTarget && !root.value?.contains(event.relatedTarget as Node)) closePopovers();
}
function choose(item: PointSearchResult) {
  closePopovers();
  emit('select', item);
}
async function showCluster(ids: string[]) {
  clearSearch();
  applied.value = { query: '', categories: [], regions: [], ids };
  resultsOpen.value = true;
  searchOpen.value = true;
  await nextTick();
  input.value?.focus({ preventScroll: true });
}
watch(() => props.scope, clearSearch);
onMounted(() => document.addEventListener('pointerdown', outside));
onBeforeUnmount(() => {
  clearTimeout(searchTimer);
  document.removeEventListener('pointerdown', outside);
});
defineExpose({ showCluster, clearSearch });
</script>

<template>
  <div ref="root" class="point-explorer" :class="{ 'is-search-open': searchOpen }" @focusout="focusOut" @keydown.esc.stop="closePopovers">
    <div class="point-explorer-bar">
      <PointSelect
        class="point-explorer-scope"
        label="地区"
        :model-value="scope"
        :options="scopeOptions"
        :open="openSelect === 'scope'"
        :hover-open="false"
        @update:model-value="changeScope"
        @update:open="setMainSelect('scope', $event)"
      />
      <PointSelect
        class="point-explorer-category"
        label="点位类别"
        :model-value="category"
        :options="categoryOptions"
        :open="openSelect === 'category'"
        :hover-open="false"
        compact
        @update:model-value="changeCategory"
        @update:open="setMainSelect('category', $event)"
      />
      <div class="point-explorer-search-shell" :class="{ 'is-open': searchOpen }">
        <button
          class="point-explorer-search-toggle"
          :class="{ 'is-hidden': searchOpen }"
          type="button"
          aria-label="展开地点搜索"
          :aria-hidden="searchOpen"
          :tabindex="searchOpen ? -1 : 0"
          :aria-expanded="searchOpen"
          @click="openSearch"
        >
          <PointIcon name="search" :size="18" />
          <i v-if="applied" class="point-explorer-search-dot" />
        </button>
      <form class="point-explorer-search" :aria-hidden="!searchOpen" :inert="!searchOpen" role="search" @submit.prevent="applySearch()">
        <input
          ref="input"
          v-model="query"
          type="search"
          aria-label="搜索地点"
          placeholder="搜索地点"
          autocomplete="off"
          @input="scheduleSearch"
          @focus="resultsOpen = !!applied"
        />
        <button v-if="query || applied || filterCount" class="point-explorer-clear" type="button" aria-label="清除搜索" @click="clearSearch">
          <PointIcon name="close" :size="15" />
        </button>
        <button
          class="point-explorer-advanced-toggle"
          type="button"
          aria-label="筛选条件"
          title="筛选条件"
          :aria-expanded="advancedOpen"
          :class="{ 'is-active': advancedOpen || filterCount }"
          @click="advancedOpen = !advancedOpen; openSelect = null"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
            <path d="M4 7h7m4 0h5M4 17h3m4 0h9M11 4v6M7 14v6" />
          </svg>
          <small v-if="filterCount">{{ filterCount }}</small>
        </button>
        <button type="submit" aria-label="搜索" title="搜索"><PointIcon name="search" :size="18" /></button>
      </form>
      </div>
    </div>

    <div v-if="advancedOpen || resultsOpen" class="point-explorer-popover" :class="{ 'is-advanced': advancedOpen }">
      <form v-if="advancedOpen" class="point-search-advanced" @submit.prevent="applySearch()">
        <div class="point-search-heading">
          <span>筛选条件</span>
          <button class="point-search-reset" type="button" @click="selectedCategories = []; selectedRegions = []; advancedSelect = null"><PointIcon name="refresh" :size="13" />重置筛选</button>
        </div>
        <div class="point-search-filter-columns">
        <fieldset>
          <legend>类别</legend>
          <PointSelect
            class="point-search-category-select"
            label="筛选点位类别"
            :options="[{ value: '', label: '全部类别' }, ...categoryOptions]"
            :selected-values="selectedCategories"
            multiple
            selection-summary
            :hover-open="false"
            :open="advancedSelect === 'categories'"
            @update:selected-values="selectedCategories = $event"
            @update:open="setAdvancedSelect('categories', $event)"
          />
          <div v-if="selectedCategories.length" class="point-search-selected-categories">
            <button
              v-for="id in selectedCategories"
              :key="id"
              type="button"
              :style="{ color: pointCategoryAppearance(id, categories.find((item) => item.id === id)?.name).color }"
              :aria-label="'移除' + categories.find((item) => item.id === id)?.name"
              @click="selectedCategories = selectedCategories.filter((value) => value !== id)"
            ><span>{{ categories.find((item) => item.id === id)?.name }}</span><PointIcon name="close" :size="12" /></button>
          </div>
        </fieldset>
        <fieldset>
          <legend>所在政区</legend>
          <div class="point-search-region-levels">
            <PointSelect
              v-for="(level, position) in regionLevels"
              :key="level.key"
              :label="level.label"
              :model-value="level.value"
              :options="level.options"
              :hover-open="false"
              :disabled="level.disabled"
              fit-label
              :open="advancedSelect === level.key"
              @update:model-value="changeRegion(position, $event)"
              @update:open="setAdvancedSelect(level.key, $event)"
            />
          </div>
        </fieldset>
        </div>
        <button class="point-search-apply" type="submit">应用筛选<PointIcon name="search" :size="16" /></button>
      </form>

      <div v-else-if="resultsOpen" class="point-search-results">
        <div class="point-search-heading">
          <span>{{ applied?.ids ? '附近地点' : '搜索结果' }} <small>{{ results.length.toLocaleString() }}</small></span>
          <button type="button" aria-label="收起搜索结果" @click="resultsOpen = false"><PointIcon name="close" :size="16" /></button>
        </div>
        <div ref="resultsBody" class="point-search-results-body">
          <div :style="{ height: virtualizer.getTotalSize() + 'px', position: 'relative' }">
            <button
              v-for="row in virtualizer.getVirtualItems()"
              :key="results[row.index]!.id"
              class="point-search-result"
              type="button"
              :style="{ transform: 'translateY(' + row.start + 'px)' }"
              @click="choose(results[row.index]!)"
            >
              <span>
                <strong>{{ results[row.index]!.name }}</strong>
                <small>{{ [results[row.index]!.parentName, results[row.index]!.path].filter(Boolean).join(' · ') || '暂无所属政区' }}</small>
              </span>
              <span class="point-search-result-category">{{ categories.find((item) => item.id === results[row.index]!.entry.categoryId)?.name }}</span>
              <PointIcon name="arrow" :size="15" />
            </button>
          </div>
          <p v-if="!results.length" class="point-search-empty">没有符合条件的地点</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.point-explorer {
  position: absolute;
  top: 24px;
  left: 12px;
  z-index: 7;
  width: max-content;
  max-width: calc(100% - 24px);
  color: var(--atlas-ink);
  --point-ink: var(--atlas-ink);
  --point-paper: var(--atlas-paper);
  --point-line: var(--atlas-line);
  --point-body-size: 16px;
  pointer-events: auto;
  font: 300 16px/1.35 var(--atlas-font);
}
.point-explorer button, .point-explorer input {
  font: inherit;
  color: inherit;
  border: 0;
  background: transparent;
  box-shadow: none;
}
.point-explorer button { cursor: pointer; }
.point-explorer button:focus-visible, .point-explorer input:focus-visible {
  outline: 2px solid #a18b5d;
  outline-offset: 2px;
}
.point-explorer-bar {
  display: flex;
  align-items: stretch;
  width: max-content;
  max-width: 100%;
  min-height: 48px;
  background: var(--atlas-paper);
  border: 1px solid var(--atlas-line);
  border-radius: 12px;
  box-shadow: 0 8px 24px rgb(20 28 22 / 12%);
}
.point-explorer-scope { flex: none; border-right: 1px solid var(--atlas-line); }
.point-explorer-category { border-right: 1px solid var(--atlas-line); }
.point-explorer :deep(.point-select-trigger) {
  height: 48px;
  min-height: 48px;
  padding: 0 14px;
  gap: 8px;
  font-size: 16px;
  font-weight: 300;
}
.point-explorer :deep(.point-select-trigger > span) { line-height: 1.35; }
.point-explorer :deep(.point-select-menu button) { font-size: 16px; font-weight: 300; }
.point-explorer :deep(.point-select-trigger:hover),
.point-explorer :deep(.point-select-trigger[aria-expanded='true']),
.point-explorer :deep(.point-select-menu button:hover) { background: var(--atlas-soft); }
.point-explorer-search-shell {
  position: relative;
  flex: none;
  width: 48px;
  height: 48px;
  overflow: hidden;
  border-radius: 0 11px 11px 0;
  transition: width 340ms cubic-bezier(.22, 1, .36, 1);
}
.point-explorer-search-shell.is-open { width: clamp(220px, 34vw, 340px); }
.point-explorer .point-explorer-search-toggle {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  padding: 0;
  transition: opacity 140ms ease;
}
.point-explorer .point-explorer-search-toggle.is-hidden { opacity: 0; pointer-events: none; }
.point-explorer-search-dot { position: absolute; top: 10px; right: 13px; width: 5px; height: 5px; border-radius: 50%; background: #57877a; }
.point-explorer-search {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 220px;
  height: 48px;
  gap: 2px;
  padding: 0 7px 0 14px;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translateX(8px);
  transition: opacity 180ms ease, transform 260ms ease;
}
.is-open > .point-explorer-search { opacity: 1; visibility: visible; pointer-events: auto; transform: translateX(0); transition: opacity 180ms ease 70ms, transform 260ms ease 70ms; }
.point-explorer .point-explorer-search input { width: 100%; min-width: 0; padding: 8px 0; font-size: 14px; outline: none; }
.point-explorer input[type='search']::-webkit-search-cancel-button { display: none; }
.point-explorer .point-explorer-search button {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 32px;
  height: 34px;
  padding: 0;
  border-radius: 6px;
}
.point-explorer button:hover { background: var(--atlas-soft); }
.point-explorer .point-explorer-advanced-toggle.is-active { color: #57877a; background: #57877a12; }
.point-explorer-advanced-toggle small {
  position: absolute;
  top: -1px;
  right: -2px;
  min-width: 14px;
  padding: 0 3px;
  border-radius: 7px;
  background: #57877a;
  color: white;
  font-size: 9px;
  line-height: 14px;
}
.point-explorer-popover {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  width: 100%;
  border: 1px solid var(--atlas-line);
  border-radius: 12px;
  background: var(--atlas-paper);
  box-shadow: 0 8px 24px rgb(20 28 22 / 12%);
  overflow: hidden;
}
.point-explorer-popover.is-advanced { overflow: visible; }
.point-search-advanced { margin: 5px; padding: 15px; }
.point-search-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.point-search-heading > span { font-size: 14px; }
.point-search-heading small { margin-left: 6px; opacity: .6; font-size: 12px; }
.point-search-heading button { display: flex; align-items: center; padding: 3px; font-size: 12px; opacity: .65; }
.point-search-advanced > .point-search-heading { margin-bottom: 20px; }
.point-search-advanced > .point-search-heading > span { font-size: 18px; font-weight: 600; line-height: 1.4; letter-spacing: .02em; }
.point-search-advanced .point-search-reset { display: flex; align-items: center; gap: 5px; min-height: 30px; padding: 5px 9px; border: 1px solid #91a89980; border-radius: 6px; background: color-mix(in srgb, var(--atlas-paper) 85%, #dfe9e2); color: var(--atlas-ink); font-size: 12px; font-weight: 400; opacity: .9; transition: border-color 160ms ease, background 160ms ease; }
.point-search-advanced .point-search-reset:hover { border-color: #57877a; background: #57877a12; opacity: 1; }
.point-search-filter-columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: 18px; margin-bottom: 20px; }
.point-search-advanced fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
.point-search-advanced legend { margin-bottom: 10px; padding: 0; font-size: 14px; font-weight: 500; line-height: 1.4; }
.point-search-selected-categories { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.point-search-advanced .point-search-selected-categories button { display: flex; align-items: center; gap: 5px; max-width: 100%; padding: 5px 7px; border: 1px solid color-mix(in srgb, currentColor 28%, transparent); border-radius: 5px; background: color-mix(in srgb, currentColor 5%, var(--atlas-paper)); font-size: 11px; line-height: 1.45; font-weight: 400; text-align: left; }
.point-search-selected-categories button > span { min-width: 0; overflow-wrap: anywhere; }
.point-search-selected-categories button > svg { flex: none; }
.point-search-category-select, .point-search-region-levels {
  border: 1px solid var(--atlas-line);
  border-radius: 8px;
  background: var(--atlas-paper);
}
.point-search-advanced :deep(.point-select-trigger) { height: 42px; min-height: 42px; padding: 9px 10px; gap: 6px; font-size: 14px; font-weight: 400; border-radius: 7px; }
.point-search-advanced :deep(.point-select-menu button) { min-height: 36px; padding: 8px 9px; gap: 8px; font-size: 13px; }
.point-search-advanced :deep(.point-select-popover) { position: absolute; top: 100%; left: 0; z-index: 20; width: max-content; min-width: 100%; max-width: min(420px, calc(100vw - 56px)); padding-top: 6px; }
.point-search-advanced :deep(.point-select-menu) { max-height: 190px; }
.point-search-advanced :deep(.point-select-frame) { padding: 5px; border: 1px solid var(--atlas-line); border-radius: 9px; box-shadow: 0 8px 24px rgb(20 28 22 / 12%); }
.point-search-advanced :deep(.point-select-trigger:disabled) { opacity: .4; cursor: default; }
.point-search-advanced :deep(.point-select-trigger:disabled:hover) { background: transparent; }
.point-search-category-select :deep(.point-select-menu) { border: 0; box-shadow: none; }
.point-search-region-levels { display: flex; flex-direction: column; align-items: stretch; }
.point-search-region-levels :deep(.point-select + .point-select) { border-top: 1px solid var(--atlas-line); }
.point-search-region-levels :deep(.point-select-menu) { margin: 0 3px 4px; border: 0; box-shadow: none; }
.point-search-region-levels :deep(.point-select-popover) { min-width: max(100%, 200px); }
.point-search-region-levels :deep(.point-select:last-child .point-select-popover) { left: auto; right: 0; }
.point-search-region-levels :deep(.point-select-option-label > span) { overflow-wrap: anywhere; }
.point-explorer .point-search-apply {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 11px;
  border-radius: 7px;
  background: #57877a;
  color: white;
  font-size: 14px;
  font-weight: 500;
}
.point-explorer .point-search-apply:hover { background: #487367; }
.point-search-results > .point-search-heading { padding: 13px 14px; margin: 0; border-bottom: 1px solid var(--atlas-line); }
.point-search-results-body { max-height: min(360px, calc(100dvh - 200px)); margin: 4px; overflow: auto; overscroll-behavior: contain; }
.point-explorer .point-search-result {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 72px;
  padding: 10px 10px;
  border-bottom: 1px solid var(--atlas-line);
  text-align: left;
}
.point-search-result > span:first-child { flex: 1; min-width: 0; }
.point-search-result strong, .point-search-result small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.point-search-result strong { font-size: 13px; font-weight: 400; }
.point-search-result small { opacity: .55; font-size: 11px; margin-top: 3px; }
.point-search-result-category { flex: none; max-width: 90px; opacity: .6; font-size: 11px; }
.point-search-result > svg { flex: none; opacity: .55; }
.point-search-empty { margin: 0; padding: 28px 16px; text-align: center; opacity: .6; font-size: 13px; }
.point-search-advanced::-webkit-scrollbar, .point-search-results-body::-webkit-scrollbar { width: 6px; height: 6px; }
.point-search-advanced::-webkit-scrollbar-button, .point-search-results-body::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
.point-search-advanced::-webkit-scrollbar-track, .point-search-results-body::-webkit-scrollbar-track { margin: 8px 0; background: transparent; }
.point-search-advanced::-webkit-scrollbar-thumb, .point-search-results-body::-webkit-scrollbar-thumb { background: #929d9580; border-radius: 10px; }
@supports not selector(::-webkit-scrollbar) {
  .point-search-advanced, .point-search-results-body { scrollbar-width: thin; scrollbar-color: #929d9580 transparent; }
}
@media (max-width: 740px) {
  .point-explorer { top: 16px; }
  .point-explorer.is-search-open .point-explorer-bar { flex-wrap: wrap; }
  .point-explorer.is-search-open { width: min(440px, calc(100% - 24px)); }
  .point-explorer.is-search-open .point-explorer-bar { width: 100%; }
  .point-explorer.is-search-open .point-explorer-search-shell { width: 100%; height: 44px; border-top: 1px solid var(--atlas-line); border-radius: 0 0 11px 11px; }
  .point-explorer.is-search-open .point-explorer-search { height: 44px; }
  .point-search-result-category { max-width: 66px; }
}
</style>
