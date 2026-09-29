<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { useRouter } from 'vue-router';
import { achievementProgress, quantityProgress } from '@fangyu/domain';
import { useAppStore } from '../app/store.js';
import { exportCsv } from '../features/exports/download.js';

const store = useAppStore();
const router = useRouter();
const query = ref('');
const system = ref('china');
const chinaFamily = ref('quantity');
const worldFamily = ref('all');
const onlyIncomplete = ref(false);
const badgeDialog = ref<HTMLDialogElement>();
const selectedBadgeId = ref('');
const detailLimit = ref(80);
const progress = computed(() => {
  void store.revision;
  return achievementProgress(store.session!);
});
const quantity = computed(() => {
  void store.revision;
  return quantityProgress(store.session!);
});
const quantityNames = [
  '初涉阡陌',
  '信步乡野',
  '寻城访邑',
  '渐识山川',
  '百邑留踪',
  '行路知远',
  '山河渐熟',
  '四野寻踪',
  '纵览郡邑',
  '行记渐丰',
  '五百胜游',
  '遍访山川',
  '远游成卷',
  '九陌长歌',
  '千城行者',
  '舆地博览',
  '九州游记',
  '山河万象',
  '方舆大观',
];
const quantitySteps = [
  10, 20, 50, 75, 100, 150, 200, 250, 300, 400, 500, 600, 750, 900, 1000, 1200, 1500, 2000, 2500,
].map((count, index) => ({ count, name: quantityNames[index]! }));
const quantityName = computed(
  () => quantitySteps.find((step) => step.count === quantity.value.level)?.name || '启程',
);
const nextQuantityName = computed(
  () => quantitySteps.find((step) => step.count === quantity.value.next)?.name,
);
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
const systems = [
  {
    id: 'china',
    name: '中国政区',
    symbol: '方',
    note: '数量、行遍、满贯、制霸',
    sections: ['administrative'],
  },
  { id: 'history', name: '历史人文', symbol: '史', note: '诗词与史事', sections: ['history'] },
  {
    id: 'curiosity',
    name: '政区趣味',
    symbol: '趣',
    note: '特色地名与地理纪录',
    sections: ['curiosity'],
  },
  { id: 'routes', name: '山河线路', symbol: '川', note: '沿线与地域足迹', sections: ['routes'] },
  {
    id: 'elements',
    name: '要素数量',
    symbol: '迹',
    note: '机场、车站、博物馆与国保',
    sections: ['elements'],
  },
  {
    id: 'world',
    name: '国际成就',
    symbol: '寰',
    note: '洲际、国家与特色主题',
    sections: ['world-atlas', 'world-continents', 'world-special', 'world-air', 'world-heritage'],
  },
];
const selectedSystem = computed(() => systems.find((item) => item.id === system.value)!);
const systemCounts = computed(
  () =>
    new Map(
      systems.map((item) => {
        const badges = progress.value.filter((badge) => item.sections.includes(badge.section));
        return [item.id, { lit: badges.filter((badge) => badge.lit).length, total: badges.length }];
      }),
    ),
);
const visible = computed(() =>
  progress.value.filter((badge) => {
    if (!selectedSystem.value.sections.includes(badge.section)) return false;
    if (system.value === 'china') {
      if (chinaFamily.value === 'quantity') return false;
      if (
        !badge.title.startsWith(
          { travel: '行遍', full: '满贯', conquer: '制霸' }[
            chinaFamily.value as 'travel' | 'full' | 'conquer'
          ] + ' ·',
        )
      )
        return false;
    }
    if (
      system.value === 'world' &&
      worldFamily.value !== 'all' &&
      badge.section !== worldFamily.value
    )
      return false;
    return (
      (!query.value || badge.title.includes(query.value)) &&
      (!onlyIncomplete.value || !badge.complete)
    );
  }),
);
const selectedBadge = computed(() =>
  progress.value.find((badge) => badge.id === selectedBadgeId.value),
);
const visibleTargets = computed(
  () => selectedBadge.value?.targets.slice(0, detailLimit.value) || [],
);

function badgeColor(badge: (typeof progress.value)[number]) {
  if (badge.section === 'administrative') {
    const firstRegion = badge.targets.flatMap((target) => target.regionIds)[0];
    const province = firstRegion ? store.session!.index.ancestors(firstRegion)[0] : undefined;
    const prefix = province?.code.slice(0, 2) || '';
    if (['11', '12', '13', '14', '15'].includes(prefix)) return '#b1973e';
    if (['21', '22', '23'].includes(prefix)) return '#43505a';
    if (['31', '32', '33', '34', '35', '36', '37'].includes(prefix)) return '#3f8785';
    if (['41', '42', '43', '44', '45', '46'].includes(prefix)) return '#ad5149';
    if (['50', '51', '52', '53', '54'].includes(prefix)) return '#af7895';
    if (['61', '62', '63', '64', '65'].includes(prefix)) return '#a4a49b';
    if (['71', '81', '82'].includes(prefix)) return '#8a654d';
    return '#af8640';
  }
  return (
    {
      history: '#755487',
      curiosity: '#ad7450',
      routes: '#557c96',
      elements: '#447f62',
      'world-atlas': '#3175a8',
      'world-continents': '#4c5760',
      'world-special': '#bc514c',
      'world-air': '#bc973e',
      'world-heritage': '#46906a',
    }[badge.section] || '#607d70'
  );
}

async function openBadge(id: string) {
  selectedBadgeId.value = id;
  detailLimit.value = 80;
  await nextTick();
  badgeDialog.value?.showModal();
}

function closeBadge() {
  badgeDialog.value?.close();
  selectedBadgeId.value = '';
}

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
    <h2>旅行成就</h2>
    <p>到达、短居和居住计入成就；项目成就按项目自身标记统计。</p>
  </section>
  <nav
    class="achievement-systems"
    aria-label="成就系统"
  >
    <button
      v-for="item in systems"
      :key="item.id"
      type="button"
      :class="{ active: system === item.id }"
      :aria-pressed="system === item.id"
      @click="
        system = item.id;
        query = '';
      "
    >
      <span
        class="system-symbol"
        aria-hidden="true"
        >{{ item.symbol }}</span
      >
      <span class="system-name">{{ item.name }}</span>
      <small>{{ item.note }}</small>
      <strong>{{ systemCounts.get(item.id)?.lit }} / {{ systemCounts.get(item.id)?.total }} 点亮</strong>
    </button>
  </nav>
  <section class="achievement-section-heading">
    <div>
      <h3>{{ selectedSystem.name }}</h3>
      <p>{{ selectedSystem.note }}</p>
    </div>
    <button @click="csv">导出全部成就 CSV</button>
  </section>
  <div
    v-if="system === 'china'"
    class="achievement-family-tabs"
    role="group"
    aria-label="中国政区成就系列"
  >
    <button
      v-for="item in [
        ['quantity', '数量'],
        ['travel', '行遍'],
        ['full', '满贯'],
        ['conquer', '制霸'],
      ]"
      :key="item[0]"
      :class="{ active: chinaFamily === item[0] }"
      :aria-pressed="chinaFamily === item[0]"
      @click="chinaFamily = item[0]!"
    >
      {{ item[1] }}
    </button>
  </div>
  <div
    v-if="system === 'world'"
    class="achievement-family-tabs"
    role="group"
    aria-label="国际成就系列"
  >
    <button
      :class="{ active: worldFamily === 'all' }"
      :aria-pressed="worldFamily === 'all'"
      @click="worldFamily = 'all'"
    >
      全部
    </button>
    <button
      v-for="id in selectedSystem.sections"
      :key="id"
      :class="{ active: worldFamily === id }"
      :aria-pressed="worldFamily === id"
      @click="worldFamily = id"
    >
      {{ sections[id] }}
    </button>
  </div>
  <section
    v-if="system === 'china' && chinaFamily === 'quantity'"
    class="quantity-feature"
  >
    <div
      class="quantity-emblem"
      aria-hidden="true"
    >
      {{ quantityName }}
    </div>
    <div>
      <h3>县域行者 · 数量成就</h3>
      <strong>已到访 {{ quantity.count }} 个县级政区</strong>
      <p>
        当前：{{ quantityName }}{{ quantity.level ? `（${quantity.level}）` : '' }}；下一等级：{{
          nextQuantityName ? `${nextQuantityName}（${quantity.next}）` : '已达最高等级'
        }}。
      </p>
      <progress
        :value="quantity.count"
        :max="quantity.next || quantity.count || 1"
      ></progress>
    </div>
  </section>
  <details
    v-if="system === 'china' && chinaFamily === 'quantity'"
    class="quantity-levels"
  >
    <summary>查看全部 19 个数量等级</summary>
    <div>
      <span
        v-for="step in quantitySteps"
        :key="step.count"
        :class="{ reached: quantity.count >= step.count }"
        >{{ step.name }} · {{ step.count }}</span
      >
    </div>
  </details>
  <div
    v-if="!(system === 'china' && chinaFamily === 'quantity')"
    class="toolbar achievement-filters"
  >
    <input
      v-model="query"
      type="search"
      placeholder="搜索本系统成就"
      aria-label="搜索本系统成就"
    />
    <label
      ><input
        v-model="onlyIncomplete"
        type="checkbox"
      />仅未完成</label
    >
    <span>显示 {{ visible.length }} 枚</span>
  </div>
  <section
    class="achievement-grid"
  >
    <article
      v-for="badge in visible"
      :key="badge.id"
      class="achievement badge-card"
      :class="{ lit: badge.lit, international: badge.section.startsWith('world-') }"
      :style="{ '--badge-color': badgeColor(badge) }"
    >
      <span
        class="badge-emblem"
        aria-hidden="true"
        >{{ badge.title.split(' · ').at(-1)?.slice(0, 1) || '方' }}</span
      >
      <div class="badge-copy">
        <small>{{ sections[badge.section] }} · {{ badge.lit ? '已点亮' : '未点亮' }}</small>
        <h3>{{ badge.title }}</h3>
        <p>
          {{ badge.count }} / {{ badge.total
          }}<span v-if="badge.next"> · 下一级 {{ badge.next }}</span>
        </p>
        <progress
          :value="badge.count"
          :max="badge.total || 1"
        ></progress>
        <button
          type="button"
          @click="openBadge(badge.id)"
        >
          查看规则与目标
        </button>
      </div>
    </article>
  </section>
  <dialog
    ref="badgeDialog"
    class="achievement-dialog"
    @close="selectedBadgeId = ''"
  >
    <template v-if="selectedBadge">
      <header>
        <div>
          <small>{{ sections[selectedBadge.section] }}</small>
          <h3>{{ selectedBadge.title }}</h3>
        </div>
        <button
          type="button"
          aria-label="关闭成就详情"
          @click="closeBadge"
        >
          ×
        </button>
      </header>
      <div class="achievement-dialog-body">
        <p>{{ selectedBadge.count }} / {{ selectedBadge.total }} · {{ selectedBadge.note }}</p>
        <p
          v-for="pending in selectedBadge.pending"
          :key="pending"
          class="note"
        >
          {{ pending }}
        </p>
        <p
          v-for="(source, index) in selectedBadge.sources"
          :key="index"
        >
          <a
            :href="sourceUrl(source)"
            target="_blank"
            rel="noopener noreferrer"
            >{{ typeof source === 'string' ? '资料来源' : source.title }}</a
          >
        </p>
        <ul class="achievement-targets">
          <li
            v-for="(target, index) in visibleTargets"
            :key="index"
          >
            <span>{{ target.visited ? '✓' : '○' }} {{ target.label }}</span>
            <button
              v-for="regionId in target.regionIds"
              :key="regionId"
              @click="
                closeBadge();
                locate(regionId);
              "
            >
              定位
            </button>
          </li>
        </ul>
        <button
          v-if="selectedBadge.targets.length > detailLimit"
          @click="detailLimit += 80"
        >
          再显示 80 项（共 {{ selectedBadge.targets.length }} 项）
        </button>
      </div>
    </template>
  </dialog>
</template>
