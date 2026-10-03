<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Scope } from '@fangyu/contracts';
import { heritageProgress, type EntryView } from '@fangyu/domain';
import { useAppStore } from '../app/store.js';
import EntryList from './EntryList.vue';
import { searchText } from '../features/search-text.js';
const props = defineProps<{ scope: Scope; regionId: string; query?: string }>();
const emit = defineEmits<{ locate: [entry: EntryView] }>();
const store = useAppStore();
const page = ref(0),
  search = ref('');
const projects = computed(() => {
  void store.revision;
  const session = store.session!,
    index = session.index;
  return (index.catalog.heritageProjects || [])
    .map((project) => {
      const components = project.componentEntryIds
        .map((id) => index.entries.get(id))
        .filter((e) => e !== undefined)
        .filter((e) => {
          const owners = index.entryRegions(e, props.scope);
          return (
            owners.length &&
            (!props.regionId || owners.some((id) => index.belongsTo(id, props.regionId)))
          );
        })
        .map((e) => session.view(e));
      const legacy = project.legacyEntryIds
        .map((id) => index.entries.get(id))
        .filter((e) => e !== undefined)
        .filter((e) => index.entryRegions(e, props.scope).length)
        .map((e) => session.view(e));
      return { project, components, legacy, progress: heritageProgress(session, project) };
    })
    .filter((item) => {
      const query = searchText((search.value || props.query || '').trim());
      return (
        (item.components.length || (!props.regionId && item.legacy.length)) &&
        (!query ||
          searchText(
            [
              item.project.name,
              item.project.originalName,
              ...(item.project.aliases || []),
              item.project.unescoId,
              ...item.components.flatMap((e) => [e.name, ...e.aliases]),
            ].join(' '),
          ).includes(query))
      );
    });
});
const pages = computed(() => Math.max(1, Math.ceil(projects.value.length / 10)));
watch(
  () => [props.scope, props.regionId, props.query, search.value],
  () => (page.value = 0),
);
watch(
  () => props.scope,
  () => (search.value = ''),
);
</script>
<template>
  <details
    v-if="projects.length || search"
    class="heritage-projects"
  >
    <summary>
      世界遗产项目与组成点<span v-if="scope === 'vietnam'"> · World Heritage</span> ·
      {{ projects.length }} 项
    </summary>
    <p class="note">
      组成点分别记录。旧项目打卡保留，不代表全部组成点已到访；官方地图单元与独立景点口径有差异，未核实部分明确标注。
    </p>
    <input
      v-model="search"
      type="search"
      aria-label="搜索世界遗产项目"
      placeholder="搜索遗产项目或组成点"
    />
    <p
      v-if="!projects.length"
      class="note"
    >
      没有符合筛选的遗产项目，可清除搜索后继续查看。
    </p>
    <article
      v-for="item in projects.slice(page * 10, (page + 1) * 10)"
      :key="item.project.unescoId"
    >
      <details>
        <summary>
          {{ item.project.name }} <small>#{{ item.project.unescoId }}</small>
          <small v-if="item.project.nameTranslationNeedsReview">
            · 译名待核 / Provisional name</small
          >
        </summary>
        <details
          v-if="item.project.nameZh && item.project.originalName"
          class="original-name"
        >
          <summary>原文名称 / Original name</summary>
          <span>{{ item.project.originalName }}</span>
          <small v-if="item.project.nameTranslationNote">{{
            item.project.nameTranslationNote
          }}</small>
        </details>
        <p>
          全球地点记录 {{ item.progress.visitedComponents }} /
          {{ item.progress.totalComponents }}；本页可见 {{ item.components.length }} 个。
        </p>
        <p
          v-if="item.progress.totalOfficialComponents !== undefined"
          class="note"
        >
          官方组成单元 {{ item.progress.visitedOfficialComponents }} /
          {{ item.progress.totalOfficialComponents }}；同一单元包含多个地点时，需分别到访。
        </p>
        <p
          v-if="item.project.coverage !== 'complete'"
          class="note"
        >
          组成资料尚未完整核验，当前不判定全项目完成。
        </p>
        <p
          v-if="item.progress.legacyVisited"
          class="note"
        >
          有旧记录；未由此推断新组成点到访。
        </p>
        <EntryList
          :rows="item.components"
          :selected-region-id="regionId"
          :page-size="20"
          @locate="emit('locate', $event)"
        />
        <details v-if="item.legacy.length">
          <summary>保留的旧记录（项目／组成单元）</summary>
          <EntryList
            :rows="item.legacy"
            :page-size="10"
            @locate="emit('locate', $event)"
          />
        </details>
        <a
          :href="item.project.sourceUrl"
          target="_blank"
          rel="noopener noreferrer"
          >UNESCO 来源</a
        >
      </details>
    </article>
    <div
      v-if="pages > 1"
      class="toolbar"
    >
      <button
        :disabled="page === 0"
        @click="page--"
      >
        上一页项目
      </button>
      <span>{{ page + 1 }} / {{ pages }}</span>
      <button
        :disabled="page >= pages - 1"
        @click="page++"
      >
        下一页项目
      </button>
    </div>
  </details>
</template>
<style scoped>
.heritage-projects {
  margin: 14px 0;
  border-bottom: 1px solid #b7ccc255;
  padding-bottom: 12px;
}
summary {
  cursor: pointer;
  line-height: 1.6;
}
article {
  margin: 12px 0;
  padding: 8px 0;
  border-bottom: 1px solid #b7ccc255;
}
input {
  width: 100%;
  box-sizing: border-box;
}
small {
  color: #667a71;
}
</style>
