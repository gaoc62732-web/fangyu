<script setup lang="ts">
import { VISIT_LABELS, type VisitState } from '@fangyu/contracts';
import { useAppStore } from '../app/store.js';

const props = defineProps<{ regionId: string }>();
const store = useAppStore();

function change(event: Event) {
  const state = (event.target as HTMLSelectElement).value as VisitState;
  store.commit((session) => session.setRegionState(props.regionId, state));
}
</script>

<template>
  <label class="state-select">
    旅行状态
    <select
      :key="store.revision"
      :value="store.session!.visitState(regionId)"
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
  </label>
</template>
