<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import PointIcon from './PointIcon.vue';

const props = withDefaults(defineProps<{
  modelValue: string;
  options: { value: string; label: string }[];
  label: string;
  open: boolean;
  hoverOpen?: boolean;
}>(), { hoverOpen: true });
const emit = defineEmits<{
  'update:modelValue': [value: string];
  'update:open': [value: boolean];
  change: [value: string];
}>();
const id = useId();
const root = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const menu = ref<HTMLElement>();
const selectedLabel = computed(
  () => props.options.find((option) => option.value === props.modelValue)?.label || '暂无类别',
);
function close() {
  if (menu.value?.contains(document.activeElement)) trigger.value?.focus();
  emit('update:open', false);
}
async function show(focus = false, last = false) {
  emit('update:open', true);
  if (!focus) return;
  await nextTick();
  const choices = menu.value?.querySelectorAll<HTMLButtonElement>('[role="option"]');
  if (!choices?.length) return;
  const selected = props.options.findIndex((option) => option.value === props.modelValue);
  choices[selected < 0 ? (last ? choices.length - 1 : 0) : selected]?.focus();
}
function hover(event: PointerEvent) {
  if (props.hoverOpen && event.pointerType === 'mouse') void show();
}
function leave(event: PointerEvent) {
  if (props.hoverOpen && event.pointerType === 'mouse') close();
}
function choose(value: string) {
  if (value !== props.modelValue) {
    emit('update:modelValue', value);
    emit('change', value);
  }
  close();
}
function navigate(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    close();
    return;
  }
  const choices = Array.from(
    menu.value?.querySelectorAll<HTMLButtonElement>('[role="option"]') || [],
  );
  if (!choices.length) return;
  const current = choices.indexOf(document.activeElement as HTMLButtonElement);
  let next: number | undefined;
  if (event.key === 'ArrowDown') next = (current + 1) % choices.length;
  if (event.key === 'ArrowUp') next = (current - 1 + choices.length) % choices.length;
  if (event.key === 'Home') next = 0;
  if (event.key === 'End') next = choices.length - 1;
  if (next !== undefined) {
    event.preventDefault();
    choices[next]?.focus();
    choices[next]?.scrollIntoView({ block: 'nearest' });
  }
}
function focusOut(event: FocusEvent) {
  if (!root.value?.contains(event.relatedTarget as Node | null)) close();
}
function outside(event: PointerEvent) {
  if (props.open && !root.value?.contains(event.target as Node)) close();
}
onMounted(() => document.addEventListener('pointerdown', outside));
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside));
</script>

<template>
  <div
    ref="root"
    class="point-select"
    @pointerenter="hover"
    @pointerleave="leave"
    @focusout="focusOut"
  >
    <button
      ref="trigger"
      class="point-select-trigger"
      type="button"
      :aria-label="label"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="id"
      :title="selectedLabel"
      @click="open ? close() : show(true)"
      @keydown.down.prevent="show(true)"
      @keydown.up.prevent="show(true, true)"
      @keydown.esc.prevent.stop="close"
    >
      <span>{{ selectedLabel }}</span>
      <PointIcon
        name="chevron"
        :size="16"
      />
    </button>
    <div
      v-if="open"
      class="point-select-popover"
    >
      <div
        :id="id"
        ref="menu"
        class="point-select-menu"
        role="listbox"
        :aria-label="label"
        @keydown="navigate"
      >
        <button
          v-for="option in options"
          :key="option.value"
          type="button"
          role="option"
          :aria-selected="modelValue === option.value"
          tabindex="-1"
          @click="choose(option.value)"
        >
          <span>{{ option.label }}</span>
          <PointIcon
            v-if="modelValue === option.value"
            name="check"
            :size="16"
          />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.point-select {
  position: relative;
  min-width: 0;
}
.point-select button {
  font: inherit;
  color: var(--point-ink, #30372e);
  border: 0;
  background: transparent;
  box-shadow: none;
  cursor: pointer;
}
.point-select button:focus-visible {
  outline: 2px solid #a18b5d;
  outline-offset: 3px;
}
.point-select .point-select-trigger {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 48px;
  padding: 0 18px;
  border-radius: 10px;
  font-size: var(--point-body-size, 16px);
  font-weight: 300;
  text-align: left;
}
.point-select-trigger > span {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.point-select-trigger > svg {
  flex-shrink: 0;
}
.point-select-trigger:hover,
.point-select-trigger[aria-expanded='true'] {
  background: #f2f2e9;
}
.point-select-popover {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 5;
  min-width: 100%;
  width: max-content;
  max-width: 340px;
  padding-top: 8px;
}
.point-select-menu {
  max-height: min(420px, 55vh);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px;
  border: 1px solid var(--point-line, #e7e7de);
  border-radius: 12px;
  background: var(--point-paper, #fffefa);
  box-shadow: none;
}
.point-select .point-select-menu button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  width: 100%;
  min-height: 44px;
  padding: 10px 14px;
  border-radius: 6px;
  font-size: var(--point-body-size, 16px);
  font-weight: 300;
  line-height: 1.5;
  text-align: left;
}
.point-select-menu button[aria-selected='true'] {
  background: #f2f2e9;
}
.point-select-menu button:hover,
.point-select-menu button:focus-visible {
  background: #e9ece1;
  outline-offset: -2px;
}
.point-select-menu svg {
  flex-shrink: 0;
}
@media (max-width: 740px) {
  .point-select .point-select-trigger {
    gap: 5px;
    padding: 0 10px;
  }
  .point-select-popover {
    position: fixed;
    top: 124px;
    left: 16px;
    right: 16px;
    width: auto;
    min-width: 0;
    max-width: none;
  }
}
</style>
