import { computed, ref, watch, type Ref } from 'vue';
import type { Scope, Region } from '@fangyu/contracts';
import { useAppStore } from '../../app/store.js';
import { searchText } from '../search-text.js';

export function useCatalogEntries(
  scope: Ref<Scope>,
  focusedEntry: Ref<string>,
  regions: Ref<Region[]>,
) {
  const store = useAppStore();
  const index = computed(() => store.session!.index);
  const query = ref('');
  const status = ref('');
  const descendants = ref(true);
  const railType = ref('');
  const availableCategories = computed(() => {
    const ids = new Set(
      index.value.catalog.entries
        .filter((entry) => index.value.entryRegions(entry, scope.value).length)
        .map((entry) => entry.categoryId),
    );
    return index.value.catalog.categories.filter((category) => ids.has(category.id));
  });

  const searchableRows = computed(() =>
    store.rows.map((entry) => ({
      entry,
      text: searchText(
        [
          entry.name,
          entry.path,
          entry.code,
          entry.description,
          ...entry.aliases,
          ...(entry.lines || []),
          ...(entry.operators || []),
          ...entry.subitems.map((item) => item.name),
        ].join(' '),
      ),
    })),
  );
  const normalizedQuery = computed(() => searchText(query.value.trim()));
  const rows = computed(() =>
    searchableRows.value
      .filter(({ entry, text }) => {
        const owners = index.value.entryRegions(entry, scope.value);
        const within =
          !store.selectedRegionId ||
          owners.some((id) =>
            descendants.value
              ? index.value.belongsTo(id, store.selectedRegionId)
              : id === store.selectedRegionId,
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
          (!normalizedQuery.value || text.includes(normalizedQuery.value))
        );
      })
      .map(({ entry }) => entry),
  );
  const searchRegions = computed(() =>
    query.value.trim()
      ? regions.value
          .filter((region) =>
            searchText([region.name, region.code, ...region.aliases].join(' ')).includes(
              normalizedQuery.value,
            ),
          )
          .slice(0, 40)
      : [],
  );
  const mapPoints = computed(() =>
    (scope.value === 'china' || store.category
      ? rows.value
      : rows.value.filter((entry) =>
          [
            'world-heritage-component',
            'football-stadium',
            'vn-national-special-component',
          ].includes(entry.categoryId),
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

  watch(scope, () => {
    query.value = '';
    status.value = '';
    railType.value = '';
  });
  return {
    query,
    status,
    descendants,
    railType,
    availableCategories,
    rows,
    searchRegions,
    mapPoints,
    focusCoordinates,
  };
}
