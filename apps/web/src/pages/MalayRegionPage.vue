<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { getScopeConfig, MALAY_REGION_TOPIC, type CatalogEntry } from '@fangyu/contracts';
import { useAppStore } from '../app/store.js';
import CatalogPage from './CatalogPage.vue';

const countries = MALAY_REGION_TOPIC.scopeIds;
const route = useRoute();
const store = useAppStore();
const selectedCountry = computed(
  () => countries.find((country) => country === route.query.country) || 'malaysia',
);
const summaries = computed(() => {
  void store.revision;
  const session = store.session!;
  const index = session.index;
  return countries.map((scope) => {
    const config = getScopeConfig(scope);
    const regions = index.catalog.regions.filter((region) => region.scope === scope);
    const projects = (index.catalog.heritageProjects || []).filter(
      (project) =>
        config.countryCode !== null && project.countryCodes?.includes(config.countryCode),
    );
    const componentIds = new Set(projects.flatMap((project) => project.componentEntryIds));
    const components = [...componentIds]
      .map((id) => index.entries.get(id))
      .filter(
        (entry): entry is CatalogEntry =>
          entry !== undefined && index.entryRegions(entry, scope).length > 0,
      );
    const records = new Map(components.map((entry) => [entry.recordId, entry]));
    return {
      scope,
      name: config.name,
      title: config.title,
      boundaryLabel: config.boundaryLabel,
      regions: regions.length,
      markedRegions: regions.filter((region) => session.visitState(region.id) !== 'unvisited')
        .length,
      projects: projects.length,
      components: records.size,
      visited: [...records.values()].filter((entry) => session.view(entry).visited).length,
    };
  });
});
</script>

<template>
  <section
    class="regional-topic"
    aria-labelledby="malay-region-title"
  >
    <div class="page-heading">
      <h2 id="malay-region-title">马新文 · Malaysia, Singapore &amp; Brunei</h2>
      <p>三国分别浏览，分别统计。选择国家后查看地图、地区与世界遗产。</p>
    </div>
    <nav
      class="country-cards"
      aria-label="马新文国家"
    >
      <RouterLink
        v-for="country in summaries"
        :key="country.scope"
        :to="{ path: '/malay-region', query: { country: country.scope } }"
        active-class=""
        exact-active-class=""
        :class="{ selected: selectedCountry === country.scope }"
        :aria-current="selectedCountry === country.scope ? 'page' : undefined"
        :data-country="country.scope"
      >
        <strong>{{ country.title }}</strong>
        <span
          >{{ country.boundaryLabel }} · {{ country.markedRegions }} /
          {{ country.regions }} 已标记</span
        >
        <span
          >世界遗产 {{ country.projects }} 项 · 地点记录 {{ country.visited }} /
          {{ country.components }}</span
        >
      </RouterLink>
    </nav>
    <p class="note">地区标记与地点到访分别计算；旧项目打卡不会自动计入新组成地点。</p>
  </section>
  <CatalogPage
    :key="selectedCountry"
    :scope="selectedCountry"
  />
</template>

<style scoped>
.regional-topic {
  margin-bottom: 24px;
}
.country-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.country-cards a {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border: 1px solid #b7ccc2;
  border-radius: 12px;
  color: inherit;
  text-decoration: none;
  min-width: 0;
  overflow-wrap: anywhere;
}
.country-cards a.selected {
  border: 2px solid #277763;
  padding: 15px;
  background: #2777630d;
}
.country-cards a:focus-visible {
  outline: 3px solid #bc862c;
  outline-offset: 3px;
}
.country-cards span {
  font-size: 0.88rem;
  line-height: 1.6;
}
@media (max-width: 760px) {
  .country-cards {
    grid-template-columns: 1fr;
  }
}
</style>
