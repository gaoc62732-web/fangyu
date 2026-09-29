<script setup lang="ts">
import { computed, onActivated, onDeactivated, ref, shallowRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { AchievementProgress, quantityProgress, maofenProgress } from '@fangyu/domain';
import { useAppStore } from '../app/store.js';
import {
  SERIES,
  WORLD_SERIES,
  QUANTITY_NAMES,
  QUANTITY_STEPS,
  REGION_COLORS,
  seriesOf,
  badgeStatus,
} from '../features/achievements/presentation.js';
import AchievementBadge from '../components/AchievementBadge.vue';
import VirtualGrid from '../components/VirtualGrid.vue';
import AppDialog from '../components/AppDialog.vue';
import { exportCsv } from '../features/exports/download.js';
type Badge = Omit<AchievementProgress, 'targets'> & { regionIds: string[] };
type Summary = {
  badges: Badge[];
  quantity: ReturnType<typeof quantityProgress>;
  score: ReturnType<typeof maofenProgress>;
};
const store = useAppStore(),
  router = useRouter();
const series = ref(localStorage.getItem('fangyu-achievement-series') || 'quantity');
if (!SERIES.some((s) => s[0] === series.value)) series.value = 'quantity';
const world = ref('world-atlas'),
  province = ref(''),
  status = ref(''),
  query = ref(''),
  tab = ref('badges');
const gridScroll = ref<Record<string, number>>({});
const gridKey = computed(() =>
  [series.value, world.value, province.value, status.value, query.value].join('|'),
);
const busy = ref(false),
  error = ref(''),
  active = ref(true),
  scoreSort = ref('score');
const summary = shallowRef<Summary>(),
  selected = ref(''),
  detail = shallowRef<AchievementProgress>(),
  targetQuery = ref(''),
  targetStatus = ref(''),
  targetPage = ref(0);
let revisionSerial = 0,
  detailSerial = 0;
const provinces = computed(() =>
  store.session!.index.catalog.regions.filter((r) => r.scope === 'china' && r.level === 0),
);
const selectedProvince = (b: Badge) =>
  !province.value || b.regionIds.some((id) => store.session!.index.belongsTo(id, province.value));
const visible = computed(() =>
  (summary.value?.badges || []).filter(
    (b) =>
      seriesOf(b) === series.value &&
      (series.value !== 'international' || b.section === world.value) &&
      selectedProvince(b) &&
      (!query.value ||
        [b.title, b.note, ...b.regionIds.map((id) => store.session!.index.regions.get(id)?.name)]
          .join(' ')
          .includes(query.value)) &&
      (!status.value || badgeStatus(b) === status.value),
  ),
);
const continueBadges = computed(() =>
  (summary.value?.badges || [])
    .filter((b) => b.count > 0 && !b.complete && !b.pending.length && b.catalogComplete !== false)
    .sort(
      (a, b) =>
        b.count / (b.next || b.total || 1) - a.count / (a.next || a.total || 1) ||
        (a.next || a.total) - a.count - ((b.next || b.total) - b.count) ||
        a.title.localeCompare(b.title, 'zh-CN'),
    )
    .slice(0, 6),
);
const quantityName = computed(
  () =>
    QUANTITY_NAMES[QUANTITY_STEPS.findIndex((n) => n === (summary.value?.quantity.level || 0))] ||
    '启程',
);
const nextName = computed(
  () =>
    QUANTITY_NAMES[QUANTITY_STEPS.findIndex((n) => n === summary.value?.quantity.next)] ||
    '方舆大观',
);
const targets = computed(() =>
  (detail.value?.targets || []).filter(
    (t) =>
      (!targetQuery.value || t.label.includes(targetQuery.value)) &&
      (!targetStatus.value || t.visited === (targetStatus.value === 'done')),
  ),
);
const scoreGroups = computed(() =>
  [...(summary.value?.score.groups || [])].sort((a, b) =>
    scoreSort.value === 'count'
      ? b.counts[2]! - a.counts[2]!
      : scoreSort.value === 'ratio'
        ? b.counts[2]! / (b.totals[2] || 1) - a.counts[2]! / (a.totals[2] || 1)
        : scoreSort.value === 'catalog'
          ? 0
          : b.score - a.score,
  ),
);
function regionStyle(b: Badge) {
  if (b.title.includes('全国')) return '全国';
  const direct = Object.keys(REGION_COLORS).find((r) => b.title.includes(r));
  if (direct) return direct;
  const id = b.regionIds[0];
  const code = id ? store.session!.index.ancestors(id)[0]?.code || '' : '';
  const prefix = code.slice(0, 1);
  return (
    (
      {
        '1': '华北',
        '2': '东北',
        '3': '华东',
        '4': '中南',
        '5': '西南',
        '6': '西北',
        '7': '港澳台',
        '8': '港澳台',
      } as Record<string, string>
    )[prefix] || '全国'
  );
}
async function loadDetail() {
  const ticket = ++detailSerial;
  if (!selected.value) return;
  try {
    const result = await store.worker!.request<AchievementProgress>('achievement', selected.value);
    if (ticket === detailSerial) detail.value = result;
  } catch (cause) {
    error.value = String(cause);
  }
}
function open(id: string) {
  selected.value = id;
  detail.value = undefined;
  targetQuery.value = '';
  targetStatus.value = '';
  targetPage.value = 0;
  void loadDetail();
}
function locate(id: string) {
  const region = store.session!.index.regions.get(id);
  if (region)
    void router.push({
      path: '/map',
      query: { scope: region.scope, region: id, from: 'achievements' },
    });
}
function safeUrl(source: string | { title: string; url: string }) {
  const url = typeof source === 'string' ? source : source.url;
  return /^https?:\/\//i.test(url) ? url : undefined;
}
function scoreCsv() {
  exportCsv(
    [
      ['地区', '省级到访', '地级到访', '县级到访', '县级总数', '卯县比例', '卯分'],
      ...scoreGroups.value.map((g) => [
        g.province.name,
        ...g.counts,
        g.totals[2],
        g.totals[2] ? g.counts[2]! / g.totals[2]! : '',
        g.score.toFixed(2),
      ]),
    ],
    '方舆分省卯分.csv',
  );
}
function targetsCsv() {
  if (detail.value)
    exportCsv(
      [
        ['成就', '目标', '到访', '说明'],
        ...detail.value.targets.map((t) => [
          detail.value!.title,
          t.label,
          t.visited,
          detail.value!.note,
        ]),
      ],
      '方舆成就目标.csv',
    );
}
watch(
  [() => store.revision, active],
  async () => {
    const ticket = ++revisionSerial;
    if (!active.value) return;
    busy.value = true;
    try {
      const result = await store.worker!.request<Summary>('achievements');
      if (ticket === revisionSerial) {
        summary.value = result;
        if (selected.value) void loadDetail();
      }
    } catch (cause) {
      error.value = String(cause);
    } finally {
      if (ticket === revisionSerial) busy.value = false;
    }
  },
  { immediate: true },
);
watch(series, () => {
  try {
    localStorage.setItem('fangyu-achievement-series', series.value);
  } catch {}
  province.value = '';
  query.value = '';
  status.value = '';
});
watch([targetQuery, targetStatus], () => (targetPage.value = 0));
onActivated(() => (active.value = true));
onDeactivated(() => (active.value = false));
</script>
<template>
  <div class="achievements-page">
    <header class="page-heading split-heading">
      <div>
        <span class="eyebrow">把走过的地方，收藏成章</span>
        <h1>旅行成就</h1>
        <p>行遍山河，循迹古今。每个系列独立查看，随记录更新。</p>
      </div>
      <div class="segmented">
        <button
          :aria-pressed="tab === 'badges'"
          @click="tab = 'badges'"
        >
          成就图鉴</button
        ><button
          :aria-pressed="tab === 'score'"
          @click="tab = 'score'"
        >
          卯分明细
        </button>
      </div>
    </header>
    <p
      v-if="error"
      class="inline-error"
      role="alert"
    >
      {{ error }}
    </p>
    <p
      v-if="busy && !summary"
      class="loading"
      role="status"
    >
      正在整理旅行成就…
    </p>
    <template v-if="summary">
      <div class="achievement-summary">
        <span
          ><strong>{{ summary.quantity.count }}</strong> 县级地区已到访</span
        ><span
          ><strong>{{ summary.badges.filter((b) => b.lit).length }}</strong> 枚成就已点亮</span
        ><button
          class="text-button"
          @click="tab = 'score'"
        >
          卯分 {{ summary.score.score.toFixed(2) }} ↗
        </button>
      </div>
      <template v-if="tab === 'badges'">
        <nav
          class="series-nav"
          aria-label="成就系列"
        >
          <button
            v-for="[id, label] in SERIES"
            :key="id"
            :aria-pressed="series === id"
            @click="series = id"
          >
            {{ label }}
          </button>
        </nav>
        <div
          v-if="series === 'quantity'"
          class="quantity-layout"
        >
          <section class="quantity-hero">
            <div>
              <span class="eyebrow">数量成就 · 县域行者</span>
              <h2>{{ quantityName }}</h2>
              <p>
                <strong>{{ summary.quantity.count }}</strong> 个已到访
              </p>
              <p>
                {{
                  summary.quantity.next
                    ? '下一级 · ' + nextName + '（' + summary.quantity.next + ' 个政区）'
                    : '已达到最高等级 · 方舆大观'
                }}
              </p>
              <progress
                :value="summary.quantity.count"
                :max="summary.quantity.next || 2500"
                aria-label="县域数量成就进度"
              /><small>到达、短居与居住计入；飞跃与途经不计入。</small>
            </div>
            <AchievementBadge
              :title="'数量 · ' + quantityName"
              section="quantity"
              :lit="!!summary.quantity.level"
            />
          </section>
          <section class="card quantity-levels">
            <h3>成长之路</h3>
            <div
              v-for="(step, i) in QUANTITY_STEPS"
              :key="step"
              :class="{
                reached: summary.quantity.count >= step,
                next: summary.quantity.next === step,
              }"
            >
              <span>{{ step }}</span
              ><strong>{{ QUANTITY_NAMES[i] }}</strong
              ><small>{{
                step === summary.quantity.level
                  ? '当前等级'
                  : summary.quantity.count >= step
                    ? '已达成'
                    : summary.quantity.next === step
                      ? '下一等级'
                      : ''
              }}</small>
            </div>
          </section>
          <section
            v-if="continueBadges.length"
            class="continue-panel"
          >
            <h3>继续收集</h3>
            <div>
              <button
                v-for="b in continueBadges"
                :key="b.id"
                @click="open(b.id)"
              >
                <strong>{{ b.title }}</strong
                ><span>{{ b.count }} / {{ b.next || b.total }}</span>
              </button>
            </div>
          </section>
          <p
            v-else
            class="note"
          >
            从地图或地区手册记录第一次到访，成就将随之点亮。
          </p>
        </div>
        <template v-else
          ><div class="series-heading">
            <div>
              <span class="eyebrow">{{ SERIES.find((s) => s[0] === series)?.[2] }}</span>
              <h2>{{ SERIES.find((s) => s[0] === series)?.[1] }}</h2>
            </div>
            <span>{{ visible.length }} 枚符合筛选</span>
          </div>
          <nav
            v-if="series === 'international'"
            class="subnav"
            aria-label="国际成就系列"
          >
            <button
              v-for="[id, label, color] in WORLD_SERIES"
              :key="id"
              :aria-pressed="world === id"
              :style="{ '--series-color': color }"
              @click="world = id"
            >
              {{ label }}
            </button>
          </nav>
          <div class="toolbar">
            <input
              v-model="query"
              type="search"
              placeholder="搜索成就或目标地区"
              aria-label="搜索成就"
            /><select
              v-if="series !== 'international'"
              v-model="province"
              aria-label="成就省份"
            >
              <option value="">全部省区</option>
              <option
                v-for="p in provinces"
                :key="p.id"
                :value="p.id"
              >
                {{ p.name }}
              </option></select
            ><select
              v-model="status"
              aria-label="成就状态"
            >
              <option value="">全部状态</option>
              <option
                v-for="s in ['未开始', '进行中', '已点亮', '已完成', '暂缓']"
                :key="s"
              >
                {{ s }}
              </option>
            </select>
          </div>
          <VirtualGrid
            v-if="visible.length"
            :key="gridKey"
            :initial-scroll="gridScroll[gridKey] || 0"
            @scroll="(value) => (gridScroll[gridKey] = value)"
            :items="visible"
            :row-height="256"
            v-slot="{ item: b }"
            ><button
              class="achievement-card"
              :class="{ lit: b.lit }"
              @click="open(b.id)"
            >
              <AchievementBadge
                :title="b.title"
                :section="b.section"
                :lit="b.lit"
                :region="regionStyle(b)"
              /><strong>{{ b.title }}</strong
              ><span
                >{{ b.count }} / {{ b.total }} <small>{{ badgeStatus(b) }}</small></span
              ><progress
                :value="b.count"
                :max="b.next || b.total || 1"
                :aria-label="b.title + '进度'"
              /></button
          ></VirtualGrid>
          <div
            v-else
            class="empty-state"
          >
            <h3>没有符合筛选的成就</h3>
            <p>试试切换系列或清除筛选。</p>
          </div>
        </template>
      </template>
      <section
        v-else
        class="score-page"
      >
        <div class="stat-grid">
          <article class="card">
            <small>当前卯分</small><strong>{{ summary.score.score.toFixed(2) }}</strong
            ><span>本版满分 {{ summary.score.maximum.toFixed(2) }}</span>
          </article>
          <article class="card">
            <small>已到访县级地区</small><strong>{{ summary.score.counts[2] }}</strong
            ><span>计分范围 {{ summary.score.totals[2] }} 个</span>
          </article>
          <article class="card">
            <small>县级覆盖比例</small
            ><strong
              >{{
                ((100 * summary.score.counts[2]!) / (summary.score.totals[2] || 1)).toFixed(1)
              }}%</strong
            ><span>居住、短居计入到达</span>
          </article>
        </div>
        <div class="toolbar">
          <h2>分省明细</h2>
          <select
            v-model="scoreSort"
            aria-label="卯分排序"
          >
            <option value="score">按卯分</option>
            <option value="catalog">目录顺序</option>
            <option value="count">按卯县数</option>
            <option value="ratio">按卯县比例</option></select
          ><button @click="scoreCsv">导出 CSV</button>
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>地区</th>
                <th>省级</th>
                <th>地级</th>
                <th>卯县数</th>
                <th>卯县比例</th>
                <th>卯分</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="g in scoreGroups"
                :key="g.province.id"
              >
                <td>
                  <button
                    class="text-button"
                    @click="locate(g.province.id)"
                  >
                    {{ g.province.name }}
                  </button>
                </td>
                <td
                  v-for="i in [0, 1, 2]"
                  :key="i"
                >
                  {{ g.counts[i] }} / {{ g.totals[i] }}
                </td>
                <td>
                  {{ g.totals[2] ? ((100 * g.counts[2]!) / g.totals[2]!).toFixed(1) + '%' : '—' }}
                </td>
                <td>{{ g.score.toFixed(2) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <details class="rules">
          <summary>计分规则与范围</summary>
          <p>
            省级 1 分，地级 0.2 分，县级 0.05
            分；居住、短居、到达计分。基数由当前目录和现有计分规则计算，历史行与特殊范围沿用当前数据层定义。
          </p>
        </details>
      </section>
    </template>
    <AppDialog
      v-if="selected && active"
      :title="detail?.title || '成就详情'"
      @close="
        selected = '';
        detail = undefined;
      "
      ><template v-if="detail"
        ><p class="detail-progress">
          {{ detail.count }} / {{ detail.total }} · {{ badgeStatus(detail)
          }}<span v-if="detail.next"> · 下一级 {{ detail.next }}</span>
        </p>
        <p>{{ detail.note }}</p>
        <p
          v-for="p in detail.pending"
          :key="p"
          class="pending-note"
        >
          暂缓：{{ p }}
        </p>
        <div class="source-links">
          <a
            v-for="(s, i) in detail.sources"
            :key="i"
            :href="safeUrl(s)"
            target="_blank"
            rel="noopener noreferrer"
            >{{ typeof s === 'string' ? '资料来源 ' + (i + 1) : s.title }} ↗</a
          >
        </div>
        <div class="toolbar">
          <input
            v-model="targetQuery"
            type="search"
            placeholder="搜索目标"
            aria-label="搜索成就目标"
          /><select
            v-model="targetStatus"
            aria-label="目标状态"
          >
            <option value="">全部目标</option>
            <option value="done">已到访</option>
            <option value="todo">未完成</option></select
          ><button @click="targetsCsv">导出目标</button>
        </div>
        <div class="achievement-targets">
          <div
            v-for="(t, i) in targets.slice(targetPage * 60, (targetPage + 1) * 60)"
            :key="i"
            class="achievement-target"
          >
            <span :class="{ marked: t.visited }">{{ t.visited ? '✓' : '○' }} {{ t.label }}</span>
            <div>
              <button
                v-for="id in t.regionIds"
                :key="id"
                class="text-button"
                @click="locate(id)"
              >
                {{
                  t.regionIds.length === 1
                    ? '地图查看 ↗'
                    : store.session!.index.regions.get(id)?.name + ' ↗'
                }}
              </button>
            </div>
          </div>
        </div>
        <div class="toolbar">
          <button
            :disabled="targetPage === 0"
            @click="targetPage--"
          >
            上一页</button
          ><span
            >{{ targets.length }} 个目标 · {{ targetPage + 1 }} /
            {{ Math.max(1, Math.ceil(targets.length / 60)) }}</span
          ><button
            :disabled="(targetPage + 1) * 60 >= targets.length"
            @click="targetPage++"
          >
            下一页
          </button>
        </div></template
      >
      <p
        v-else
        role="status"
      >
        正在整理目标…
      </p></AppDialog
    >
  </div>
</template>
