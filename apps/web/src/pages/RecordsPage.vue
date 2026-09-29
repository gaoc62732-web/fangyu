<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { EntryView } from '@fangyu/domain';
import { useAppStore } from '../app/store.js';
import EntryList from '../components/EntryList.vue';
import { exportCsv } from '../features/exports/download.js';

const store = useAppStore();
const router = useRouter();
const scope = ref('');
const category = ref('');
const query = ref('');
const status = ref('');
const rows = computed(() =>
  store.rows.filter(
    (entry) =>
      (!scope.value || entry.scope === scope.value) &&
      (!category.value || entry.categoryId === category.value) &&
      (!status.value || entry.visited === (status.value === 'marked')) &&
      (!query.value ||
        [entry.name, entry.path, entry.code, ...entry.aliases]
          .join(' ')
          .toLowerCase()
          .includes(query.value.toLowerCase())),
  ),
);

function locate(entry: EntryView) {
  store.selectedRegionId = entry.regionIds[0] || '';
  store.category = entry.categoryId;
  void router.push('/' + entry.scope);
}

function csv() {
  exportCsv(
    [
      ['ID', '范围', '类别', '名称', '所属地区', '到访', '部分标记', '备注', '来源'],
      ...rows.value.map((entry) => [
        entry.id,
        entry.scope,
        entry.categoryId,
        entry.name,
        entry.path,
        entry.checked,
        entry.partial,
        entry.note,
        entry.source,
      ]),
    ],
    '方舆要素列表.csv',
  );
}
</script>

<template>
  <section class="page-heading">
    <h2>要素列表</h2>
    <p>所有目录项目的搜索、筛选、定位和导出。</p>
  </section>
  <div class="toolbar">
    <input
      v-model="query"
      type="search"
      placeholder="名称、地区、代码或别名"
      aria-label="搜索要素"
    />
    <select
      v-model="scope"
      aria-label="范围"
    >
      <option value="">全部范围</option>
      <option value="china">中国</option>
      <option value="world">世界</option>
      <option value="japan">日本</option>
      <option value="korea">韩国</option>
    </select>
    <select
      v-model="category"
      aria-label="类别"
    >
      <option value="">全部类别</option>
      <option
        v-for="item in store.session!.index.catalog.categories"
        :key="item.id"
        :value="item.id"
      >
        {{ item.name }}
      </option>
    </select>
    <select
      v-model="status"
      aria-label="到访状态"
    >
      <option value="">全部状态</option>
      <option value="marked">已标记（含部分）</option>
      <option value="blank">未标记</option>
    </select>
    <button @click="csv">导出筛选结果 CSV</button>
  </div>
  <section class="card">
    <EntryList
      :rows="rows"
      :page-size="100"
      @locate="locate"
    />
  </section>
</template>
