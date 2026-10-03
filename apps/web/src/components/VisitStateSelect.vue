<script setup lang="ts">
import { computed } from 'vue';
import { VISIT_LABELS, type VisitState } from '@fangyu/contracts';
import { useAppStore } from '../app/store.js';

const props = withDefaults(defineProps<{ regionId: string; propagate?: boolean }>(), {
  propagate: true,
});
const store = useAppStore();
const city = computed(() => {
  const region = store.session!.index.regions.get(props.regionId);
  return region?.scope === 'china' && region.level === 1;
});
const recorded = computed(() => {
  void store.revision;
  return store.session!.recordedVisitState(props.regionId);
});
const effective = computed(() => {
  void store.revision;
  return store.session!.visitState(props.regionId);
});

function change(event: Event) {
  const state = (event.target as HTMLSelectElement).value as VisitState;
  store.commit((session) => session.setRegionState(props.regionId, state, props.propagate));
}
</script>

<template>
  <label class="state-select">
    {{ city ? '手动旅行状态' : '旅行状态' }}
    <select
      :key="store.revision"
      :value="recorded"
      @change="change"
    >
      <option
        v-for="(label, value) in VISIT_LABELS"
        :key="value"
        :value="value"
      >
        {{ label }}
      </option>
    </select>
    <small
      v-if="city"
      class="effective-visit-state"
      role="status"
    >
      地图与统计状态：{{ VISIT_LABELS[effective]
      }}<template v-if="effective !== recorded"
        >（根据直属县级居住记录推导；手动记录保持为{{ VISIT_LABELS[recorded] }}）</template
      >
    </small>
  </label>
</template>
