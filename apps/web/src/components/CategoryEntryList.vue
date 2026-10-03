<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { EntryView } from '@fangyu/domain';
import type { Scope } from '@fangyu/contracts';
import { useAppStore } from '../app/store.js';
import EntryList from './EntryList.vue';

const props = defineProps<{ rows: EntryView[]; selectedRegionId?: string; scope?: Scope }>();
const emit = defineEmits<{ locate: [entry: EntryView] }>();
const store = useAppStore();
const activeCategory = ref('');

const families = [
  {
    id: 'landscape',
    name: '山川与景区',
    categories: [
      'world-heritage',
      'global-geopark',
      'national-park',
      'scenic-area',
      'national-geopark',
      'five-a-scenic',
    ],
  },
  {
    id: 'culture',
    name: '历史与文化',
    categories: [
      'historic-city',
      'historic-settlement',
      'first-class-museum',
      'museum',
      'cultural-monument',
      'national-treasure',
      'historic-site',
    ],
  },
  { id: 'transport', name: '交通行旅', categories: ['railway-station', 'airport', 'urban-rail'] },
];

const grouped = computed(() => {
  const byCategory = new Map<string, EntryView[]>();
  for (const row of props.rows) {
    const group = byCategory.get(row.categoryId) || [];
    group.push(row);
    byCategory.set(row.categoryId, group);
  }
  const catalogCategories = store.session!.index.catalog.categories;
  const known = new Set(families.flatMap((family) => family.categories));
  const definitions = [
    ...families,
    {
      id: 'other',
      name: '其他内容',
      categories: catalogCategories.map((category) => category.id).filter((id) => !known.has(id)),
    },
  ];
  return definitions
    .map((family) => {
      const categories = family.categories
        .flatMap((id) => {
          const rows = byCategory.get(id) || [];
          if (props.scope === 'japan' && id === 'railway-station') {
            return [
              { id: 'railway-station-jr', name: 'JR 车站', rows: rows.filter((row) => row.railTypes?.includes('J')) },
              { id: 'railway-station-other', name: '其他铁道车站', rows: rows.filter((row) => !row.railTypes?.includes('J')) },
            ].map((group) => ({ ...group, visited: group.rows.filter((row) => row.visited).length }));
          }
          return [{
            id,
            name: catalogCategories.find((category) => category.id === id)?.name || id,
            rows,
            visited: rows.filter((row) => row.visited).length,
          }];
        })
        .filter((category) => category.rows.length);
      return {
        id: family.id,
        name: family.name,
        categories,
        total: categories.reduce((sum, category) => sum + category.rows.length, 0),
        visited: categories.reduce((sum, category) => sum + category.visited, 0),
      };
    })
    .filter((family) => family.total);
});

watch(
  () => props.selectedRegionId,
  () => {
    activeCategory.value = '';
  },
);
watch(
  () => props.rows,
  (rows) => {
    if (rows.length === 1) {
      const row = rows[0]!;
      activeCategory.value = props.scope === 'japan' && row.categoryId === 'railway-station'
        ? row.railTypes?.includes('J') ? 'railway-station-jr' : 'railway-station-other'
        : row.categoryId;
    }
  },
);

function toggleCategory(id: string) {
  activeCategory.value = activeCategory.value === id ? '' : id;
}
</script>

<template>
  <section
    class="category-directory"
    aria-label="按类别查看内容项目"
  >
    <p class="directory-total">
      共 {{ rows.length }} 项 · 已标记 {{ rows.filter((row) => row.visited).length }} 项
    </p>
    <div
      v-for="family in grouped"
      :key="family.id"
      class="category-family"
    >
      <h3>
        {{ family.name }} <small>{{ family.visited }} / {{ family.total }}</small>
      </h3>
      <div
        v-for="category in family.categories"
        :key="category.id"
        class="category-group"
      >
        <button
          type="button"
          class="category-trigger"
          :aria-expanded="activeCategory === category.id"
          @click="toggleCategory(category.id)"
        >
          <span>{{ category.name }}</span>
          <span
            >{{ category.visited }} / {{ category.rows.length }}
            {{ activeCategory === category.id ? '▴' : '▾' }}</span
          >
        </button>
        <EntryList
          v-if="activeCategory === category.id"
          :rows="category.rows"
          :selected-region-id="selectedRegionId"
          @locate="emit('locate', $event)"
        />
      </div>
    </div>
    <p
      v-if="!rows.length"
      class="empty"
    >
      当前范围没有内容项目。
    </p>
  </section>
</template>
