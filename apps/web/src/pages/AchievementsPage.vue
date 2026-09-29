<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { achievementProgress, quantityProgress, maofenProgress } from '@fangyu/domain';
import { useAppStore } from '../app/store.js';
import { exportCsv } from '../features/exports/download.js';

const store = useAppStore();
const router = useRouter();
const query = ref('');
const section = ref('');
const onlyIncomplete = ref(false);
const scoreSort = ref('score');
const progress = computed(() => {
  void store.revision;
  return achievementProgress(store.session!);
});
const quantity = computed(() => {
  void store.revision;
  return quantityProgress(store.session!);
});
const maofen = computed(() => {
  void store.revision;
  return maofenProgress(store.session!);
});
const sections: Record<string, string> = {
  administrative: '中国政区',
  history: '历史人文',
  curiosity: '政区趣味',
  routes: '山河线路',
  elements: '要素数量',
  'world-atlas': '寰行',
  'world-continents': '洲行',
  'world-special': '殊方',
  'world-air': '云程',
  'world-heritage': '遗珍',
};
const scoreGroups = computed(() =>
  [...maofen.value.groups].sort((a, b) => {
    if (scoreSort.value === 'count') return b.counts[2]! - a.counts[2]!;
    if (scoreSort.value === 'ratio')
      return b.counts[2]! / (b.totals[2] || 1) - a.counts[2]! / (a.totals[2] || 1);
    return b.score - a.score;
  }),
);

function scoreCsv() {
  exportCsv(
    [
      ['地区', '省级到访', '地级到访', '县级到访', '县级总数', '卯分'],
      ...scoreGroups.value.map((group) => [
        group.province.name,
        ...group.counts,
        group.totals[2],
        group.score.toFixed(2),
      ]),
    ],
    '方舆卯分.csv',
  );
}
const visible = computed(() =>
  progress.value.filter(
    (badge) =>
      (!section.value || badge.section === section.value) &&
      (!query.value || badge.title.includes(query.value)) &&
      (!onlyIncomplete.value || !badge.complete),
  ),
);

function locate(regionId: string) {
  const region = store.session!.index.regions.get(regionId);
  if (!region) return;
  store.selectedRegionId = regionId;
  void router.push('/' + region.scope);
}

function csv() {
  exportCsv(
    [
      ['成就', '类别', '完成数', '目标数', '已点亮', '已完成', '说明'],
      ...progress.value.map((badge) => [
        badge.title,
        sections[badge.section],
        badge.count,
        badge.total,
        badge.lit,
        badge.complete,
        badge.note,
      ]),
    ],
    '方舆旅行成就.csv',
  );
}

function sourceUrl(source: string | { title: string; url: string }) {
  const url = typeof source === 'string' ? source : source.url;
  return /^https?:\/\//i.test(url) ? url : undefined;
}
</script>

<template>
  <section class="page-heading">
    <h2>旅行成就与卯分</h2>
    <p>到达、短居和居住计入成就；项目成就按项目自身标记统计。</p>
  </section>
  <div class="stat-grid">
    <article class="card">
      <h3>县级旅行数量</h3>
      <strong>{{ quantity.count }}</strong>
      <p>下一级 {{ quantity.next || '已达最高等级' }}</p>
    </article>
    <article class="card">
      <h3>卯分</h3>
      <strong>{{ maofen.score.toFixed(2) }}</strong>
      <p>当前目录满分 {{ maofen.maximum.toFixed(2) }}</p>
    </article>
    <article class="card">
      <h3>点亮成就</h3>
      <strong>{{ progress.filter((badge) => badge.lit).length }}</strong>
      <p>共 {{ progress.length }} 枚</p>
    </article>
  </div>
  <div class="toolbar">
    <select
      v-model="section"
      aria-label="成就分类"
    >
      <option value="">全部成就</option>
      <option
        v-for="(label, key) in sections"
        :key="key"
        :value="key"
      >
        {{ label }}
      </option>
    </select>
    <input
      v-model="query"
      type="search"
      placeholder="搜索成就"
      aria-label="搜索成就"
    />
    <label
      ><input
        v-model="onlyIncomplete"
        type="checkbox"
      />仅未完成</label
    >
    <button @click="csv">导出 CSV</button>
  </div>
  <section class="achievement-grid">
    <article
      v-for="badge in visible"
      :key="badge.id"
      class="achievement"
      :class="{ lit: badge.lit }"
    >
      <small>{{ sections[badge.section] }}</small>
      <h3>{{ badge.title }}</h3>
      <p>
        {{ badge.count }} / {{ badge.total
        }}<span v-if="badge.next"> · 下一级 {{ badge.next }}</span>
      </p>
      <progress
        :value="badge.count"
        :max="badge.total || 1"
      ></progress>
      <details>
        <summary>规则与目标</summary>
        <p>{{ badge.note }}</p>
        <p
          v-for="pending in badge.pending"
          :key="pending"
          class="note"
        >
          {{ pending }}
        </p>
        <p
          v-for="(source, index) in badge.sources"
          :key="index"
        >
          <a
            :href="sourceUrl(source)"
            target="_blank"
            rel="noopener noreferrer"
            >{{ typeof source === 'string' ? '资料来源' : source.title }}</a
          >
        </p>
        <ul>
          <li
            v-for="(target, index) in badge.targets"
            :key="index"
          >
            {{ target.visited ? '✓' : '○' }} {{ target.label }}
            <button
              v-for="regionId in target.regionIds"
              :key="regionId"
              @click="locate(regionId)"
            >
              定位
            </button>
          </li>
        </ul>
      </details>
    </article>
  </section>
  <details class="card">
    <summary>卯分明细：省级 1 分、地级 0.2 分、县级 0.05 分</summary>
    <div class="toolbar">
      <select
        v-model="scoreSort"
        aria-label="卯分排序"
      >
        <option value="score">按分数</option>
        <option value="count">按卯县数</option>
        <option value="ratio">按卯县比例</option>
      </select>
      <button @click="scoreCsv">导出明细 CSV</button>
    </div>
    <table>
      <thead>
        <tr>
          <th>地区</th>
          <th>省</th>
          <th>地</th>
          <th>县</th>
          <th>卯分</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="group in scoreGroups"
          :key="group.province.id"
        >
          <td>
            <button @click="locate(group.province.id)">{{ group.province.name }}</button>
          </td>
          <td
            v-for="level in [0, 1, 2]"
            :key="level"
          >
            {{ group.counts[level] }} / {{ group.totals[level] }}
          </td>
          <td>{{ group.score.toFixed(2) }}</td>
        </tr>
      </tbody>
    </table>
  </details>
</template>
