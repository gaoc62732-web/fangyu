<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Scope } from '@fangyu/contracts';
import type { EntryView } from '@fangyu/domain';
import { useAppStore } from '../app/store.js';
import EntryList from './EntryList.vue';
import { searchText } from '../features/search-text.js';
const props = defineProps<{ scope: Scope }>();
const emit = defineEmits<{ locate: [entry: EntryView] }>();
const store = useAppStore();
const search = ref('');
watch(
  () => props.scope,
  () => (search.value = ''),
);
const names: Record<string, string> = {
  'eng-premier-league': '英格兰顶级联赛',
  'sco-premiership': '苏格兰顶级联赛',
  'de-bundesliga': '德甲',
  'fr-ligue-1': '法甲',
  'it-serie-a': '意甲',
  'es-la-liga': '西甲',
};
const competitions = computed(() =>
  (store.session!.index.catalog.football?.competitions || []).filter((item) => {
    const codes: Record<string, string[]> = {
      uk: ['GB-ENG', 'GB-SCT'],
      germany: ['DE'],
      france: ['FR'],
      italy: ['IT'],
      spain: ['ES'],
    };
    return codes[props.scope]?.includes(item.countryCode);
  }),
);
const filteredCompetitions = computed(() =>
  competitions.value
    .map((league) => {
      const query = searchText(search.value.trim());
      const homeGrounds = league.homeGrounds.filter((home) => {
        const club = league.clubs.find((row) => row.id === home.clubId);
        const venue = league.venues.find((row) => row.id === home.venueId);
        return (
          !query ||
          searchText(
            [
              club?.name,
              club?.originalName,
              ...(club?.aliases || []),
              venue?.name,
              venue?.originalName,
              ...(venue?.aliases || []),
            ]
              .filter(Boolean)
              .join(' '),
          ).includes(query)
        );
      });
      const venueIds = new Set(homeGrounds.map((home) => home.venueId));
      return {
        ...league,
        homeGrounds,
        visibleVenues: league.venues.filter((venue) => venueIds.has(venue.id)),
      };
    })
    .filter((league) => league.homeGrounds.length),
);
function rows(ids: string[]) {
  void store.revision;
  return [...new Set(ids)].flatMap((id) => {
    const entry = store.session!.index.entries.get(id);
    return entry ? [store.session!.view(entry)] : [];
  });
}
const standalone = computed(() =>
  props.scope === 'uk'
    ? rows(
        (store.session!.index.catalog.football?.standaloneVenues || []).map((v) => v.entryId),
      ).filter(
        (entry) =>
          !search.value ||
          searchText([entry.name, ...entry.aliases].join(' ')).includes(searchText(search.value)),
      )
    : [],
);
</script>
<template>
  <details
    v-if="competitions.length || standalone.length"
    class="football-grounds"
  >
    <summary>足球俱乐部与实际主场 · Clubs and Stadiums</summary>
    <input
      v-model="search"
      type="search"
      aria-label="搜索球队或球场"
      placeholder="搜索中英文或原名 / Search clubs or stadiums"
    />
    <p
      v-if="search && !filteredCompetitions.length && !standalone.length"
      class="note"
    >
      没有匹配的球队或球场；清除搜索可查看全部。
    </p>
    <p class="note">
      按 2026/27 赛季官方名单；共用球场共享记录。临时主场仅按已核实比赛或时间段展示。
    </p>
    <details
      v-for="league in filteredCompetitions"
      :key="league.competitionId"
    >
      <summary>
        {{ league.name || names[league.competitionId] || league.competitionId }} ·
        {{ league.clubs.length }} 队 ·
        {{ league.season }}
      </summary>
      <details
        v-if="league.clubs.some((club) => club.originalName)"
        class="original-names"
      >
        <summary>球队原名 / Original club names</summary>
        <p
          v-for="club in league.clubs"
          :key="club.id"
        >
          {{ club.name }} — {{ club.originalName
          }}<small v-if="club.nameTranslationNote"> · {{ club.nameTranslationNote }}</small>
        </p>
      </details>
      <ul>
        <li
          v-for="(home, i) in league.homeGrounds"
          :key="i"
        >
          <span :title="league.clubs.find((c) => c.id === home.clubId)?.originalName">{{
            league.clubs.find((c) => c.id === home.clubId)?.name
          }}</span>
          →
          {{ league.venues.find((v) => v.id === home.venueId)?.name }}
          <small v-if="league.clubs.find((c) => c.id === home.clubId)?.nameTranslationNeedsReview">
            · 译名待核 / Provisional name</small
          >
          <small v-if="home.dateSemantics?.includes('match date only')">
            · 已证实单场：{{ home.validFrom }} {{ home.fixture }}；整体借场起止未核实。</small
          >
          <small v-else-if="home.status === 'temporary'">
            · 临时场地；{{ home.validFrom || '开始日期未核实' }} 至
            {{ home.validTo || '结束日期未核实' }}</small
          >
          <small v-else-if="home.status === 'unknown'"> · 名单所列场地，实际使用期限待核实。</small>
          <a
            :href="home.sourceUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            主场依据</a
          >
        </li>
      </ul>
      <EntryList
        :rows="rows(league.visibleVenues.map((v) => v.entryId))"
        :page-size="25"
        @locate="emit('locate', $event)"
      />
      <a
        :href="league.sourceUrl"
        target="_blank"
        rel="noopener noreferrer"
        >联赛名单来源</a
      >
    </details>
    <details v-if="standalone.length">
      <summary>威尔士 · 加迪夫千年球场（独立收录）</summary>
      <EntryList
        :rows="standalone"
        @locate="emit('locate', $event)"
      />
    </details>
  </details>
</template>
<style scoped>
.football-grounds input {
  width: 100%;
  box-sizing: border-box;
  margin: 8px 0;
}
.original-names p {
  font-size: 12px;
  overflow-wrap: anywhere;
}
.football-grounds {
  margin: 14px 0;
}
details {
  padding: 8px 0;
}
summary {
  cursor: pointer;
  line-height: 1.6;
}
li {
  font-size: 13px;
  margin: 6px 0;
}
</style>
