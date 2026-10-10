<script setup lang="ts">
import { ref } from 'vue';
import type { ArchiveDocument } from '@fangyu/contracts';
import { useAppStore } from '../app/store.js';
import { appMode } from '../app/mode.js';
import { exportJson } from '../features/exports/download.js';

const store = useAppStore();
const mode = appMode();
const archiveName = ref('');
const message = ref('');
const clearConfirmed = ref(false);

async function operation(action: () => Promise<unknown>) {
  try {
    await action();
    message.value = '操作完成';
  } catch (cause) {
    message.value = String(cause);
  }
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
    <h2>设置</h2>
  </section>
  <p
    v-if="message"
    role="status"
  >
    {{ message }}
  </p>
  <section class="card">
    <h3>命名存档</h3>
    <p
      v-if="mode === 'demo'"
      class="note"
    >
      记录仅保存在此浏览器，请定期下载备份。
    </p>
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
