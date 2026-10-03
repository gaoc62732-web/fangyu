<script setup lang="ts">
import { computed, ref } from 'vue';
import { PALETTES, tonalColors } from '@fangyu/domain';
import { VISIT_LABELS, type ArchiveDocument } from '@fangyu/contracts';
import { useAppStore } from '../app/store.js';
import { exportJson } from '../features/exports/download.js';

const store = useAppStore();
const archiveName = ref('');
const baseColor = ref('#438d6a');
const message = ref('');
const clearConfirmed = ref(false);
const preferences = computed(() => {
  void store.revision;
  return store.session!.preferences;
});

async function operation(action: () => Promise<unknown>) {
  try {
    await action();
    message.value = '操作完成';
  } catch (cause) {
    message.value = String(cause);
  }
}

function changePalette(event: Event) {
  const palette = (event.target as HTMLSelectElement).value as keyof typeof PALETTES;
  store.commit((session) => session.updatePreferences({ palette }));
}

function generatePalette() {
  store.commit((session) =>
    session.updatePreferences({ palette: 'custom', customColors: tonalColors(baseColor.value) }),
  );
}

function editColor(state: string, event: Event) {
  const value = (event.target as HTMLInputElement).value;
  const baseColors =
    preferences.value.palette === 'custom'
      ? { ...PALETTES.jade.colors, ...preferences.value.customColors }
      : PALETTES[preferences.value.palette].colors;
  store.commit((session) =>
    session.updatePreferences({
      palette: 'custom',
      customColors: { ...baseColors, [state]: value },
    }),
  );
}

async function saveArchive() {
  await operation(() => store.saveArchive(archiveName.value));
  archiveName.value = '';
}

async function rename(archive: ArchiveDocument, event: Event) {
  const name = (event.target as HTMLInputElement).value.trim();
  if (name) await operation(() => store.renameArchive(archive, name));
}

async function clear() {
  if (!clearConfirmed.value) return;
  await operation(async () => {
    const before = store.session!.revision;
    await store.saveArchive('清空前自动备份');
    if (store.session!.revision !== before) throw Error('备份期间记录已变化，请重新清空。');
    if (!store.commit((session) => session.clearVisits())) throw Error(store.error);
    clearConfirmed.value = false;
  });
}
</script>

<template>
  <section class="page-heading">
    <h2>存档与外观</h2>
    <p>存档独立保存当前记录，恢复与清空前会自动备份。</p>
  </section>
  <p role="status">{{ message }}</p>
  <section class="card">
    <h3>命名存档</h3>
    <form
      class="toolbar"
      @submit.prevent="saveArchive"
    >
      <input
        v-model="archiveName"
        maxlength="200"
        placeholder="存档名称"
        aria-label="存档名称"
      />
      <button type="submit">保存当前记录</button>
    </form>
    <article
      v-for="archive in store.archives"
      :key="archive.id"
      class="archive-row"
    >
      <input
        :value="archive.name"
        maxlength="200"
        aria-label="重命名存档"
        @change="rename(archive, $event)"
      />
      <small>{{ new Date(archive.createdAt).toLocaleString() }}</small>
      <button @click="operation(() => store.restore(archive.snapshot))">恢复</button>
      <button @click="exportJson(archive.snapshot, archive.name + '.json')">下载</button>
      <button @click="operation(() => store.deleteArchive(archive.id))">删除</button>
    </article>
    <p
      v-if="!store.archives.length"
      class="note"
    >
      尚无存档。
    </p>
  </section>
  <section class="card">
    <h3>地图配色</h3>
    <div class="toolbar">
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
      <input
        v-model="baseColor"
        type="color"
        aria-label="地图主色"
      />
      <button @click="generatePalette">按主色生成六级</button>
      <label
        ><input
          :checked="store.dark"
          type="checkbox"
          @change="store.setDark(($event.target as HTMLInputElement).checked)"
        />深色界面</label
      >
    </div>
    <div class="toolbar">
      <label
        v-for="(label, state) in { ...VISIT_LABELS, unmapped: '无对应边界' }"
        :key="state"
      >
        <input
          type="color"
          :value="store.colors[state]"
          :aria-label="label"
          @change="editColor(state, $event)"
        />
        {{ label }}
      </label>
    </div>
  </section>
  <section class="card">
    <h3>清空到访</h3>
    <p>清空政区和项目到访状态，保留个人项目、名称和备注。可撤销或从备份恢复。</p>
    <label
      ><input
        v-model="clearConfirmed"
        type="checkbox"
      />确认清空全部到访状态</label
    >
    <button
      :disabled="!clearConfirmed"
      @click="clear"
    >
      备份并清空
    </button>
  </section>
</template>
