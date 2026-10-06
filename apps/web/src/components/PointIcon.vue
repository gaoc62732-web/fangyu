<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 18 });
const paths: Record<string, string> = {
  back: 'M19 12H5m6-6-6 6 6 6',
  chevron: 'm6 9 6 6 6-6',
  legend: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  close: 'm6 6 12 12M18 6 6 18',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  settings: 'M4 7h7m4 0h5M4 17h11m4 0h1M11 4v6m4 4v6',
  check: 'm5 12 4 4L19 6',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  undo: 'M8 5 3 10l5 5M3 10h10a7 7 0 0 1 7 7',
  frame: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
  compass: 'm15 9-6 6 1.5-4.5L15 9ZM12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
  search: 'm16 16 5 5M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14',
};
</script>
<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] || paths.compass" />
  </svg>
</template>
