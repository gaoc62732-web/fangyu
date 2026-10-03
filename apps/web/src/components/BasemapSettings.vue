<script setup lang="ts">
import { ref } from 'vue';
import {
  applyBasemapKey,
  basemapMode,
  basemapProvider,
  basemapEnabled,
  basemapCanEnable,
  basemapKind,
  clearBasemapKey,
  disableBasemap,
  setBasemapEnabled,
  setBasemapKind,
  testBasemapKey,
  useEnvironmentBasemap,
} from '../features/maps/basemap-settings.js';
import { tianditu, type BasemapKind } from '../features/maps/types.js';
const draft = ref('');
const remember = ref(false);
const message = ref('');
const busy = ref(false);
let testGeneration = 0;
function resetTest() {
  testGeneration++;
  message.value = '';
}
async function test() {
  if (!tianditu(draft.value.trim())) {
    message.value = '请填写有效的天地图浏览器密钥。';
    return;
  }
  const token = ++testGeneration;
  busy.value = true;
  const ok = await testBasemapKey(draft.value);
  if (token === testGeneration)
    message.value = ok ? '连接成功，可以应用。' : '连接未成功，请检查密钥、域名授权和网络后重试。';
  busy.value = false;
}
function apply() {
  if (!tianditu(draft.value.trim())) {
    message.value = '请填写有效的天地图浏览器密钥。';
    return;
  }
  resetTest();
  const saved = applyBasemapKey(draft.value, remember.value);
  draft.value = '';
  message.value = saved
    ? remember.value
      ? '已应用并记住此浏览器。'
      : '已应用，仅当前会话使用。'
    : '已应用，但浏览器存储不可用；刷新后可能需要重新设置。';
}
function clear() {
  resetTest();
  draft.value = '';
  remember.value = false;
  message.value = clearBasemapKey()
    ? '已清除本机输入并禁用在线底图，不会自动使用构建配置。'
    : '本次已禁用，但浏览器存储不可用；下次打开时请再次检查。';
}
function toggle(event: Event) {
  resetTest();
  const enabled = (event.target as HTMLInputElement).checked;
  const saved = setBasemapEnabled(enabled);
  message.value = saved
    ? enabled
      ? '已启用所选在线底图。'
      : '已关闭在线底图；保留已配置密钥，可用开关重新启用。'
    : '设置已更新，但浏览器存储不可用。';
}
function disable() {
  resetTest();
  disableBasemap();
  message.value = '已关闭在线底图；保留已配置密钥，可用开关重新启用。';
}
function changeKind(event: Event) {
  resetTest();
  setBasemapKind((event.target as HTMLSelectElement).value as BasemapKind);
  message.value = basemapProvider.value
    ? '已切换所选底图。'
    : '已选择底图类型，启用在线底图后生效。';
}
function environment() {
  resetTest();
  draft.value = '';
  remember.value = false;
  useEnvironmentBasemap();
  message.value = basemapProvider.value
    ? '已明确切换为构建配置。'
    : '构建配置未提供可用密钥，当前仅显示行政区地图。';
}
</script>
<template>
  <details class="basemap-settings">
    <summary>在线底图设置</summary>
    <p class="note">
      密钥仅在此浏览器用于请求天地图，不进入旅行记录、备份或后端。默认仅当前会话；前端密钥请在天地图控制台限制域名。
    </p>
    <p class="note">
      当前：{{
        basemapMode === 'disabled'
          ? '已禁用'
          : basemapMode === 'custom'
            ? '使用本机设置'
            : basemapProvider
              ? '使用构建配置'
              : '未配置'
      }}。开关关闭会保留已配置密钥；清除密钥会移除浏览器保存并阻止自动恢复构建配置。
    </p>
    <div class="toolbar">
      <label
        ><input
          type="checkbox"
          :checked="basemapEnabled"
          :disabled="!basemapCanEnable"
          @change="toggle"
        />启用天地图在线底图</label
      >
      <label
        >底图类型
        <select
          :value="basemapKind"
          aria-label="底图类型"
          @change="changeKind"
        >
          <option value="vector">政区图</option>
          <option value="satellite">卫星图</option>
        </select></label
      >
    </div>
    <p
      v-if="!basemapCanEnable"
      class="note"
    >
      请先应用密钥，或主动选择使用构建配置，再开启在线底图。
    </p>
    <form @submit.prevent="apply">
      <label
        >天地图浏览器密钥
        <input
          v-model="draft"
          type="password"
          aria-label="天地图浏览器密钥"
          autocomplete="off"
          spellcheck="false"
          placeholder="由你本人填写"
          @input="resetTest"
        />
      </label>
      <label
        ><input
          v-model="remember"
          type="checkbox"
        />记住此浏览器</label
      >
      <div class="toolbar">
        <button
          type="button"
          :disabled="busy"
          @click="test"
        >
          {{ busy ? '正在测试…' : '测试连接' }}
        </button>
        <button type="submit">应用底图设置</button>
        <button
          type="button"
          @click="clear"
        >
          清除密钥
        </button>
        <button
          type="button"
          @click="disable"
        >
          关闭在线底图（保留密钥）
        </button>
        <button
          type="button"
          @click="environment"
        >
          使用构建配置
        </button>
      </div>
    </form>
    <p
      role="status"
      aria-live="polite"
    >
      {{ message }}
    </p>
  </details>
</template>
<style scoped>
.basemap-settings {
  margin: 8px 12px;
  padding: 8px 0;
  border-top: 1px solid #a3b9af55;
}
.basemap-settings summary {
  cursor: pointer;
}
.basemap-settings form {
  display: grid;
  gap: 10px;
}
.basemap-settings input[type='password'] {
  display: block;
  width: min(100%, 450px);
  margin-top: 6px;
  box-sizing: border-box;
}
.basemap-settings .toolbar {
  flex-wrap: wrap;
}
</style>
