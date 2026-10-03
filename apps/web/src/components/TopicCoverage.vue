<script setup lang="ts">
import { computed } from 'vue';
import { getScopeConfig, type Scope } from '@fangyu/contracts';
import { useAppStore } from '../app/store.js';
const props = defineProps<{ scope: Scope }>();
const store = useAppStore();
const coverage = computed(() =>
  store.session!.index.catalog.topicCoverage?.find((item) => item.scope === props.scope),
);
const labels: Record<string, string> = {
  uzbekistan: '14 个一级地区；边界为 2017 年来源快照。国内文保层已暂停。',
  vietnam:
    '34 个省市，采用 2025-07-01 改革快照。国家特别遗迹：153 条认定归并 149 个父项目，组成点与坐标待核实。',
  germany: '16 个联邦州。',
  france: '本土 13 个大区与 5 个海外地区层级单元分列；其他特殊海外单元暂未纳入。',
  italy: '20 个行政大区。',
  usa: '50 州与哥伦比亚特区分列，其他属地不计入州层。',
  spain: '17 个自治社区与休达、梅利利亚 2 个自治市分列。',
  uk: '92 个历史郡，采用 Historic Counties Standard Definition A，飞地归所在郡。依据早期 Ordnance Survey 郡测绘（爱尔兰始于 1824），无单一全国法律基准年；用于文化地图。',
};
</script>
<template>
  <details
    v-if="coverage"
    class="topic-coverage"
  >
    <summary>收录范围与资料版本 · {{ getScopeConfig(scope).name }}</summary>
    <p>{{ labels[scope] || getScopeConfig(scope).note }}</p>
    <p v-if="coverage.boundary">边界快照：{{ coverage.boundary.asOf }}。</p>
    <p>
      世界遗产 {{ coverage.counts.unescoProjects }} 项；当前组成记录
      {{ coverage.counts.unescoComponents }} 条，其中
      {{ coverage.counts.unescoComponentsWithCoordinates }}
      条有坐标。组成记录包含官方地理单元，尚不等同于完整独立景点清单。
    </p>
    <p v-if="coverage.counts.unescoProjectsPartial">
      {{ coverage.counts.unescoProjectsPartial }} 个项目仍需补充或细化，不判定全部完成。
    </p>
    <p v-if="coverage.counts.unescoComponentsReferenceOnly">
      {{ coverage.counts.unescoComponentsReferenceOnly }}
      条仅有项目或共享参考位置，未作为独立地点绘制。其余官方坐标也不表示游客入口。
    </p>
    <p v-if="coverage.counts.footballVenues">
      球场 {{ coverage.counts.footballVenues }} 座，其中
      {{ coverage.counts.footballVenuesWithCoordinates }} 座有已核实坐标；名单与坐标覆盖分别统计。
    </p>
    <p>无坐标的地点保留列表记录；旧项目打卡不会自动标记组成地点。</p>
    <details>
      <summary>逐项资料说明与来源</summary>
      <ul>
        <li
          v-for="note in coverage.notes"
          :key="note"
        >
          {{ note }}
        </li>
      </ul>
      <ol>
        <li
          v-for="(source, i) in coverage.sources"
          :key="source"
        >
          <a
            :href="source"
            target="_blank"
            rel="noopener noreferrer"
            >资料来源 {{ i + 1 }}</a
          >
        </li>
      </ol>
    </details>
  </details>
</template>
<style scoped>
.topic-coverage {
  margin: 10px 0 18px;
  padding: 12px 16px;
  border: 1px solid #90ac9a55;
  border-radius: 10px;
}
summary {
  cursor: pointer;
}
p,
li {
  font-size: 13px;
  line-height: 1.65;
}
ol {
  columns: 3;
}
@media (max-width: 600px) {
  ol {
    columns: 2;
  }
}
</style>
