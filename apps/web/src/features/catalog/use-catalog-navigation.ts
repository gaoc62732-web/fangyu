import { computed, ref, watch, type Ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getScopeConfig, type MapLevel, type Scope, type Region } from '@fangyu/contracts';
import type { EntryView } from '@fangyu/domain';
import { useAppStore } from '../../app/store.js';

function regionGroupLabel(scope: Scope, region: Region): string {
  switch (scope) {
    case 'france':
      return region.kind?.startsWith('metropolitan-') ? '法国本土（13）' : '海外地区层级（5）';
    case 'usa':
      return region.kind === 'state' ? '州（50）' : '哥伦比亚特区（1）';
    case 'spain':
      return region.kind === 'autonomous-community' ? '自治社区（17）' : '自治市（2）';
    case 'uk':
      return region.constituentCountry || '历史郡';
    case 'malaysia':
      return region.kind === 'state'
        ? '州（13） · States'
        : '联邦直辖区（3） · Federal territories';
    case 'thailand':
      return region.kind === 'special-administrative-area'
        ? '曼谷 · Bangkok'
        : '府（76） · Provinces';
    default:
      return getScopeConfig(scope).boundaryLabel;
  }
}

export function useCatalogNavigation(scope: Ref<Scope>) {
  const store = useAppStore();
  const route = useRoute();
  const router = useRouter();
  const session = computed(() => store.session!);
  const index = computed(() => {
    void store.revision;
    return session.value.index;
  });
  const regions = computed(() => {
    void store.revision;
    return index.value.catalog.regions.filter((region) => region.scope === scope.value);
  });
  const focusedEntry = ref('');
  const showAllChildren = ref(false);
  const selected = computed(() => {
    void store.revision;
    return index.value.regions.get(index.value.resolveRegion(store.selectedRegionId));
  });
  const childRegions = computed(() => {
    void store.revision;
    return index.value.children.get(index.value.resolveRegion(store.selectedRegionId)) || [];
  });
  const visibleChildren = computed(() =>
    scope.value === 'france' || showAllChildren.value
      ? childRegions.value
      : childRegions.value.slice(0, 18),
  );
  const roots = computed(() =>
    regions.value.filter((region) =>
      scope.value === 'china'
        ? region.level === 0
        : scope.value === 'france'
          ? region.level === 1
          : true,
    ),
  );
  const regionGroups = computed(() => {
    const groups = new Map<string, typeof roots.value>();
    for (const region of roots.value) {
      const label = regionGroupLabel(scope.value, region);
      let items = groups.get(label);
      if (!items) groups.set(label, (items = []));
      items.push(region);
    }
    return [...groups].map(([label, items]) => ({ label, items }));
  });
  const path = computed(() => {
    void store.revision;
    return index.value.ancestors(store.selectedRegionId);
  });
  const francePath = computed(() => path.value.filter((region) => region.scope === 'france'));
  const franceRoot = computed(() => francePath.value.find((region) => region.level === 1));
  const franceDepartment = computed(() => francePath.value.find((region) => region.level === 2));
  const franceDepartments = computed(() => regions.value.filter((region) => region.level === 2));
  const franceArrondissements = computed(() =>
    regions.value.filter((region) => region.level === 3),
  );
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
      if (scope.value === 'france')
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

  function select(id: string) {
    store.selectedRegionId = index.value.resolveRegion(id);
    focusedEntry.value = '';
    showAllChildren.value = false;
    if (scope.value === 'france' && (route.query.region || '') !== id) {
      void router.push({ query: { ...route.query, region: id || undefined } });
    }
  }

  function locate(entry: EntryView) {
    const owner = index.value.entryRegions(entry, scope.value)[0];
    if (owner) store.selectedRegionId = owner;
    focusedEntry.value = entry.id;
    showAllChildren.value = false;
  }

  watch(
    () => scope.value,
    () => {
      if (selected.value?.scope !== scope.value) store.selectedRegionId = '';
      focusedEntry.value = '';
      store.category = '';
    },
    { immediate: true },
  );
  watch(
    [() => route.query.region, () => scope.value],
    ([id]) => {
      if (typeof id === 'string' && index.value.regions.get(id)?.scope === scope.value) {
        store.selectedRegionId = id;
        focusedEntry.value = '';
      } else if (scope.value === 'france') {
        store.selectedRegionId = '';
        focusedEntry.value = '';
      }
    },
    { immediate: true },
  );

  return {
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
  };
}
