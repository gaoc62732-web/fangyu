<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { PALETTES, tonalColors, DEFAULT_POINT_POLICIES } from '@fangyu/domain';
import { VISIT_LABELS, type PointCheckinPreferences, type PointLinkPolicy } from '@fangyu/contracts';
import { useAppStore } from '../app/store.js';
import HelpTip from './HelpTip.vue';
import {
  basemapCanEnable,
  basemapEnabled,
  basemapKind,
  setBasemapEnabled,
  setBasemapKind,
} from '../features/maps/basemap-settings.js';
import type { BasemapKind } from '../features/maps/types.js';

const store = useAppStore();
const preferences = computed(() => {
  void store.revision;
  return store.session!.preferences;
});
const baseColors = computed(() =>
  preferences.value.palette === 'custom'
    ? { ...PALETTES.jade.colors, ...preferences.value.customColors }
    : PALETTES[preferences.value.palette].colors,
);
const baseColor = ref(baseColors.value.shortstay);
const customColorsEnabled = ref(preferences.value.palette === 'custom');
watch(() => baseColors.value.shortstay, (color) => {
  baseColor.value = color;
});
const colorOptions = computed(() =>
  Object.entries(VISIT_LABELS).map(([state, label]) => ({
    state: state as keyof typeof VISIT_LABELS,
    label,
  })),
);
type PointSetting = {
  key: keyof PointCheckinPreferences;
  label: string;
  help: string;
  options: ReadonlyArray<{ value: PointLinkPolicy; label: string }>;
};

const pointSettings: PointSetting[] = [
  {
    key: 'children',
    label: '组成地点',
    help: '项目包含多个可单独记录的组成地点时，决定是否同步点亮。比如，世界文化遗产大运河包含八十多个子项目，则选择自动点亮时会将所有子项目点亮。',
    options: [
      { value: 'ask', label: '每次选择要点亮的组成地点' },
      { value: 'auto', label: '自动点亮全部组成地点' },
    ],
  },
  {
    key: 'identities',
    label: '多个类别',
    help: '同一项目属于多个类别时，决定是否同步点亮其他类别中的该项目。比如，良渚古城遗址同属“世界文化遗产”和“全国重点文物保护单位”类别，则可手动选择仅点亮其中一个类别或者自动点亮所有类别。',
    options: [
      { value: 'ask', label: '每次选择要联动的类别' },
      { value: 'auto', label: '自动点亮所有类别' },
      { value: 'never', label: '始终不联动其他类别' },
    ],
  },
  {
    key: 'regions',
    label: '所在行政区划',
    help: '自动点亮会将所在行政区直接标记为“已到访”。当项目地跨多个行政区时，建议手动选择要点亮的行政区。',
    options: [
      { value: 'ask', label: '每次设置所在行政区的点亮状态' },
      { value: 'auto', label: '自动点亮所在行政区' },
      { value: 'never', label: '始终不联动行政区' },
    ],
  },
];

function changePalette(event: Event) {
  const palette = (event.target as HTMLSelectElement).value as keyof typeof PALETTES;
  baseColor.value = PALETTES[palette].colors.shortstay;
  customColorsEnabled.value = false;
  store.commit((session) => session.updatePreferences({ palette }));
}

function toggleCustomColors(event: Event) {
  customColorsEnabled.value = (event.target as HTMLInputElement).checked;
}

function visitColors(colors: Record<string, string>) {
  return Object.fromEntries(Object.entries(colors).filter(([state]) => state in VISIT_LABELS));
}

function changePointPolicy(key: keyof PointCheckinPreferences, event: Event) {
  const value = (event.target as HTMLSelectElement).value as PointLinkPolicy;
  store.commit((session) =>
    session.updatePreferences({
      pointCheckin: {
        ...DEFAULT_POINT_POLICIES,
        ...session.preferences.pointCheckin,
        [key]: value,
      },
    }),
  );
}

function pointPolicy(key: keyof PointCheckinPreferences) {
  return preferences.value.pointCheckin?.[key] ?? DEFAULT_POINT_POLICIES[key];
}

function changeRegionStatePolicy(event: Event) {
  const value = (event.target as HTMLSelectElement).value as PointLinkPolicy;
  store.commit((session) => session.updatePreferences({ regionStateLink: value }));
}

function changeBasemapKind(event: Event) {
  setBasemapKind((event.target as HTMLSelectElement).value as BasemapKind);
}

function changeBasemapEnabled(event: Event) {
  setBasemapEnabled((event.target as HTMLInputElement).checked);
}

function generatePalette() {
  if (!customColorsEnabled.value) return;
  store.commit((session) =>
    session.updatePreferences({
      palette: 'custom',
      customColors: visitColors(tonalColors(baseColor.value)),
    }),
  );
}

function editColor(state: string, event: Event) {
  if (!customColorsEnabled.value || !(state in VISIT_LABELS)) return;
  const value = (event.target as HTMLInputElement).value;
  store.commit((session) =>
    session.updatePreferences({
      palette: 'custom',
      customColors: visitColors({ ...baseColors.value, [state]: value }),
    }),
  );
  if (state === 'shortstay') baseColor.value = value;
}
</script>

<template>
  <div class="global-settings-panel">
    <section class="global-settings-group">
      <h3>界面外观</h3>
      <label class="global-settings-field palette-field">
        <span>配色方案</span>
        <select
          :value="preferences.palette"
          aria-label="配色方案"
          @change="changePalette"
        >
          <option
            v-for="(palette, id) in PALETTES"
            :key="id"
            :value="id"
          >
            {{ palette.name }}
          </option>
          <option
            v-if="preferences.palette === 'custom'"
            value="custom"
            disabled
          >
            自定义
          </option>
        </select>
      </label>
      <div class="global-settings-colors">
        <div class="global-settings-color-strip" aria-label="各到访状态颜色">
          <div
            v-for="option in colorOptions"
            :key="option.state"
            class="global-settings-color-swatch"
          >
            <input
              type="color"
              :value="baseColors[option.state]"
              :aria-label="option.label + '颜色'"
              :disabled="!customColorsEnabled"
              @change="editColor(option.state, $event)"
            />
            <i :style="{ background: baseColors[option.state] }" />
            <span>{{ option.label }}</span>
          </div>
        </div>
        <div class="global-settings-color-generator">
          <div class="global-settings-color-label">
            <span>自定义状态色</span>
            <input
              :checked="customColorsEnabled"
              type="checkbox"
              aria-label="启用自定义状态色"
              @change="toggleCustomColors"
            />
            <HelpTip text="点击生成按钮，可根据右侧颜色自动生成配色" />
          </div>
          <div class="global-settings-color-actions">
            <div
              class="global-settings-primary-color"
              :class="{ disabled: !customColorsEnabled }"
              :style="{ '--swatch-color': baseColor }"
            >
              <span />
              <input
                type="color"
                :value="baseColor"
                aria-label="自定义状态色主颜色"
                :disabled="!customColorsEnabled"
                @input="baseColor = ($event.target as HTMLInputElement).value"
              />
            </div>
            <button
              type="button"
              :disabled="!customColorsEnabled"
              @click="generatePalette"
            >
              生成
            </button>
          </div>
        </div>
      </div>
      <div class="global-settings-dotted-divider" />
      <div class="global-settings-field dark-mode-field">
        <span>深色界面</span>
        <input
          :checked="store.dark"
          type="checkbox"
          aria-label="深色界面"
          @change="store.setDark(($event.target as HTMLInputElement).checked)"
        />
      </div>
    </section>

    <section class="global-settings-group">
      <h3>地图底图</h3>
      <label class="global-settings-field">
        <span>启用底图</span>
        <input
          :checked="basemapEnabled"
          type="checkbox"
          aria-label="启用底图"
          @change="changeBasemapEnabled"
        />
      </label>
      <label class="global-settings-field">
        <span class="global-settings-field-label">
          <span>底图设置</span>
          <HelpTip text="天地图及天地图卫星图加载较慢，请谨慎选用" />
        </span>
        <select
          :value="basemapKind"
          aria-label="底图设置"
          :disabled="!basemapEnabled"
          @change="changeBasemapKind"
        >
          <option value="vector">OpenStreetMap</option>
          <option value="tianditu" :disabled="!basemapCanEnable && basemapKind !== 'tianditu'">
            天地图
          </option>
          <option value="satellite" :disabled="!basemapCanEnable && basemapKind !== 'satellite'">
            天地图卫星图
          </option>
        </select>
      </label>
    </section>

    <section class="global-settings-group">
      <h3>点卯记录关联</h3>
      <div class="global-settings-policy-fields">
        <div
          v-for="setting in pointSettings"
          :key="setting.key"
          class="global-settings-policy-field"
        >
          <div class="global-settings-policy-label">
            <span>{{ setting.label }}</span>
            <HelpTip :text="setting.help" />
          </div>
          <select
            :aria-label="setting.label"
            :value="pointPolicy(setting.key)"
            @change="changePointPolicy(setting.key, $event)"
          >
            <option
              v-for="option in setting.options"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </div>
        <div class="global-settings-policy-field">
          <div class="global-settings-policy-label">
            <span>行政区状态</span>
            <HelpTip text="上级行政区与下属地区状态不一致时，决定是否同步更新下属地区。" />
          </div>
          <select
            aria-label="行政区状态"
            :value="preferences.regionStateLink || 'ask'"
            @change="changeRegionStatePolicy"
          >
            <option value="ask">每次询问是否同步下辖地区</option>
            <option value="auto">自动同步下辖地区</option>
            <option value="never">始终只更新当前行政区</option>
          </select>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.global-settings-panel {
  display: grid;
  gap: 0;
  color: var(--atlas-ink);
  font-size: 13px;
}
.global-settings-group {
  display: grid;
  gap: 8px;
  padding: 14px 0 16px;
  border-bottom: 1px solid var(--atlas-line);
}
.global-settings-group:first-child {
  padding-top: 12px;
}
.global-settings-group:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}
.global-settings-group h3 {
  margin: 0 0 3px;
  color: var(--atlas-ink);
  font-size: 14px;
  letter-spacing: 0.04em;
  opacity: 0.68;
  font-weight: 400;
}
.global-settings-field,
.global-settings-policy-field,
.global-settings-color-generator {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 30px;
}
.global-settings-field select,
.global-settings-policy-field select {
  width: 170px;
  min-width: 0;
  height: 30px;
  padding: 3px 8px;
  font-size: 13px;
}
.global-settings-field input[type='checkbox'] {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--atlas-accent);
}
.global-settings-field-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.global-settings-colors {
  display: grid;
  gap: 10px;
}
.global-settings-color-strip {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 0;
}
.global-settings-color-swatch {
  position: relative;
  display: grid;
  grid-template-rows: 28px auto;
  gap: 4px;
  min-width: 0;
  text-align: center;
}
.global-settings-color-swatch input[type='color'] {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 28px;
  padding: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.global-settings-color-swatch input[type='color']:disabled {
  cursor: default;
}
.global-settings-color-swatch i {
  display: block;
  grid-row: 1;
  width: 100%;
  height: 28px;
  border: 1px solid var(--atlas-line);
  border-left: 0;
  pointer-events: none;
}
.global-settings-color-swatch:first-child i {
  border-left: 1px solid var(--atlas-line);
  border-radius: 4px 0 0 4px;
}
.global-settings-color-swatch:last-child i {
  border-radius: 0 4px 4px 0;
}
.global-settings-color-swatch span {
  grid-row: 2;
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.global-settings-color-generator {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 30px;
}
.global-settings-color-label,
.global-settings-color-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.global-settings-color-label {
  min-width: 0;
}
.global-settings-color-label input[type='checkbox'] {
  width: 15px;
  height: 15px;
  margin: 0;
  accent-color: var(--atlas-accent);
}
.global-settings-primary-color {
  position: relative;
  display: grid;
  place-items: center;
  width: 36px;
  height: 26px;
  border: 1px solid var(--atlas-line);
  border-radius: 4px;
  background: var(--atlas-paper);
  cursor: pointer;
}
.global-settings-primary-color span {
  display: block;
  width: 22px;
  height: 9px;
  background: var(--swatch-color);
  pointer-events: none;
}
.global-settings-primary-color input[type='color'] {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.global-settings-primary-color.disabled {
  cursor: default;
}
.global-settings-primary-color input[type='color']:disabled {
  cursor: default;
}
.global-settings-color-swatch:has(input:focus-visible) i,
.global-settings-primary-color:has(input:focus-visible) {
  outline: 2px solid var(--atlas-accent);
  outline-offset: 2px;
}
.global-settings-color-generator button {
  height: 26px;
  padding: 3px 10px;
  border: 1px solid var(--atlas-line);
  border-radius: 6px;
  color: var(--atlas-ink);
  background: transparent;
  font-size: 13px;
  cursor: pointer;
}
.global-settings-color-generator button:disabled {
  opacity: 0.45;
  cursor: default;
}
.global-settings-color-generator button:hover:not(:disabled) {
  background: var(--atlas-soft);
}
.global-settings-dotted-divider {
  border-top: 1px dashed color-mix(in srgb, var(--atlas-line) 72%, transparent);
  margin: 1px 0 2px;
}
.dark-mode-field {
  min-height: 25px;
}
.global-settings-policy-fields {
  display: grid;
  gap: 6px;
}
.global-settings-policy-field {
  gap: 12px;
  min-height: 25px;
}
.global-settings-policy-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  white-space: nowrap;
}
.global-settings-policy-field select {
  flex: 0 1 228px;
  width: 228px;
  white-space: nowrap;
}
.global-settings-policy-field option {
  white-space: nowrap;
}
.global-settings-note {
  margin: 0;
  color: var(--atlas-ink);
  opacity: 0.72;
  font-size: 12px;
  line-height: 1.5;
}
@media (max-width: 430px) {
  .global-settings-policy-field {
    align-items: stretch;
    flex-direction: column;
    gap: 4px;
  }
  .global-settings-policy-field select {
    flex-basis: auto;
    width: 100%;
  }
}
</style>
