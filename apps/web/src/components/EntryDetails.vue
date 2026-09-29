<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from 'vue';
import type { Scope } from '@fangyu/contracts';
import { useAppStore } from '../app/store.js';
const props = defineProps<{ id: string; scope: Scope; contextRegion: string }>();
const emit = defineEmits<{
  back: [];
  region: [id: string];
  locate: [id: string];
  mark: [id: string, value: boolean, region: string, subitem?: string];
}>();
const store = useAppStore();
const heading = ref<HTMLElement>();
let previousFocus: HTMLElement | null = null;
onMounted(() => {
  previousFocus = document.activeElement as HTMLElement;
  heading.value?.focus({ preventScroll: true });
});
onUnmounted(() => {
  void nextTick(() => {
    if (previousFocus?.isConnected && previousFocus.getClientRects().length)
      previousFocus.focus({ preventScroll: true });
  });
});
const entry = computed(() => {
  void store.revision;
  return store.session!.view(store.session!.entry(props.id));
});
const owners = computed(() => store.session!.index.entryRegions(entry.value, props.scope));
const owner = ref('');
const editing = ref(false),
  name = ref(''),
  note = ref('');
const dirty = computed(
  () => editing.value && (name.value !== entry.value.name || note.value !== entry.value.note),
);
watch(
  () => props.id,
  () => {
    editing.value = false;
    owner.value = owners.value.includes(props.contextRegion)
      ? props.contextRegion
      : owners.value.length === 1
        ? owners.value[0]!
        : '';
  },
  { immediate: true },
);
const category = computed(
  () => store.session!.index.catalog.categories.find((c) => c.id === entry.value.categoryId)?.name,
);
const source = computed(() =>
  /^https?:\/\//i.test(entry.value.source || '') ? entry.value.source : '',
);
function canLeave() {
  return !dirty.value || window.confirm('名称或备注尚未保存。放弃本次编辑并离开？');
}
function save() {
  if (store.commit((s) => s.editEntry(entry.value.id, name.value, note.value)))
    editing.value = false;
}
function mark(value: boolean, subitem?: string) {
  if (value && !owner.value && owners.value.length > 1) return;
  emit('mark', entry.value.id, value, owner.value, subitem);
}
function remove() {
  if (
    window.confirm('删除这个个人项目？可以通过撤销恢复。') &&
    store.commit((s) => s.removeCustomEntry(entry.value.id))
  )
    emit('back');
}
defineExpose({ canLeave });
</script>
<template>
  <div class="entry-detail">
    <div class="detail-top">
      <button
        class="text-button"
        @click="canLeave() && emit('back')"
      >
        ← 返回清单</button
      ><span class="eyebrow">{{ category }}</span>
    </div>
    <h2
      ref="heading"
      tabindex="-1"
    >
      {{ entry.name }}
    </h2>
    <label
      v-if="owners.length > 1"
      class="field"
      >本次记录地区<select
        v-model="owner"
        aria-label="本次记录地区"
      >
        <option value="">请选择实际到访地区</option>
        <option
          v-for="id in owners"
          :key="id"
          :value="id"
        >
          {{ store.session!.index.paths.get(id) }}
        </option>
      </select></label
    >
    <label class="visit-toggle"
      ><input
        type="checkbox"
        :checked="entry.checked"
        :indeterminate="entry.partial"
        :disabled="!owner && owners.length > 1 && !entry.checked"
        @change="mark(($event.target as HTMLInputElement).checked)"
      /><span
        >{{ entry.partial ? '已记录部分组成项目' : entry.checked ? '已到访' : '标记到访'
        }}<small>同时按现有规则补记所属政区</small></span
      ></label
    >
    <section class="detail-section">
      <h3>所属地区</h3>
      <button
        v-for="id in owners"
        :key="id"
        class="region-link"
        @click="canLeave() && emit('region', id)"
      >
        {{ store.session!.index.paths.get(id) }} <span>查看手册 ↗</span></button
      ><button
        v-if="entry.coordinates"
        @click="emit('locate', entry.id)"
      >
        ⌖ 定位此项目
      </button>
      <p
        v-else
        class="note"
      >
        尚无精确坐标，可查看所属地区手册。
      </p>
    </section>
    <section
      v-if="entry.subitems.length"
      class="detail-section"
    >
      <h3>
        组成项目 <small>{{ entry.subitems.length }}</small>
      </h3>
      <div class="subitems">
        <label
          v-for="sub in entry.subitems"
          :key="sub.id"
          ><input
            type="checkbox"
            :checked="store.session!.subitemVisited(entry.id, sub.id)"
            :disabled="!owner && owners.length > 1"
            @change="mark(($event.target as HTMLInputElement).checked, sub.id)"
          />{{ sub.name }}</label
        >
      </div>
    </section>
    <section
      v-if="
        entry.description ||
        entry.code ||
        entry.lines?.length ||
        entry.operators?.length ||
        entry.aliases.length
      "
      class="detail-section"
    >
      <h3>地点资料</h3>
      <p v-if="entry.description">{{ entry.description }}</p>
      <dl>
        <template v-if="entry.code"
          ><dt>代码</dt>
          <dd>{{ entry.code }}</dd></template
        ><template v-if="entry.lines?.length"
          ><dt>线路</dt>
          <dd>{{ entry.lines.join(' / ') }}</dd></template
        ><template v-if="entry.operators?.length"
          ><dt>运营</dt>
          <dd>{{ entry.operators.join(' / ') }}</dd></template
        ><template v-if="entry.aliases.length"
          ><dt>别名</dt>
          <dd>{{ entry.aliases.join('、') }}</dd></template
        >
      </dl>
      <a
        v-if="source"
        :href="source"
        target="_blank"
        rel="noopener noreferrer"
        >查阅资料来源 ↗</a
      >
    </section>
    <a
      v-else-if="source"
      :href="source"
      target="_blank"
      rel="noopener noreferrer"
      >查阅资料来源 ↗</a
    >
    <section class="detail-section">
      <div class="section-heading">
        <h3>我的备注</h3>
        <button
          v-if="!editing"
          class="text-button"
          @click="
            editing = true;
            name = entry.name;
            note = entry.note;
          "
        >
          编辑名称与备注
        </button>
      </div>
      <form
        v-if="editing"
        @submit.prevent="save"
      >
        <label class="field"
          >个人名称<input
            v-model="name"
            required
            maxlength="1000" /></label
        ><label class="field"
          >备注<textarea
            v-model="note"
            maxlength="20000"
          />
        </label>
        <div class="toolbar">
          <button
            class="primary"
            type="submit"
          >
            保存</button
          ><button
            type="button"
            @click="editing = false"
          >
            取消
          </button>
        </div>
      </form>
      <p
        v-else
        class="note"
      >
        {{ entry.note || '还没有备注。' }}
      </p>
    </section>
    <button
      v-if="!store.session!.index.entries.has(entry.id)"
      class="danger"
      @click="remove"
    >
      删除个人项目
    </button>
  </div>
</template>
