<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Scope } from '@fangyu/contracts';
import type { EntryView } from '@fangyu/domain';
import { useAppStore } from '../app/store.js';
import EntryList from './EntryList.vue';
import { searchText } from '../features/search-text.js';
const props = defineProps<{ scope: Scope; regionId: string }>();
const emit = defineEmits<{ locate: [entry: EntryView] }>();
const store = useAppStore();
const search = ref(''),
  page = ref(0);
const groups = computed(() => {
  void store.revision;
  const session = store.session!,
    index = session.index;
  return (index.catalog.nationalHeritage?.datasets || [])
    .filter((d) => d.scope === props.scope)
    .flatMap((d) => d.parents || [])
    .flatMap((parent) => {
      const entry = index.entries.get(parent.entryId);
      if (!entry) return [];
      const components = (parent.componentEntryIds || []).flatMap((id) => {
        const e = index.entries.get(id);
        return e ? [session.view(e)] : [];
      });
      const all = [entry, ...components];
      if (
        props.regionId &&
        !all.some((e) =>
          index.entryRegions(e, props.scope).some((id) => index.belongsTo(id, props.regionId)),
        )
      )
        return [];
      if (
        search.value &&
        !all.some((e) =>
          searchText([e.name, ...e.aliases].join(' ')).includes(searchText(search.value)),
        )
      )
        return [];
      return [{ parent, entry: session.view(entry), components }];
    });
});
const pages = computed(() => Math.max(1, Math.ceil(groups.value.length / 10)));
watch(
  () => [props.scope, props.regionId, search.value],
  () => (page.value = 0),
);
</script>
<template>
  <details
    v-if="scope === 'vietnam'"
    class="national-heritage"
  >
    <summary>越南国家特别遗迹 · Special National Relics</summary>
    <input
      v-model="search"
      type="search"
      aria-label="搜索越南特别遗迹"
      placeholder="搜索遗迹名称"
    />
    <p>{{ groups.length }} 项</p>
    <details
      v-for="group in groups.slice(page * 10, (page + 1) * 10)"
      :key="group.entry.id"
    >
      <summary>{{ group.entry.name }} · {{ group.components.length }} 个地点</summary>
      <details>
        <summary>项目记录</summary>
        <EntryList
          :rows="[group.entry]"
          @locate="emit('locate', $event)"
        />
      </details>
      <EntryList
        v-if="group.components.length"
        :rows="group.components"
        :page-size="20"
        @locate="emit('locate', $event)"
      />
      <p
        v-else
        class="note"
      >
        暂无组成地点。
      </p>
    </details>
    <div
      v-if="pages > 1"
      class="toolbar"
    >
      <button
        :disabled="page === 0"
        @click="page--"
      >
        上一页项目</button
      ><span>{{ page + 1 }} / {{ pages }}</span
      ><button
        :disabled="page + 1 >= pages"
        @click="page++"
      >
        下一页项目
      </button>
    </div>
  </details>
</template>
<style scoped>
.national-heritage {
  margin: 14px 0;
}
summary {
  cursor: pointer;
  line-height: 1.6;
}
details {
  padding: 8px 0;
}
input {
  max-width: 100%;
  width: 100%;
  box-sizing: border-box;
}
</style>
