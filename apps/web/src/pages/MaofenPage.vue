<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { maofenProgress } from '@fangyu/domain';
import { useAppStore } from '../app/store.js';
import { exportCsv } from '../features/exports/download.js';

const store = useAppStore();
const router = useRouter();
const sort = ref('score-desc');
const progress = computed(() => {
  void store.revision;
  return maofenProgress(store.session!);
});
const groups = computed(() =>
  [...progress.value.groups].sort((a, b) => {
    const metric = (group: typeof a) =>
      sort.value.startsWith('count') ? group.counts[2]! :
      sort.value.startsWith('ratio') ? group.counts[2]! / (group.totals[2] || 1) : group.score;
    return (metric(b) - metric(a)) * (sort.value.endsWith('asc') ? -1 : 1);
  }),
);
function locate(id: string) {
  store.selectedRegionId = id;
  void router.push('/china');
}
function exportResults() {
  exportCsv([
    ['地区', '省级到访', '省级总数', '地级到访', '地级总数', '卯县数', '县级总数', '卯县比例', '卯分'],
    ...groups.value.map((group) => [
      group.province.name,
      group.counts[0], group.totals[0], group.counts[1], group.totals[1],
      group.counts[2], group.totals[2],
      ((group.counts[2]! / (group.totals[2] || 1)) * 100).toFixed(2) + '%',
      group.score.toFixed(2),
    ]),
  ], '方舆卯分.csv');
}
</script>

<template>
  <section class="page-heading">
    <h2>点卯计算器</h2>
    <p>依据当前手册的政区到访记录即时计算。</p>
  </section>
  <section class="maofen-calculator card">
    <div class="maofen-summary">
      <div><small>当前卯分</small><strong>{{ progress.score.toFixed(2) }}</strong><span>满分 {{ progress.maximum.toFixed(2) }}</span></div>
      <div><small>省级 · 每个 1 分</small><strong>{{ progress.counts[0] }} / {{ progress.totals[0] }}</strong></div>
      <div><small>地级 · 每个 0.2 分</small><strong>{{ progress.counts[1] }} / {{ progress.totals[1] }}</strong></div>
      <div><small>卯县 · 每个 0.05 分</small><strong>{{ progress.counts[2] }} / {{ progress.totals[2] }}</strong></div>
    </div>
    <p class="note">居住、短居、到达计分；途经、飞跃不计。县区到访可带入上级，但上级明确标为未到达时不推断到达。</p>
    <details class="maofen-rules">
      <summary>计分规则与本版基数</summary>
      <p>省级每个 1 分、地级每个 0.2 分、县级每个 0.05 分。省级统计含港澳台；地县级仅计中国大陆现行且符合计分条件的政区，历史对照行不计入。满分随当前目录基数自动更新。</p>
    </details>
    <div class="maofen-table-heading">
      <h3>分省点卯</h3>
      <div class="toolbar">
        <select v-model="sort" aria-label="卯分排序">
          <option value="score-desc">卯分：高到低</option>
          <option value="score-asc">卯分：低到高</option>
          <option value="count-desc">卯县数：多到少</option>
          <option value="count-asc">卯县数：少到多</option>
          <option value="ratio-desc">卯县比例：高到低</option>
          <option value="ratio-asc">卯县比例：低到高</option>
        </select>
        <button @click="exportResults">导出明细 CSV</button>
      </div>
    </div>
    <div class="maofen-table-wrap"><table>
      <thead><tr><th>地区</th><th>省</th><th>地</th><th>县</th><th>卯县比例</th><th>卯分</th></tr></thead>
      <tbody>
        <tr v-for="group in groups" :key="group.province.id">
          <td><button @click="locate(group.province.id)">{{ group.province.name }}</button></td>
          <td v-for="level in [0, 1, 2]" :key="level">{{ group.counts[level] }} / {{ group.totals[level] }}</td>
          <td>{{ ((group.counts[2]! / (group.totals[2] || 1)) * 100).toFixed(1) }}%</td>
          <td>{{ group.score.toFixed(2) }}</td>
        </tr>
      </tbody>
    </table></div>
  </section>
</template>
