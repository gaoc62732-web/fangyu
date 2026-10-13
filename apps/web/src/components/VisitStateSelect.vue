<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { VISIT_LABELS, VISIT_RANK, VISIT_STATES, type VisitState } from '@fangyu/contracts';
import { useAppStore } from '../app/store.js';
import PointIcon from './PointIcon.vue';

const props = withDefaults(defineProps<{ regionId: string; propagate?: boolean }>(), {
  propagate: true,
});
const store = useAppStore();
const pending = ref<{ state: VisitState; children: string[]; highest: VisitState }>();
const dragValue = ref<number>();
const dragging = ref(false);
const pointerActive = ref(false);
const pointerMode = ref<'click' | 'drag' | 'none'>('none');
let pointerStartX = 0;
const states = VISIT_STATES.map((state) => ({ state, label: VISIT_LABELS[state] }));
const recorded = computed(() => {
  void store.revision;
  return store.session!.recordedVisitState(props.regionId);
});
const sliderValue = computed(() => dragValue.value ?? VISIT_RANK[recorded.value]);
const sliderState = computed(() => VISIT_STATES[Math.round(sliderValue.value)] || recorded.value);
const markerPosition = computed(
  () => `${((sliderValue.value + 0.5) / states.length) * 100}%`,
);
const colors = computed(() => store.colors);
const markerColor = computed(() => colors.value[sliderState.value] || colors.value.unvisited);

watch(recorded, () => {
  if (!dragging.value) dragValue.value = undefined;
});

function descendants(id: string) {
  const result: string[] = [];
  const visit = (current: string) => {
    for (const child of store.session!.index.children.get(current) || []) {
      result.push(child.id);
      visit(child.id);
    }
  };
  visit(id);
  return result;
}

function applyState(state: VisitState, childIds: string[] = []) {
  store.commit((session) => {
    session.setRegionState(props.regionId, state, props.propagate);
    for (const id of childIds) session.setRegionState(id, state, false);
  });
  pending.value = undefined;
}

function chooseState(state: VisitState) {
  const region = store.session!.index.regions.get(props.regionId);
  const childIds =
    region?.scope === 'china' && (region.level === 0 || region.level === 1)
      ? descendants(props.regionId)
      : [];
  const highest = childIds.reduce<VisitState>(
    (best, id) =>
      VISIT_RANK[store.session!.visitState(id)] > VISIT_RANK[best]
        ? store.session!.visitState(id)
        : best,
    'unvisited',
  );
  const policy = store.session!.preferences.regionStateLink || 'ask';
  if (childIds.length && VISIT_RANK[state] !== VISIT_RANK[highest] && policy === 'ask') {
    pending.value = { state, children: childIds, highest };
  } else if (childIds.length && policy === 'auto') {
    applyState(state, childIds);
  } else {
    applyState(state);
  }
}

function startPointer(event: PointerEvent) {
  pointerActive.value = true;
  pointerMode.value = 'click';
  pointerStartX = event.clientX;
  (event.currentTarget as HTMLInputElement).setPointerCapture(event.pointerId);
}

function preview(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  if (pointerMode.value === 'drag') dragValue.value = value;
}

function movePointer(event: PointerEvent) {
  if (!pointerActive.value || pointerMode.value === 'drag') return;
  if (Math.abs(event.clientX - pointerStartX) < 4) return;
  pointerMode.value = 'drag';
  dragging.value = true;
  dragValue.value = Number((event.currentTarget as HTMLInputElement).value);
}

function commitPointer(event: PointerEvent) {
  const input = event.currentTarget as HTMLInputElement;
  if (input.hasPointerCapture(event.pointerId)) input.releasePointerCapture(event.pointerId);
  pointerActive.value = false;
  dragging.value = false;
}

function commitChange(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  const state = VISIT_STATES[Math.round(value)];
  const mode = pointerMode.value;
  pointerMode.value = 'none';
  if (!state) return;
  dragValue.value = VISIT_RANK[state];
  chooseState(state);
  if (mode === 'drag') dragging.value = false;
}

function cancelPointer(event?: PointerEvent) {
  if (event && (event.currentTarget as HTMLInputElement).hasPointerCapture(event.pointerId)) {
    (event.currentTarget as HTMLInputElement).releasePointerCapture(event.pointerId);
  }
  pointerActive.value = false;
  pointerMode.value = 'none';
  dragging.value = false;
  dragValue.value = undefined;
}

function blurSlider() {
  if (pointerActive.value) cancelPointer();
}

function rememberPolicy(policy: 'auto' | 'never') {
  const state = pending.value!.state;
  const children = pending.value!.children;
  store.commit((session) => session.updatePreferences({ regionStateLink: policy }));
  applyState(state, policy === 'auto' ? children : []);
}
</script>

<template>
  <div class="state-select">
    <div
      class="state-strip-shell"
      :class="{ 'is-dragging': dragging }"
    >
      <div class="state-strip-track" aria-hidden="true">
        <span
          v-for="option in states"
          :key="option.state"
          class="state-strip-segment"
          :class="{ 'is-current': option.state === sliderState }"
          :style="{ background: colors[option.state] }"
        />
      </div>
      <span
        class="state-strip-marker"
        aria-hidden="true"
        :style="{ left: markerPosition, color: markerColor }"
      >
        <PointIcon
          name="location"
          :size="20"
        />
      </span>
      <input
        class="state-strip-input"
        type="range"
        min="0"
        :max="states.length - 1"
        step="0.01"
        :value="sliderValue"
        :aria-label="`旅行状态：${VISIT_LABELS[sliderState]}`"
        :aria-valuetext="VISIT_LABELS[sliderState]"
        @pointerdown="startPointer"
        @pointermove="movePointer"
        @input="preview"
        @pointerup="commitPointer"
        @change="commitChange"
        @pointercancel="cancelPointer"
        @blur="blurSlider"
      />
    </div>
    <div class="state-strip-labels" aria-hidden="true">
      <span v-for="option in states" :key="option.state">{{ option.label }}</span>
    </div>

    <div
      v-if="pending"
      class="state-link-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="state-link-dialog-title"
    >
      <div class="state-link-dialog-card">
        <h2 id="state-link-dialog-title">同步下辖地区？</h2>
        <p>
          当前下辖地区最高状态为“{{ VISIT_LABELS[pending.highest] }}”，是否将下辖地区一并改为“{{
            VISIT_LABELS[pending.state]
          }}”？
        </p>
        <div class="state-link-dialog-actions">
          <button type="button" @click="applyState(pending.state)">仅更新本级</button>
          <button type="button" class="primary" @click="applyState(pending.state, pending.children)">
            同步下辖地区
          </button>
          <button type="button" @click="rememberPolicy('never')">不再提示</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.state-select {
  display: grid;
  gap: 4px;
  width: 100%;
  font-size: 13px;
}
.state-strip-shell {
  position: relative;
  height: 34px;
  padding-top: 19px;
  touch-action: none;
}
.state-strip-track {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  height: 10px;
  overflow: hidden;
  border: 1px solid var(--atlas-line);
  border-radius: 5px;
  box-shadow:
    inset 0 1px rgb(255 255 255 / 38%),
    inset 0 -2px rgb(20 26 24 / 16%),
    0 1px 2px rgb(20 26 24 / 10%);
}
.state-strip-segment {
  box-shadow: inset 0 1px rgb(255 255 255 / 18%), inset 0 -1px rgb(20 26 24 / 12%);
  transition: filter 120ms ease-out;
}
.state-strip-segment.is-current {
  filter: saturate(1.12) brightness(1.04);
}
.state-strip-segment + .state-strip-segment {
  border-left: 1px solid color-mix(in srgb, var(--atlas-paper) 60%, transparent);
}
.state-strip-marker {
  position: absolute;
  top: 5px;
  z-index: 2;
  display: grid;
  place-items: start center;
  width: 20px;
  height: 20px;
  transform: translateX(-50%);
  color: var(--atlas-ink);
  pointer-events: none;
  filter:
    drop-shadow(0 0 0.8px rgb(20 26 24 / 76%))
    drop-shadow(0 0 1.65px var(--atlas-paper))
    drop-shadow(0 1px 1.5px rgb(20 26 24 / 18%));
  transform-origin: 50% 100%;
  transition:
    left 120ms ease-out,
    color 120ms ease-out,
    transform 120ms ease-out,
    filter 120ms ease-out;
}
.state-strip-shell.is-dragging .state-strip-marker {
  transition:
    left 0s,
    color 120ms ease-out,
    transform 120ms ease-out,
    filter 120ms ease-out;
}
.state-strip-input {
  position: absolute;
  inset: 0;
  z-index: 3;
  width: 100%;
  height: 34px;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.state-strip-input:active,
.state-strip-shell.is-dragging .state-strip-input {
  cursor: grabbing;
}
.state-strip-shell:hover .state-strip-marker,
.state-strip-shell.is-dragging .state-strip-marker {
  transform: translateX(-50%) scale(1.06);
  filter:
    drop-shadow(0 0 1px rgb(20 26 24 / 82%))
    drop-shadow(0 0 1.9px var(--atlas-paper))
    drop-shadow(0 2px 3px rgb(20 26 24 / 26%));
}
.state-strip-shell:hover .state-strip-track,
.state-strip-shell.is-dragging .state-strip-track {
  box-shadow:
    inset 0 1px rgb(255 255 255 / 42%),
    inset 0 -2px rgb(20 26 24 / 19%),
    0 0 0 2px color-mix(in srgb, var(--atlas-accent) 18%, transparent),
    0 2px 5px rgb(20 26 24 / 16%);
}
.state-strip-shell:has(.state-strip-input:focus-visible) {
  outline: 2px solid var(--atlas-accent);
  outline-offset: 4px;
}
.state-strip-labels {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  color: var(--atlas-ink);
  font-size: 12px;
  line-height: 1.35;
  text-align: center;
  user-select: none;
}
.effective-visit-state {
  color: var(--atlas-ink);
  opacity: 0.68;
  font-size: 12px;
}
.state-link-dialog {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(20 26 24 / 24%);
}
.state-link-dialog-card {
  width: min(360px, 100%);
  padding: 22px;
  border: 1px solid var(--atlas-line);
  border-radius: 8px;
  background: var(--atlas-paper);
  box-shadow: 0 18px 50px rgb(20 26 24 / 18%);
}
.state-link-dialog-card h2 {
  margin: 0 0 10px;
  font-size: 18px;
  font-weight: 400;
}
.state-link-dialog-card p {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
}
.state-link-dialog-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 18px;
}
.state-link-dialog-actions button {
  min-height: 30px;
  padding: 4px 9px;
  border: 1px solid var(--atlas-line);
  border-radius: 5px;
  color: var(--atlas-ink);
  background: transparent;
  font-size: 12px;
  cursor: pointer;
}
.state-link-dialog-actions button.primary {
  border-color: var(--atlas-accent);
  color: var(--atlas-paper);
  background: var(--atlas-accent);
}
</style>
