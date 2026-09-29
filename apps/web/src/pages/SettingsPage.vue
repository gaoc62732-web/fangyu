<script setup lang="ts">
import { computed, ref } from 'vue';
import { PALETTES, tonalColors } from '@fangyu/domain';
import { VISIT_LABELS, type ArchiveDocument } from '@fangyu/contracts';
import { useAppStore } from '../app/store.js';
import { exportJson } from '../features/exports/download.js';
import AppDialog from '../components/AppDialog.vue';
defineProps<{ appearanceOnly?: boolean }>();
const store = useAppStore(),
  archiveName = ref(''),
  baseColor = ref('#438d6a'),
  message = ref(''),
  busy = ref(false),
  renaming = ref(''),
  renameText = ref('');
const action = ref<'restore' | 'delete' | 'clear' | ''>(''),
  selected = ref<ArchiveDocument>();
const preferences = computed(() => {
  void store.revision;
  return store.session!.preferences;
});
const recordCounts = computed(() => {
  void store.revision;
  const s = store.session!.snapshot();
  return { regions: Object.keys(s.regions).length, entries: Object.keys(s.entries).length };
});
async function operation(fn: () => Promise<unknown>) {
  if (busy.value) return;
  busy.value = true;
  message.value = '';
  try {
    await fn();
    message.value = '操作已完成';
    action.value = '';
  } catch (cause) {
    message.value = String(cause);
  } finally {
    busy.value = false;
  }
}
function palette(event: Event) {
  store.commit((s) =>
    s.updatePreferences({
      palette: (event.target as HTMLSelectElement).value as keyof typeof PALETTES,
    }),
  );
}
function color(state: string, event: Event) {
  const base =
    preferences.value.palette === 'custom'
      ? { ...PALETTES.jade.colors, ...preferences.value.customColors }
      : PALETTES[preferences.value.palette].colors;
  store.commit((s) =>
    s.updatePreferences({
      palette: 'custom',
      customColors: { ...base, [state]: (event.target as HTMLInputElement).value },
    }),
  );
}
async function apply() {
  await operation(async () => {
    if (action.value === 'restore' && selected.value) await store.restore(selected.value.snapshot);
    if (action.value === 'delete' && selected.value) await store.deleteArchive(selected.value.id);
    if (action.value === 'clear') {
      const revision = store.session!.revision;
      await store.saveArchive('清空前自动备份');
      if (store.session!.revision !== revision) throw Error('备份期间记录已变化，请重新清空。');
      if (!store.commit((s) => s.clearVisits())) throw Error(store.error);
      await store.flush();
    }
  });
}
</script>
<template>
  <section>
    <p
      v-if="message"
      role="status"
      class="operation-message"
    >
      {{ message }}
    </p>
    <template v-if="appearanceOnly"
      ><header class="page-heading">
        <span class="eyebrow">让手册适合你的目光</span>
        <h1>外观设置</h1>
        <p>界面明暗与地图配色可以分别调整。</p>
      </header>
      <section class="settings-section">
        <h2>界面</h2>
        <div class="segmented">
          <button
            :aria-pressed="!store.dark"
            @click="store.setDark(false)"
          >
            浅色</button
          ><button
            :aria-pressed="store.dark"
            @click="store.setDark(true)"
          >
            深色
          </button>
        </div>
      </section>
      <section class="settings-section">
        <h2>地图配色</h2>
        <div class="toolbar">
          <select
            :value="preferences.palette"
            aria-label="配色方案"
            @change="palette"
          >
            <option
              v-for="(p, id) in PALETTES"
              :key="id"
              :value="id"
            >
              {{ p.name }}
            </option>
            <option
              v-if="preferences.palette === 'custom'"
              value="custom"
            >
              自定义
            </option></select
          ><input
            v-model="baseColor"
            type="color"
            aria-label="地图主色"
          /><button
            @click="
              store.commit((s) =>
                s.updatePreferences({ palette: 'custom', customColors: tonalColors(baseColor) }),
              )
            "
          >
            按主色生成六级
          </button>
        </div>
        <div class="palette-preview">
          <label
            v-for="(label, state) in { ...VISIT_LABELS, unmapped: '无对应边界' }"
            :key="state"
            ><input
              type="color"
              :value="store.colors[state]"
              :aria-label="label + '颜色'"
              @change="color(state, $event)"
            />{{ label }}</label
          >
        </div>
      </section></template
    >
    <template v-else
      ><section class="settings-section">
        <div class="section-heading">
          <div>
            <h2>我的存档</h2>
            <p class="note">
              当前有 {{ recordCounts.regions }} 条地区记录、{{ recordCounts.entries }} 条项目记录。
            </p>
          </div>
          <button @click="exportJson(store.session!.snapshot())">导出 JSON 备份</button>
        </div>
        <form
          class="toolbar"
          @submit.prevent="
            operation(async () => {
              await store.saveArchive(archiveName);
              archiveName = '';
            })
          "
        >
          <input
            v-model="archiveName"
            maxlength="200"
            placeholder="给这份记录起个名字"
            aria-label="存档名称"
          /><button
            class="primary"
            :disabled="busy"
          >
            保存当前记录
          </button>
        </form>
        <div class="archive-list">
          <article
            v-for="a in store.archives"
            :key="a.id"
            class="archive-row"
          >
            <div class="archive-info">
              <span class="tag">{{ a.name.includes('自动备份') ? '自动备份' : '手动存档' }}</span
              ><template v-if="renaming === a.id"
                ><input
                  v-model="renameText"
                  aria-label="新的存档名称"
                  maxlength="200"
                /><button
                  :disabled="busy || !renameText.trim()"
                  @click="
                    operation(async () => {
                      await store.renameArchive(a, renameText.trim());
                      renaming = '';
                    })
                  "
                >
                  保存</button
                ><button @click="renaming = ''">取消</button></template
              ><template v-else
                ><strong>{{ a.name }}</strong
                ><small
                  >{{ new Date(a.createdAt).toLocaleString() }} ·
                  {{ Object.keys(a.snapshot.regions).length }} 地区 /
                  {{ Object.keys(a.snapshot.entries).length }} 项目</small
                ></template
              >
            </div>
            <div class="toolbar compact">
              <button
                @click="
                  selected = a;
                  action = 'restore';
                "
              >
                恢复</button
              ><button @click="exportJson(a.snapshot, a.name + '.json')">下载</button
              ><button
                @click="
                  renaming = a.id;
                  renameText = a.name;
                "
              >
                改名</button
              ><button
                class="danger text-button"
                @click="
                  selected = a;
                  action = 'delete';
                "
              >
                删除
              </button>
            </div>
          </article>
          <p
            v-if="!store.archives.length"
            class="empty-state"
          >
            还没有存档。为当前记录保存一份快照，之后可以随时恢复。
          </p>
        </div>
      </section>
      <section class="settings-section danger-zone">
        <h2>清空到访状态</h2>
        <p>保留个人项目、名称与备注。清空前自动保存备份，也可立即撤销。</p>
        <button
          class="danger"
          @click="action = 'clear'"
        >
          查看清空范围
        </button>
      </section></template
    >
    <AppDialog
      v-if="action"
      :title="
        action === 'restore' ? '恢复这份存档' : action === 'delete' ? '删除存档' : '清空到访状态'
      "
      @close="!busy && (action = '')"
      ><template v-if="action === 'restore'"
        ><p>将以“{{ selected?.name }}”替换当前记录。</p>
        <p>
          存档包含 {{ Object.keys(selected!.snapshot.regions).length }} 条地区记录和
          {{ Object.keys(selected!.snapshot.entries).length }} 条项目记录。
        </p>
        <p class="note">恢复前会自动备份当前记录。</p></template
      >
      <p v-else-if="action === 'delete'">
        删除“{{
          selected?.name
        }}”不会改变当前旅行记录。此存档删除后无法恢复，请先下载需要保留的备份。
      </p>
      <p v-else>
        将清除当前 {{ recordCounts.regions }} 条地区记录和
        {{ recordCounts.entries }} 条项目记录中的到访状态，先自动备份。
      </p>
      <p
        v-if="message"
        role="alert"
      >
        {{ message }}
      </p>
      <button
        :disabled="busy"
        :class="action === 'delete' ? 'danger' : 'primary'"
        @click="apply"
      >
        {{ busy ? '正在处理…' : action === 'delete' ? '确认删除' : '备份并确认' }}
      </button></AppDialog
    >
  </section>
</template>
