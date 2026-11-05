<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import PointIcon from './PointIcon.vue';

const props = withDefaults(defineProps<{
  modelValue?: string;
  options: { value: string; label: string; icon?: string; color?: string }[];
  label: string;
  open: boolean;
  hoverOpen?: boolean;
  compact?: boolean;
  multiple?: boolean;
  selectedValues?: string[];
  emptyLabel?: string;
  disabled?: boolean;
  fitLabel?: boolean;
  selectionSummary?: boolean;
}>(), { modelValue: '', hoverOpen: true, compact: false, multiple: false, selectedValues: () => [], emptyLabel: '全部类别', disabled: false, fitLabel: false, selectionSummary: false });
const emit = defineEmits<{
  'update:modelValue': [value: string];
  'update:open': [value: boolean];
  change: [value: string];
  'update:selectedValues': [values: string[]];
}>();
const id = useId();
const root = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const menu = ref<HTMLElement>();
const measure = ref<HTMLElement>();
const labelWidth = ref(0);
const triggerWidth = ref(0);
let measureObserver: ResizeObserver | undefined;
const selectedOption = computed(() => props.options.find((option) => option.value === props.modelValue));
const selectedLabel = computed(
  () => props.multiple
    ? props.selectionSummary && props.selectedValues.length
      ? `已选 ${props.selectedValues.length} 类`
      : props.options.filter((option) => props.selectedValues.includes(option.value)).map((option) => option.label).join('、') || props.emptyLabel
    : selectedOption.value?.label || '暂无类别',
);
const compactStyle = computed(() => props.compact ? {
  '--select-label-width': (labelWidth.value || Array.from(selectedLabel.value).length * 16) + 'px',
  '--select-width': (props.open ? (labelWidth.value || Array.from(selectedLabel.value).length * 16) + 80 : 48) + 'px',
  '--select-accent': selectedOption.value?.color,
} : props.fitLabel ? {
  '--select-fit-size': Math.max(11, Math.min(14,
    (triggerWidth.value ? triggerWidth.value - 42 : labelWidth.value) / (labelWidth.value || 1) * 14,
  )) + 'px',
} : undefined);
function close() {
  if (menu.value?.contains(document.activeElement)) trigger.value?.focus();
  emit('update:open', false);
}
async function show(focus = false, last = false) {
  if (props.disabled) return;
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
  if (props.multiple) {
    emit('update:selectedValues', !value ? [] : props.selectedValues.includes(value)
      ? props.selectedValues.filter((id) => id !== value)
      : [...props.selectedValues, value]);
    return;
  }
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
onMounted(() => {
  document.addEventListener('pointerdown', outside);
  if ((props.compact || props.fitLabel) && measure.value) {
    measureObserver = new ResizeObserver(() => {
      labelWidth.value = measure.value?.getBoundingClientRect().width || 0;
      triggerWidth.value = trigger.value?.getBoundingClientRect().width || 0;
    });
    measureObserver.observe(measure.value);
    if (props.fitLabel && trigger.value) measureObserver.observe(trigger.value);
  }
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', outside);
  measureObserver?.disconnect();
});
</script>

<template>
  <div
    ref="root"
    class="point-select"
    :class="{ 'is-compact': compact, 'is-open': open, 'is-multiple': multiple, 'is-fitted': fitLabel }"
    :style="compactStyle"
    @pointerenter="hover"
    @pointerleave="leave"
    @focusout="focusOut"
  >
    <button
      ref="trigger"
      class="point-select-trigger"
      type="button"
      :disabled="disabled"
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
      <PointIcon v-if="selectedOption?.icon && !multiple" class="point-select-category-icon" :name="selectedOption.icon" :size="20" />
      <span class="point-select-label">{{ selectedLabel }}</span>
      <PointIcon
        name="chevron"
        class="point-select-chevron"
        :size="16"
      />
    </button>
    <span v-if="compact || fitLabel" ref="measure" class="point-select-measure" aria-hidden="true">{{ selectedLabel }}</span>
    <Transition name="point-select-reveal">
    <div
      v-if="open"
      class="point-select-popover"
    >
      <div class="point-select-frame">
      <div
        :id="id"
        ref="menu"
        class="point-select-menu"
        role="listbox"
        :aria-label="label"
        :aria-multiselectable="multiple || undefined"
        @keydown="navigate"
      >
        <button
          v-for="option in options"
          :key="option.value"
          type="button"
          role="option"
          :aria-selected="multiple ? (!option.value ? !selectedValues.length : selectedValues.includes(option.value)) : modelValue === option.value"
          :style="option.color ? { '--select-accent': option.color, color: option.color } : undefined"
          tabindex="-1"
          @click="choose(option.value)"
        >
          <span class="point-select-option-label"><PointIcon v-if="option.icon" :name="option.icon" :size="20" /><span>{{ option.label }}</span></span>
          <PointIcon
            v-if="multiple ? (!option.value ? !selectedValues.length : selectedValues.includes(option.value)) : modelValue === option.value"
            name="check"
            :size="16"
          />
        </button>
      </div>
      </div>
    </div>
    </Transition>
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
.point-select-frame {
  padding: 6px 4px 6px 6px;
  border: 1px solid var(--point-line, #e7e7de);
  border-radius: 12px;
  background: var(--point-paper, #fffefa);
  overflow: hidden;
}
.point-select-menu {
  max-height: min(420px, 55vh);
  overflow-y: auto;
  overscroll-behavior: contain;
  border-radius: 6px;
}
.point-select-menu::-webkit-scrollbar { width: 6px; height: 6px; }
.point-select-menu::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
.point-select-menu::-webkit-scrollbar-track { margin: 10px 0; background: transparent; }
.point-select-menu::-webkit-scrollbar-thumb {
  border: 1px solid var(--point-paper, #fffefa);
  border-radius: 12px;
  background: #929d9580;
  background-clip: padding-box;
}
@supports not selector(::-webkit-scrollbar) {
  .point-select-menu { scrollbar-width: thin; scrollbar-color: #929d9580 transparent; }
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
.point-select-option-label { display: flex; align-items: center; gap: 10px; min-width: 0; }
.point-select-option-label > span { overflow-wrap: anywhere; }
.point-select.is-compact { width: var(--select-width); flex: none; transition: width 340ms cubic-bezier(.22, 1, .36, 1); }
.point-select.is-compact .point-select-trigger {
  width: var(--select-width);
  max-width: 100%;
  height: 48px;
  padding: 0 14px;
  gap: 0;
  overflow: hidden;
  color: var(--select-accent, inherit);
  transition: width 340ms cubic-bezier(.22, 1, .36, 1), background 180ms ease;
}
.point-select-category-icon { flex: none; }
.point-select.is-compact .point-select-label {
  flex: none;
  width: 0;
  margin-left: 0;
  opacity: 0;
  white-space: nowrap;
  text-overflow: clip;
  transition: width 340ms cubic-bezier(.22, 1, .36, 1), margin-left 340ms cubic-bezier(.22, 1, .36, 1), opacity 180ms ease;
}
.point-select.is-compact.is-open .point-select-label { width: var(--select-label-width); margin-left: 8px; opacity: 1; }
.point-select.is-compact .point-select-chevron { width: 0; opacity: 0; margin-left: 0; transition: width 340ms ease, margin-left 340ms ease, opacity 180ms ease; }
.point-select.is-compact.is-open .point-select-chevron { width: 16px; margin-left: 8px; opacity: .7; }
.point-select-measure { position: absolute; visibility: hidden; pointer-events: none; width: max-content; white-space: nowrap; font-size: var(--point-body-size, 16px); font-weight: 300; }
.point-select.is-compact .point-select-popover { min-width: max(100%, 220px); }
.point-select.is-compact .point-select-menu button[aria-selected='true'] { background: color-mix(in srgb, var(--select-accent, #57877a) 10%, transparent); }
.point-select.is-multiple .point-select-menu { max-height: 220px; }
.point-select.is-fitted .point-select-trigger { height: auto; min-height: 42px; }
.point-select.is-fitted .point-select-label { font-size: var(--select-fit-size, 14px); line-height: 1.45; white-space: normal; overflow: visible; text-overflow: clip; overflow-wrap: anywhere; }
.point-select.is-fitted .point-select-measure { font-size: 14px; }
.point-select-reveal-enter-active, .point-select-reveal-leave-active { transition: opacity 180ms ease, transform 220ms cubic-bezier(.22, 1, .36, 1); transform-origin: top; }
.point-select-reveal-enter-from, .point-select-reveal-leave-to { opacity: 0; transform: translateY(-4px) scale(.98); }
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
