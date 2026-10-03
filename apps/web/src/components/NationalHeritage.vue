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
    <p class="note">
      父项目保留原认定范围；组成地点分别打卡，不由父项目推断到访。仅明确证实与世遗为同一地点的记录共享。普通国家遗迹不在本层范围。
      Names are shown in Chinese and English; original Vietnamese names remain searchable and are
      available in details.
    </p>
    <input
      v-model="search"
      type="search"
      aria-label="搜索越南特别遗迹"
      placeholder="搜索中英文或越南语名称 / Search names"
    />
    <p>{{ groups.length }} 个父项目；组成点仍有待补充资料。</p>
    <details
      v-for="group in groups.slice(page * 10, (page + 1) * 10)"
      :key="group.entry.id"
    >
      <summary>{{ group.entry.name }} · {{ group.components.length }} 个已核实组成名称</summary>
      <details>
        <summary>法定父项目记录</summary>
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
        组成地点尚待核验；父项目不使用城市代表坐标。
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
