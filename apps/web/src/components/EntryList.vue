<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { EntryView } from '@fangyu/domain';
import { useAppStore } from '../app/store.js';

const props = withDefaults(
  defineProps<{
    rows: EntryView[];
    selectedRegionId?: string | undefined;
    pageSize?: number;
  }>(),
  { pageSize: 50 },
);

const emit = defineEmits<{ locate: [entry: EntryView] }>();
const store = useAppStore();
const page = ref(0);
const editing = ref('');
const editingIds = ref<string[]>([]);
const name = ref('');
const note = ref('');
type GroupedEntry = EntryView & { groupEntryIds?: string[]; regionPaths?: string[] };
const groupIds = (entry: EntryView) => (entry as GroupedEntry).groupEntryIds || [entry.id];
const regionPaths = (entry: EntryView) => (entry as GroupedEntry).regionPaths || [];
const visible = computed(() =>
  props.rows.slice(page.value * props.pageSize, (page.value + 1) * props.pageSize),
);
const pageCount = computed(() => Math.max(1, Math.ceil(props.rows.length / props.pageSize)));

watch(
  () => props.rows,
  () => {
    page.value = Math.min(page.value, pageCount.value - 1);
  },
);

function mark(entry: EntryView, event: Event) {
  const visited = (event.target as HTMLInputElement).checked;
  store.commit((session) => {
    for (const id of groupIds(entry)) session.markEntry(id, visited, props.selectedRegionId);
  });
}

function markSubitem(entry: EntryView, subitemId: string, event: Event) {
  const visited = (event.target as HTMLInputElement).checked;
  store.commit((session) =>
    session.markSubitem(entry.id, subitemId, visited, props.selectedRegionId),
  );
}

function edit(entry: EntryView) {
  editing.value = entry.id;
  editingIds.value = groupIds(entry);
  name.value = entry.name;
  note.value = entry.note;
}

function save() {
  if (store.commit((session) => {
    for (const id of editingIds.value) session.editEntry(id, name.value, note.value);
  })) {
    editing.value = '';
    editingIds.value = [];
  }
}

function safeUrl(url?: string) {
  return /^https?:\/\//i.test(url || '') ? url : undefined;
}

function removePersonalEntry(entry: EntryView) {
  store.commit((session) => session.removeCustomEntry(entry.id));
}
</script>

<template>
  <p class="note">
    {{ rows.length }} 项 · 已标记 {{ rows.filter((row) => row.visited).length }} 项
  </p>
  <div class="entries">
    <article
      v-for="entry in visible"
      :key="entry.id"
      class="entry"
    >
      <label>
        <input
          type="checkbox"
          :checked="entry.checked"
          :indeterminate="entry.partial"
          :title="groupIds(entry).length > 1 ? '同时更新这个项目在全部所属政区的记录' : ''"
          @change="mark(entry, $event)"
        />
        <span>{{ entry.name }}</span>
      </label>
      <template v-if="regionPaths(entry).length">
        <small>涉及 {{ regionPaths(entry).length }} 个政区 · {{ regionPaths(entry).slice(0, 3).join('；') }}</small>
        <details v-if="regionPaths(entry).length > 3">
          <summary>查看全部所属政区</summary>
          <small class="entry-region-paths">{{ regionPaths(entry).join('；') }}</small>
        </details>
      </template>
      <small v-else>{{ entry.path }} {{ entry.code }} {{ entry.lines?.join(' / ') }}</small>
      <p
        v-if="entry.note"
        class="note"
      >
        {{ entry.note }}
      </p>
      <details v-if="entry.subitems.length">
        <summary>组成项目</summary>
        <label
          v-for="item in entry.subitems"
          :key="item.id"
          class="subitem"
        >
          <input
            type="checkbox"
            :checked="store.session!.subitemVisited(entry.id, item.id)"
            @change="markSubitem(entry, item.id, $event)"
          />
          {{ item.name }}
        </label>
      </details>
      <div class="toolbar">
        <a
          v-if="safeUrl(entry.source)"
          :href="safeUrl(entry.source)"
          target="_blank"
          rel="noopener noreferrer"
          >资料来源</a
        >
        <button @click="emit('locate', entry)">定位</button>
        <button @click="edit(entry)">编辑名称与备注</button>
        <button
          v-if="!store.session!.index.entries.has(entry.id)"
          @click="removePersonalEntry(entry)"
        >
          删除个人项目
        </button>
      </div>
      <form
        v-if="editing === entry.id"
        @submit.prevent="save"
      >
        <label
          >名称<input
            v-model="name"
            required
            maxlength="1000"
        /></label>
        <label
          >备注<textarea
            v-model="note"
            maxlength="20000"
          ></textarea>
        </label>
        <button type="submit">保存</button>
        <button
          type="button"
          @click="editing = ''"
        >
          取消
        </button>
      </form>
    </article>
  </div>
  <p
    v-if="!rows.length"
    class="empty"
  >
    当前范围没有项目。
  </p>
  <div
    v-if="pageCount > 1"
    class="toolbar"
  >
    <button
      :disabled="page === 0"
      @click="page--"
    >
      上一页
    </button>
    <span>{{ page + 1 }} / {{ pageCount }}</span>
    <button
      :disabled="page + 1 >= pageCount"
      @click="page++"
    >
      下一页
    </button>
  </div>
</template>
