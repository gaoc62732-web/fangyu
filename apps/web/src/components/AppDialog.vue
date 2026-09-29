<script setup lang="ts">
import { onMounted, onUnmounted, ref, useId } from 'vue';
defineProps<{ title: string }>();
const emit = defineEmits<{ close: [] }>();
const titleId = useId();
const panel = ref<HTMLDialogElement>();
let previous: HTMLElement | null = null;
onMounted(() => {
  previous = document.activeElement as HTMLElement;
  panel.value?.showModal();
});
onUnmounted(() => previous?.focus());
</script>
<template>
  <Teleport to="body"
    ><dialog
      ref="panel"
      class="app-dialog"
      :aria-labelledby="titleId"
      @cancel.prevent="emit('close')"
      @click="
        (e) => {
          if (e.target === panel) emit('close');
        }
      "
    >
      <header class="dialog-heading">
        <h2 :id="titleId">{{ title }}</h2>
        <button
          aria-label="关闭对话框"
          @click="emit('close')"
        >
          ×
        </button>
      </header>
      <div class="dialog-content"><slot /></div></dialog
  ></Teleport>
</template>
