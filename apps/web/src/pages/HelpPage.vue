<script setup lang="ts">
import { computed } from 'vue';
import { useAppStore } from '../app/store.js';
const store = useAppStore();
const sources = computed(() =>
  store.session!.index.catalog.sources.filter(
    (source): source is { name: string; url: string } =>
      typeof source === 'object' &&
      source !== null &&
      'name' in source &&
      typeof source.name === 'string' &&
      'url' in source &&
      typeof source.url === 'string' &&
      /^https?:\/\//i.test(source.url),
  ),
);
</script>

<template>
  <section class="page-heading"><h2>使用说明</h2></section>
  <article class="card prose">
    <h3>记录规则</h3>
    <p>
      到达、短居、居住计入成就。点位点卯按照记录偏好询问是否关联其他类别与行政区；取消地点点亮不会撤销地区状态。
    </p>
    <p>组成地点分别记录，项目到访不代表全部地点已到访。球场到访、参观和观赛分别记录。</p>
    <h3>导入与备份</h3>
    <p>导入后先核对预览，再确认应用。恢复备份会替换当前记录，操作前自动备份。</p>
    <p>Excel 请使用本站导出的模板。照片仅读取 GPS，原图不上传。</p>
    <h3>地图与资料</h3>
    <p>地图仅供旅行记录参考，边界不代表权威行政区划，地点坐标不一定是参观入口。</p>
    <p>
      世界遗产基础字段来自 UNESCO DataHub（2026-09-19 版本，CC BY-SA 4.0）。Copyright © 1992–2026
      UNESCO/World Heritage Centre. All rights reserved.
    </p>
    <details v-if="sources.length">
      <summary>目录来源清单</summary>
      <ul>
        <li
          v-for="source in sources"
          :key="source.url"
        >
          <a
            :href="source.url"
            target="_blank"
            rel="noopener noreferrer"
            >{{ source.name }}</a
          >
        </li>
      </ul>
    </details>
  </article>
</template>
