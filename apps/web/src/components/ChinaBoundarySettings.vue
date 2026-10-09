<script setup lang="ts">
import { CHINA_BOUNDARY_OPTIONS, type ChinaBoundarySettings } from '@fangyu/contracts';
import { useAppStore } from '../app/store.js';
import PointIcon from './PointIcon.vue';
const store = useAppStore();
function toggle(key: keyof ChinaBoundarySettings, event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  store.commit((session) =>
    session.updatePreferences({
      chinaBoundaries: { ...store.chinaBoundarySettings, [key]: checked },
    }),
  );
}
</script>

<template>
  <details class="china-boundary-settings">
    <summary
      aria-label="地区归属设置"
      title="地区归属设置"
    >
      <PointIcon name="compass" />
    </summary>
    <div class="boundary-settings-body">
      <h4>地区归属</h4>
      <p>分别切换各地区的管理区划与基准归属。</p>
      <label
        v-for="option in CHINA_BOUNDARY_OPTIONS"
        :key="option.key"
      >
        <span
          >{{ option.name
          }}<small>{{
            store.chinaBoundarySettings[option.key]
              ? 'on' in option ? option.on : '独立显示'
              : option.off
          }}</small></span
        >
        <input
          type="checkbox"
          role="switch"
          :aria-label="option.name"
          :checked="store.chinaBoundarySettings[option.key]"
          @change="toggle(option.key, $event)"
        />
      </label>
    </div>
  </details>
</template>

<style scoped>
.china-boundary-settings {
  position: absolute;
  top: 76px;
  right: 24px;
  z-index: 5;
}
summary {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  list-style: none;
  cursor: pointer;
  border: 1px solid var(--atlas-line, #e2e3dd);
  border-radius: 12px;
  background: var(--atlas-paper, #fffefa);
}
summary::-webkit-details-marker {
  display: none;
}
[open] summary {
  background: var(--atlas-soft, #f2f2e9);
}
.boundary-settings-body {
  position: absolute;
  right: 54px;
  top: 0;
  width: min(340px, calc(100vw - 102px));
  max-height: calc(100dvh - 160px);
  overflow: auto;
  padding: 20px;
  border: 1px solid var(--atlas-line, #e2e3dd);
  border-radius: 12px;
  background: var(--atlas-paper, #fffefa);
}
h4 {
  margin: 0 0 12px;
  font-weight: 400;
}
p,
small {
  color: var(--atlas-muted, #68726d);
  font-size: 12px;
}
label {
  display: flex;
  gap: 16px;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-top: 1px solid var(--atlas-line, #e2e3dd);
}
small {
  display: block;
  margin-top: 4px;
}
input {
  accent-color: #416e58;
  width: 18px;
  height: 18px;
  cursor: pointer;
}
</style>
