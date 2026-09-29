<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useVirtualizer } from '@tanstack/vue-virtual';
import type { CatalogQueryResult } from '../features/catalog/query.js';
import { categoryIcon } from '../features/catalog/categories.js';
import { useAppStore } from '../app/store.js';
const props = defineProps<{
  result: CatalogQueryResult;
  expanded: Record<string, boolean>;
  initialScroll: number;
  wide?: boolean;
  batch?: boolean;
  selected: Set<string>;
  contextRegion: string;
  contextKey: string;
}>();
const emit = defineEmits<{
  open: [id: string];
  mark: [id: string, value: boolean, subitem?: string];
  explore: [category: string];
  scroll: [value: number];
  toggle: [id: string];
  expand: [id: string, value: boolean];
}>();
const store = useAppStore();
const scroller = ref<HTMLElement>();
const subOpen = computed(
  () =>
    new Set(
      Object.keys(props.expanded)
        .filter((k) => k.startsWith('entry:') && props.expanded[k])
        .map((k) => k.slice(6)),
    ),
);
const categories = computed(
  () => new Map(store.session!.index.catalog.categories.map((c) => [c.id, c.name])),
);
const entries = computed(() => new Map(store.rows.map((e) => [e.id, e])));
const expanded = (id: string, count: number) => props.expanded[id] ?? (count > 0 && count <= 8);
type Item =
  { kind: 'category'; id: string; count: number; marked: number } | { kind: 'entry'; id: string };
const items = computed<Item[]>(() =>
  props.result.groups
    .filter((g) => g.ids.length)
    .flatMap((g) => [
      { kind: 'category' as const, id: g.id, count: g.ids.length, marked: g.marked },
      ...(expanded(g.id, g.ids.length) ? g.ids.map((id) => ({ kind: 'entry' as const, id })) : []),
    ]),
);
const virtual = useVirtualizer(
  computed(() => ({
    count: items.value.length,
    getScrollElement: () => scroller.value || null,
    estimateSize: (i: number) => (items.value[i]?.kind === 'category' ? 52 : props.wide ? 64 : 80),
    overscan: 6,
    getItemKey: (i: number) => items.value[i]!.kind + items.value[i]!.id,
    initialOffset: props.initialScroll,
  })),
);
const visible = computed(() => virtual.value.getVirtualItems());
function measure(el: unknown) {
  if (el instanceof HTMLElement) virtual.value.measureElement(el);
}
function toggleSub(id: string) {
  emit('expand', 'entry:' + id, !subOpen.value.has(id));
}
function scroll(e: Event) {
  emit('scroll', (e.target as HTMLElement).scrollTop);
}
onMounted(() => {
  if (scroller.value) scroller.value.scrollTop = props.initialScroll;
});
watch(
  () => [props.contextKey, props.initialScroll, props.result],
  async () => {
    await nextTick();
    if (scroller.value && Math.abs(scroller.value.scrollTop - props.initialScroll) > 1)
      virtual.value.scrollToOffset(props.initialScroll);
  },
);
watch(
  () => props.wide,
  () => virtual.value.measure(),
);
defineExpose({
  focusEntry: (id: string) => {
    const i = items.value.findIndex((x) => x.kind === 'entry' && x.id === id);
    if (i >= 0) virtual.value.scrollToIndex(i, { align: 'center' });
  },
});
</script>
<template>
  <div
    ref="scroller"
    tabindex="0"
    role="region"
    aria-label="项目分类清单，可用方向键和翻页键滚动"
    class="catalog-scroll"
    :class="{ 'wide-catalog': wide }"
    @scroll.passive="scroll"
  >
    <div
      v-if="!result.ids.length"
      class="empty-state"
    >
      <span class="empty-symbol">⌕</span>
      <h3>当前范围没有匹配项目</h3>
      <p>试试清除搜索、切换类别，或查看下辖地区。</p>
    </div>
    <div
      v-else
      :style="{ height: virtual.getTotalSize() + 'px', position: 'relative', width: '100%' }"
    >
      <div
        v-for="row in visible"
        :key="String(row.key)"
        :ref="measure"
        :data-index="row.index"
        :style="{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          transform: 'translateY(' + row.start + 'px)',
        }"
      >
        <div
          v-if="items[row.index]!.kind === 'category'"
          class="category-heading"
        >
          <button
            class="category-toggle"
            :aria-expanded="expanded(items[row.index]!.id, (items[row.index] as any).count)"
            @click="
              emit(
                'expand',
                items[row.index]!.id,
                !expanded(items[row.index]!.id, (items[row.index] as any).count),
              )
            "
          >
            <span class="category-icon">{{ categoryIcon(items[row.index]!.id) }}</span
            ><span
              >{{ categories.get(items[row.index]!.id)
              }}<small
                >{{ (items[row.index] as any).marked }} /
                {{ (items[row.index] as any).count }}</small
              ></span
            ><span class="chevron">{{
              expanded(items[row.index]!.id, (items[row.index] as any).count) ? '−' : '＋'
            }}</span>
          </button>
          <button
            class="icon-button"
            :aria-label="'在地图探索' + categories.get(items[row.index]!.id)"
            title="在地图探索此类"
            @click="emit('explore', items[row.index]!.id)"
          >
            ↗
          </button>
        </div>
        <template v-else-if="entries.get(items[row.index]!.id)">
          <article
            v-for="entry in [entries.get(items[row.index]!.id)!]"
            :key="entry.id"
            class="catalog-entry"
            :class="{ marked: entry.visited }"
          >
            <div class="entry-main">
              <input
                v-if="batch"
                type="checkbox"
                class="batch-checkbox"
                :checked="selected.has(entry.id)"
                :aria-label="'批量选择 ' + entry.name"
                @change="emit('toggle', entry.id)"
              />
              <input
                v-else
                type="checkbox"
                :checked="entry.checked"
                :indeterminate="entry.partial"
                :aria-label="entry.name + ' 到访'"
                @change="emit('mark', entry.id, ($event.target as HTMLInputElement).checked)"
              />
              <button
                class="entry-name"
                @click="emit('open', entry.id)"
              >
                {{ entry.name }}<small v-if="entry.partial">部分标记</small>
              </button>
              <span
                v-if="wide"
                class="entry-code"
                >{{ entry.code || '' }}</span
              >
              <span
                v-if="entry.coordinates"
                class="coordinate-indicator"
                title="可在地图定位"
                aria-label="有坐标"
                >⌖</span
              >
            </div>
            <div class="entry-meta">
              <span>{{ entry.path }}</span
              ><span v-if="entry.lines?.length">{{ entry.lines.join(' / ') }}</span>
            </div>
            <button
              v-if="entry.subitems.length"
              class="subitem-toggle"
              :aria-expanded="subOpen.has(entry.id)"
              @click="toggleSub(entry.id)"
            >
              {{ subOpen.has(entry.id) ? '收起' : '展开' }} {{ entry.subitems.length }} 个组成项目
            </button>
            <div
              v-if="subOpen.has(entry.id)"
              class="subitems"
            >
              <label
                v-for="sub in entry.subitems"
                :key="sub.id"
                ><input
                  type="checkbox"
                  :checked="store.session!.subitemVisited(entry.id, sub.id)"
                  :disabled="batch"
                  :aria-label="sub.name + ' 到访'"
                  @change="
                    emit('mark', entry.id, ($event.target as HTMLInputElement).checked, sub.id)
                  "
                />{{ sub.name }}</label
              >
            </div>
          </article>
        </template>
      </div>
    </div>
  </div>
</template>
