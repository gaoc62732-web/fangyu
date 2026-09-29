<script setup lang="ts" generic="T extends { id: string }">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useVirtualizer } from '@tanstack/vue-virtual';
const props = withDefaults(
  defineProps<{ items: T[]; rowHeight?: number; initialScroll?: number }>(),
  { rowHeight: 256, initialScroll: 0 },
);
const emit = defineEmits<{ scroll: [value: number] }>();
const host = ref<HTMLElement>();
const width = ref(900);
let observer: ResizeObserver;
const columns = computed(() => Math.max(1, Math.floor(width.value / 200)));
const virtual = useVirtualizer(
  computed(() => ({
    count: Math.ceil(props.items.length / columns.value),
    getScrollElement: () => host.value || null,
    estimateSize: () => props.rowHeight,
    overscan: 2,
    initialOffset: props.initialScroll,
  })),
);
onMounted(() => {
  observer = new ResizeObserver(() => (width.value = host.value!.clientWidth));
  observer.observe(host.value!);
  host.value!.scrollTop = props.initialScroll;
});
onUnmounted(() => observer?.disconnect());
</script>
<template>
  <div
    ref="host"
    tabindex="0"
    role="region"
    aria-label="成就卡片，可用方向键和翻页键滚动"
    class="virtual-grid-scroll"
    @scroll.passive="emit('scroll', ($event.target as HTMLElement).scrollTop)"
  >
    <div :style="{ height: virtual.getTotalSize() + 'px', position: 'relative' }">
      <div
        v-for="row in virtual.getVirtualItems()"
        :key="String(row.key)"
        class="virtual-grid-row"
        :style="{
          position: 'absolute',
          width: '100%',
          top: row.start + 'px',
          height: row.size + 'px',
          gridTemplateColumns: 'repeat(' + columns + ',minmax(0,1fr))',
        }"
      >
        <slot
          v-for="item in items.slice(row.index * columns, (row.index + 1) * columns)"
          :key="item.id"
          :item="item"
        />
      </div>
    </div>
  </div>
</template>
