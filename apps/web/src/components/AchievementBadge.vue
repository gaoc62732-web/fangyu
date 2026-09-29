<script setup lang="ts">
import { computed } from 'vue';
import {
  WORLD_SERIES,
  REGION_COLORS,
  REGION_STYLES,
} from '../features/achievements/presentation.js';
const props = defineProps<{ title: string; section: string; lit: boolean; region?: string }>();
const international = computed(() => props.section.startsWith('world-'));
const scheme = computed(() => WORLD_SERIES.find((s) => s[0] === props.section));
const flagStyle = computed(() => {
  const r = props.region || '全国';
  const s = REGION_STYLES[r] || REGION_STYLES['全国']!;
  return {
    '--flag-color': REGION_COLORS[r] || REGION_COLORS['全国'],
    '--flag-edge': s.edge,
    '--flag-ink': s.ink,
    '--flag-outline': s.outline,
  };
});
const family = computed(() => props.title.split(/[·・]/)[0]?.trim() || '数量');
const label = computed(() =>
  props.title.includes('·') ? props.title.split('·').slice(1).join('·').trim() : props.title,
);
</script>
<template>
  <span
    v-if="international"
    class="world-medal"
    :class="{ illuminated: lit }"
    :style="{ '--badge-color': scheme?.[2] || '#397f78' }"
    aria-hidden="true"
    ><span>{{
      section === 'world-air'
        ? '✦'
        : section === 'world-heritage'
          ? '◇'
          : section === 'world-special'
            ? '◎'
            : '◈'
    }}</span
    ><small>{{ scheme?.[1] }}</small></span
  ><span
    v-else
    class="achFlag"
    :class="{ illuminated: lit }"
    :style="flagStyle"
    aria-hidden="true"
    ><span class="achFlagPole" /><span class="achFlagCloth"
      ><small class="achFlagFamily">{{ family }}</small
      ><strong class="achFlagName">{{ label }}</strong></span
    ></span
  >
</template>
