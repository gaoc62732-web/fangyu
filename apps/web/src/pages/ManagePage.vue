<script setup lang="ts">
import { ref } from 'vue';
import ImportsPage from './ImportsPage.vue';
import SettingsPage from './SettingsPage.vue';
const tab = ref('import');
</script>
<template>
  <section class="manage-page">
    <header class="page-heading split-heading">
      <div>
        <h1>记录管理</h1>
      </div>
      <nav
        class="segmented"
        aria-label="记录管理"
      >
        <button
          :aria-pressed="tab === 'import'"
          @click="tab = 'import'"
        >
          导入与导出</button
        ><button
          :aria-pressed="tab === 'archive'"
          @click="tab = 'archive'"
        >
          存档与恢复
        </button>
      </nav>
    </header>
    <KeepAlive><ImportsPage v-if="tab === 'import'" /><SettingsPage v-else /></KeepAlive>
  </section>
</template>
