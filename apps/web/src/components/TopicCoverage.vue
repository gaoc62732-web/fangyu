<script setup lang="ts">
import { computed } from 'vue';
import { getScopeConfig, type Scope } from '@fangyu/contracts';
import { useAppStore } from '../app/store.js';
const props = defineProps<{ scope: Scope }>();
const store = useAppStore();
const coverage = computed(() =>
  store.session!.index.catalog.topicCoverage?.find((item) => item.scope === props.scope),
);
</script>
<template>
  <details
    v-if="coverage?.sources.length"
    class="topic-coverage"
  >
    <summary>资料来源 · {{ getScopeConfig(scope).name }}</summary>
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
