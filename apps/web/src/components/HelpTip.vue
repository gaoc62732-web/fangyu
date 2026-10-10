<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';

defineProps<{ text: string }>();
const id = useId();
const button = ref<HTMLButtonElement>();
const tooltip = ref<HTMLElement>();
const open = ref(false);
const pinned = ref(false);
const tooltipStyle = ref<Record<string, string>>({});
let hideTimer: ReturnType<typeof setTimeout> | undefined;

function clearHideTimer() {
  if (hideTimer !== undefined) {
    clearTimeout(hideTimer);
    hideTimer = undefined;
  }
}

function scheduleHide() {
  clearHideTimer();
  if (!pinned.value) hideTimer = setTimeout(() => (open.value = false), 120);
}

function show() {
  clearHideTimer();
  open.value = true;
}

function toggle() {
  pinned.value = !pinned.value;
  open.value = pinned.value;
}

function close() {
  clearHideTimer();
  pinned.value = false;
  open.value = false;
}

function updatePosition() {
  const trigger = button.value;
  const popup = tooltip.value;
  if (!trigger || !popup) return;
  const triggerRect = trigger.getBoundingClientRect();
  const popupRect = popup.getBoundingClientRect();
  const margin = 12;
  const left = Math.min(
    Math.max(margin, triggerRect.left + triggerRect.width / 2 - popupRect.width / 2),
    Math.max(margin, window.innerWidth - popupRect.width - margin),
  );
  const above = triggerRect.top - popupRect.height - 8 >= margin;
  tooltipStyle.value = {
    left: `${left}px`,
    top: `${above ? triggerRect.top - 8 : triggerRect.bottom + 8}px`,
    transform: above ? 'translateY(-100%)' : 'none',
  };
}

watch(open, async (visible) => {
  if (!visible) {
    window.removeEventListener('resize', updatePosition);
    window.removeEventListener('scroll', updatePosition, true);
    return;
  }
  await nextTick();
  updatePosition();
  window.addEventListener('resize', updatePosition);
  window.addEventListener('scroll', updatePosition, true);
});

onBeforeUnmount(() => {
  clearHideTimer();
  window.removeEventListener('resize', updatePosition);
  window.removeEventListener('scroll', updatePosition, true);
});
</script>

<template>
  <span
    class="help-tip"
    @mouseenter="show"
    @mouseleave="scheduleHide"
    @focusin="show"
    @focusout="scheduleHide"
    @keydown.esc.stop="close"
  >
    <button
      ref="button"
      type="button"
      class="help-tip-button"
      aria-label="帮助说明"
      :aria-describedby="open ? id : undefined"
      @click="toggle"
    >
      <span aria-hidden="true">?</span>
    </button>
    <Teleport to="body">
      <span
        v-if="open"
        :id="id"
        ref="tooltip"
        class="help-tip-content"
        role="tooltip"
        :style="tooltipStyle"
        @mouseenter="clearHideTimer"
        @mouseleave="scheduleHide"
      >{{ text }}</span>
    </Teleport>
  </span>
</template>

<style scoped>
.help-tip {
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
}
.help-tip-button {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 1px solid currentColor;
  border-radius: 50%;
  color: var(--atlas-ink);
  background: transparent;
  cursor: help;
  opacity: 0.65;
  font: 400 12px/1 var(--atlas-font);
}
.help-tip-button:hover,
.help-tip-button:focus-visible {
  opacity: 1;
  background: var(--atlas-soft);
}
.help-tip-content {
  position: fixed;
  z-index: 200;
  width: min(232px, calc(100vw - 48px));
  box-sizing: border-box;
  padding: 9px 11px;
  border: 1px solid var(--atlas-line);
  border-radius: 7px;
  color: var(--atlas-ink);
  background: var(--atlas-paper);
  box-shadow: 0 5px 18px rgb(20 28 22 / 12%);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.6;
  pointer-events: none;
}
</style>
