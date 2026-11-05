<script setup lang="ts">
import { computed } from 'vue';
import type { Region, Scope } from '@fangyu/contracts';
import { useAppStore } from '../app/store.js';
import PointIcon from './PointIcon.vue';

const props = defineProps<{ regionIds: string[]; scope: Scope }>();
const store = useAppStore();
const groups = computed(() => {
  void store.revision;
  const index = store.session!.index;
  const resolved = [...new Set(props.regionIds.map((id) => index.resolveRegion(id)))];
  const local = resolved.filter((id) => index.regions.get(id)?.scope === props.scope);
  const ids = (local.length ? local : resolved).filter((id, _, all) =>
    index.regions.has(id) && !all.some((other) => other !== id && index.belongsTo(other, id)));
  const result = new Map<string, { root: Region; rows: Map<string, { parents: Region[]; leaves: Region[] }> }>();
  for (const id of ids) {
    const region = index.regions.get(id)!;
    const path = index.ancestors(id).filter((item) => item.scope === region.scope);
    const root = path[0];
    if (!root) continue;
    let group = result.get(root.id);
    if (!group) {
      group = { root, rows: new Map() };
      result.set(root.id, group);
    }
    if (path.length < 2) continue;
    const parents = path.slice(1, -1);
    const key = parents.map((item) => item.id).join('|');
    let row = group.rows.get(key);
    if (!row) {
      row = { parents, leaves: [] };
      group.rows.set(key, row);
    }
    row.leaves.push(path[path.length - 1]!);
  }
  return [...result.values()].map((group) => ({ root: group.root, rows: [...group.rows.values()] }));
});
const count = computed(() => groups.value.reduce((sum, group) => sum + Math.max(1, group.rows.reduce((n, row) => n + row.leaves.length, 0)), 0));
const compact = computed(() => count.value > 4 || groups.value.length > 2);
</script>

<template>
  <component :is="compact ? 'details' : 'div'" class="point-region-summary">
    <summary v-if="compact">
      <span>{{ groups.map((group) => group.root.name).join('、') }}<small>{{ count }} 个地区</small></span>
      <PointIcon name="chevron" :size="13" />
    </summary>
    <div class="point-region-groups">
      <div v-for="group in groups" :key="group.root.id" class="point-region-group">
        <span class="point-region-root">{{ group.root.name }}</span>
        <div v-for="(row, rowIndex) in group.rows" :key="rowIndex" class="point-region-row">
          <span v-for="parent in row.parents" :key="parent.id" class="point-region-parent">{{ parent.name }}<PointIcon name="chevron" :size="10" /></span>
          <span class="point-region-leaves"><span v-for="leaf in row.leaves" :key="leaf.id">{{ leaf.name }}</span></span>
        </div>
      </div>
    </div>
  </component>
</template>

<style scoped>
.point-region-summary { min-width: 0; flex: 1; font-size: 12px; line-height: 1.5; }
.point-region-summary > summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; list-style: none; cursor: pointer; }
.point-region-summary > summary::-webkit-details-marker { display: none; }
.point-region-summary > summary > span { min-width: 0; overflow-wrap: anywhere; }
.point-region-summary > summary small { display: inline-block; margin-left: 8px; opacity: .55; font-size: 11px; }
.point-region-summary > summary > svg { flex: none; opacity: .6; transition: transform 180ms ease; }
.point-region-summary[open] > summary { margin-bottom: 8px; }
.point-region-summary[open] > summary > svg { transform: rotate(180deg); }
.point-region-groups { display: grid; gap: 8px; }
.point-region-group { min-width: 0; }
.point-region-root { display: block; font-weight: 500; }
.point-region-row { display: flex; align-items: baseline; flex-wrap: wrap; gap: 3px 6px; margin-top: 3px; }
.point-region-parent { display: inline-flex; align-items: center; gap: 4px; opacity: .55; }
.point-region-parent > svg { transform: rotate(-90deg); }
.point-region-leaves { display: inline-flex; align-items: baseline; flex-wrap: wrap; gap: 3px 6px; }
.point-region-leaves > span { padding: 0 5px; border-radius: 3px; background: var(--atlas-soft); overflow-wrap: anywhere; }
</style>
