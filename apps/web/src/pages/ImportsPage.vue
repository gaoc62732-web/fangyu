<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, shallowRef } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import {
  VISIT_LABELS,
  VISIT_RANK,
  type ImportPlan,
  type ImportRow,
  type VisitState,
} from '@fangyu/contracts';
import { CountySpatialIndex, exportWorkbook, namePlan } from '@fangyu/import-export';
import { useAppStore } from '../app/store.js';
import { download, exportCsv, exportJson } from '../features/exports/download.js';
import {
  applyRows,
  geographicPreview,
  parseNamesFile,
  parseRecordFile,
  photoPlan,
  selectedOsmKml,
  stageGeographicFiles,
  type GeographicStage,
} from '../features/imports/parse.js';
import type { ImportJobState } from '../features/imports/job.js';
import AppDialog from '../components/AppDialog.vue';
const store = useAppStore(),
  plan = ref<ImportPlan>(),
  stage = ref<GeographicStage>(),
  spatial = shallowRef<CountySpatialIndex>();
const method = ref('names'),
  names = ref(''),
  category = ref('railway-station'),
  state = ref<VisitState>('transit');
const busy = ref(false),
  confirm = ref(false),
  featureSearch = ref(''),
  page = ref(0),
  featurePage = ref(0),
  group = ref('');
const job = reactive<ImportJobState>({ phase: 'idle', message: '', files: [] });
let controller: AbortController | undefined;
const methods = [
  ['names', '名称清单', '粘贴地点、车站与机场，或读取文档'],
  ['records', '记录文件', 'JSON 备份、Excel、Railtrack'],
  ['tracks', '轨迹与地图要素', 'KML、OSM、PBF 本地解析'],
  ['photos', '照片位置', '读取内嵌 GPS，核对行政区'],
] as const;
const stale = computed(() => {
  void store.revision;
  return !!plan.value && !plan.value.applied && plan.value.baseRevision !== store.session!.revision;
});
function rowGroup(row: ImportRow) {
  if (!row.candidates.length) return 'unmatched';
  if (row.choice < 0 || (!row.include && row.candidates.length > 1)) return 'ambiguous';
  const candidate = row.candidates[row.choice];
  if (!candidate) return 'ambiguous';
  if (
    row.kind === 'region' &&
    VISIT_RANK[store.session!.visitState(candidate.id)] >= VISIT_RANK[row.state]
  )
    return 'unchanged';
  if (
    row.kind === 'entry' &&
    !row.entryUpdate &&
    (candidate.entryIds || [candidate.id]).every(
      (id) => store.session!.view(store.session!.entry(id)).checked,
    )
  )
    return 'unchanged';
  return 'matched';
}
const groups = [
  ['matched', '已匹配'],
  ['ambiguous', '待核对'],
  ['unmatched', '未匹配'],
  ['unchanged', '无变化'],
] as const;
const matchingRows = computed(
  () => plan.value?.rows.filter((r) => !group.value || rowGroup(r) === group.value) || [],
);
const visibleRows = computed(() =>
  matchingRows.value.slice(page.value * 60, (page.value + 1) * 60),
);
const selectedCount = computed(
  () => plan.value?.rows.filter((r) => r.include && r.choice >= 0).length || 0,
);
const matchingFeatures = computed(
  () =>
    stage.value?.features.filter((f) =>
      [f.source, f.item.name, f.item.kind, f.item.tagSummary]
        .join(' ')
        .toLowerCase()
        .includes(featureSearch.value.toLowerCase()),
    ) || [],
);
const visibleFeatures = computed(() =>
  matchingFeatures.value.slice(featurePage.value * 60, (featurePage.value + 1) * 60),
);
const step = computed(() =>
  job.phase === 'done'
    ? 4
    : confirm.value || job.phase === 'applying' || job.phase === 'saving'
      ? 3
      : plan.value
        ? 2
        : job.files.length || names.value
          ? 1
          : 0,
);
const impactedRegions = computed(() => {
  const ids = new Set<string>();
  for (const row of plan.value?.rows || []) {
    if (!row.include || row.choice < 0) continue;
    const c = row.candidates[row.choice]!;
    if (row.kind === 'region') ids.add(c.id);
    else
      for (const id of c.entryIds || [c.id])
        for (const rid of store.session!.entry(id).regionIds) ids.add(rid);
  }
  return [...ids];
});
async function work(action: (signal: AbortSignal) => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  controller = new AbortController();
  const signal = controller.signal;
  job.message = '';
  job.phase = 'reading';
  try {
    await action(signal);
    signal.throwIfAborted();
    if (job.phase === 'reading' || job.phase === 'matching')
      job.phase = plan.value ? 'review' : 'idle';
  } catch (cause) {
    job.phase = signal.aborted ? 'cancelled' : 'error';
    job.message = signal.aborted ? '已取消，本次解析没有写入记录。' : String(cause);
  } finally {
    busy.value = false;
  }
}
function cancel() {
  controller?.abort();
  job.message = '已请求取消，正在结束当前文件处理…';
}
async function countyIndex(signal: AbortSignal) {
  job.phase = 'matching';
  job.message = '正在准备县区边界进行空间核对…';
  if (!spatial.value) {
    const geometry = await store.ensureGeometry('china');
    signal.throwIfAborted();
    spatial.value = new CountySpatialIndex(store.session!, geometry);
  }
  return spatial.value;
}
function files(event: Event) {
  const input = event.target as HTMLInputElement;
  const selected = [...(input.files || [])];
  input.value = '';
  job.files = selected.map((f) => f.name);
  return selected;
}
function reset() {
  plan.value = undefined;
  stage.value = undefined;
  page.value = 0;
  group.value = '';
  confirm.value = false;
}
async function chooseRecord(e: Event) {
  const file = files(e)[0];
  if (!file) return;
  await work(async (signal) => {
    reset();
    const p = await parseRecordFile(store.session!, file);
    signal.throwIfAborted();
    plan.value = p;
  });
}
async function chooseNames(e: Event) {
  const file = files(e)[0];
  if (!file) return;
  await work(async (signal) => {
    reset();
    const p = await parseNamesFile(store.session!, file, category.value);
    signal.throwIfAborted();
    plan.value = p;
  });
}
async function previewNames() {
  await work(async (signal) => {
    reset();
    await new Promise((r) => setTimeout(r, 0));
    signal.throwIfAborted();
    plan.value = namePlan(store.session!, names.value, category.value, '粘贴清单');
  });
}
async function chooseTracks(e: Event) {
  const selected = files(e);
  if (!selected.length) return;
  await work(async (signal) => {
    reset();
    const staged = await stageGeographicFiles(store.session!, selected, signal);
    signal.throwIfAborted();
    stage.value = staged;
    featurePage.value = 0;
    if (!staged.features.length) await previewTracks(signal);
  });
}
async function previewTracks(signal: AbortSignal) {
  if (!stage.value) return;
  const spatial = await countyIndex(signal);
  signal.throwIfAborted();
  plan.value = geographicPreview(store.session!, spatial, stage.value, state.value);
  page.value = 0;
}
async function choosePhotos(e: Event) {
  const selected = files(e);
  if (!selected.length) return;
  await work(async (signal) => {
    reset();
    const p = await photoPlan(
      store.session!,
      await countyIndex(signal),
      selected,
      (text) => (job.message = text),
      signal,
    );
    signal.throwIfAborted();
    plan.value = p;
  });
}
async function apply() {
  if (busy.value) return;
  busy.value = true;
  job.phase = 'applying';
  job.message = '正在保存变更前备份…';
  try {
    const p = plan.value;
    if (!p || p.applied) return;
    if (store.session!.revision !== p.baseRevision) throw Error('记录已变化，请重新预览。');
    if (p.snapshot) store.session!.validate(p.snapshot);
    await store.saveArchive(p.title + '前自动备份');
    if (store.session!.revision !== p.baseRevision) throw Error('备份期间记录已变化，请重新预览。');
    let results = new Map<string, string>();
    if (
      !store.commit((s) => {
        results = applyRows(s, p);
      })
    )
      throw Error(store.error);
    p.applied = true;
    for (const row of p.rows) row.result = results.get(row.id) || row.result;
    job.phase = 'saving';
    job.message = '变更已应用，正在等待保存完成…';
    await store.flush();
    job.phase = 'done';
    job.message = '已保存，可通过撤销或存档恢复。';
    confirm.value = false;
  } catch (cause) {
    job.phase = 'error';
    job.message =
      String(cause) + (plan.value?.applied ? '；本地变更已应用，请导出备份，勿重复导入。' : '');
  } finally {
    busy.value = false;
  }
}
function report() {
  if (!plan.value) return;
  exportCsv(
    [
      ['来源', '输入', '匹配', '是否选择', '状态', '结果'],
      ...plan.value.rows.map((r) => [
        r.source,
        r.input,
        r.candidates[r.choice]?.path,
        r.include,
        r.state,
        r.result,
      ]),
      ...plan.value.notes.map((n) => ['', '', '', '', '', n]),
    ],
    '方舆导入核对清单.csv',
  );
}
async function excel() {
  await work(async (signal) => {
    const bytes = await exportWorkbook(store.session!);
    signal.throwIfAborted();
    download(
      new Blob([new Uint8Array(bytes)], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      '方舆旅行记录.xlsx',
    );
    job.message = 'Excel 文件已生成';
  });
}
function changeMethod(value: string) {
  if (busy.value) return;
  if (
    plan.value &&
    !plan.value.applied &&
    !window.confirm('切换导入方式会放弃当前核对结果，继续？')
  )
    return;
  method.value = value;
  reset();
  job.phase = 'idle';
  job.files = [];
  job.message = '';
}
onBeforeRouteLeave(() => {
  if (!busy.value) return true;
  if (job.phase === 'saving' || job.phase === 'applying') {
    store.notice = '导入正在保存，可在顶部查看保存状态。';
    return true;
  }
  if (!window.confirm('离开会取消当前文件处理，已输入内容仍会保留。离开？')) return false;
  cancel();
  return true;
});
onBeforeUnmount(() => controller?.abort());
</script>
<template>
  <div class="import-workflow">
    <div class="export-strip">
      <div>
        <strong>先留一份备份</strong><span>完整 JSON 可恢复名称、备注与所有到访记录。</span>
      </div>
      <button @click="exportJson(store.session!.snapshot())">导出 JSON</button
      ><button
        :disabled="busy"
        @click="excel"
      >
        导出 Excel
      </button>
    </div>
    <ol
      class="import-steps"
      aria-label="导入步骤"
    >
      <li
        v-for="(label, i) in ['选择方式', '提供内容', '核对匹配', '确认变更', '查看结果']"
        :key="label"
        :class="{ current: step === i, done: step > i }"
      >
        <span>{{ i + 1 }}</span
        >{{ label }}
      </li>
    </ol>
    <div class="import-methods">
      <button
        v-for="[id, label, note] in methods"
        :key="id"
        :aria-pressed="method === id"
        :disabled="busy"
        @click="changeMethod(id)"
      >
        <strong>{{ label }}</strong
        ><small>{{ note }}</small>
      </button>
    </div>
    <fieldset
      :disabled="busy"
      class="import-input"
    >
      <template v-if="method === 'names'"
        ><h2>这次走过哪些地方</h2>
        <p class="note">每行一个项目。可使用“名称 | 地区”区分同名地点，机场支持代码与别名。</p>
        <select
          v-model="category"
          aria-label="名称类别"
        >
          <option
            v-for="c in store.session!.index.catalog.categories"
            :key="c.id"
            :value="c.id"
          >
            {{ c.name }}
          </option></select
        ><textarea
          v-model="names"
          aria-label="名称清单"
          placeholder="北京站 | 北京市&#10;上海虹桥站" />
        <div class="toolbar">
          <button
            class="primary"
            :disabled="!names.trim()"
            @click="previewNames"
          >
            生成核对清单</button
          ><label class="file-input"
            >或读取 TXT / CSV / DOCX<input
              type="file"
              accept=".txt,.csv,.tsv,.docx"
              @change="chooseNames"
          /></label></div
      ></template>
      <template v-else-if="method === 'records'"
        ><h2>从已有记录继续</h2>
        <p>完整 JSON 将替换当前记录；Excel 与 Railtrack 按预览合并。确认前不会写入。</p>
        <label class="file-drop"
          >选择 JSON / XLSX 文件<input
            type="file"
            accept=".json,.xlsx"
            @change="chooseRecord" /></label
      ></template>
      <template v-else-if="method === 'tracks'"
        ><h2>从轨迹核对到访</h2>
        <p>文件在本地解析。OSM 地图要素需先选择，不能直接当作旅行轨迹。</p>
        <label class="file-drop"
          >选择 KML / OSM / PBF<input
            type="file"
            multiple
            accept=".kml,.osm,.pbf"
            @change="chooseTracks" /></label
      ></template>
      <template v-else
        ><h2>从照片位置找回足迹</h2>
        <p>只读取照片内嵌 GPS，不上传照片。边界重叠和坐标基准异常会进入核对。</p>
        <label class="file-drop"
          >选择照片<input
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,.tif,.tiff,.heic,.heif"
            @change="choosePhotos" /></label
      ></template>
    </fieldset>
    <div
      v-if="busy || job.message || job.files.length"
      class="import-status"
      :class="{ error: job.phase === 'error' }"
      role="status"
    >
      <span>{{ job.message || (busy ? '正在读取与匹配…' : job.files.join('、')) }}</span
      ><button
        v-if="busy && !['applying', 'saving'].includes(job.phase)"
        @click="cancel"
      >
        取消任务
      </button>
    </div>
    <section
      v-if="stage?.features.length"
      class="card"
    >
      <h2>选择要用于匹配的地图要素</h2>
      <div class="toolbar">
        <input
          v-model="featureSearch"
          aria-label="筛选 OSM 要素"
          placeholder="名称或标签"
          @input="featurePage = 0"
        /><button @click="matchingFeatures.forEach((f) => (f.selected = true))">选择筛选结果</button
        ><button @click="matchingFeatures.forEach((f) => (f.selected = false))">取消筛选结果</button
        ><select
          v-model="state"
          aria-label="轨迹目标状态"
        >
          <option
            v-for="(label, value) in VISIT_LABELS"
            :key="value"
            :value="value"
          >
            {{ label }}
          </option></select
        ><button
          :disabled="busy"
          class="primary"
          @click="work(previewTracks)"
        >
          匹配所选要素</button
        ><button
          @click="
            work(async () => {
              download(
                selectedOsmKml(stage!),
                '所选地图要素.kml',
                'application/vnd.google-earth.kml+xml',
              );
            })
          "
        >
          导出所选 KML
        </button>
      </div>
      <label
        v-for="f in visibleFeatures"
        :key="f.id"
        class="selection-row"
        ><input
          v-model="f.selected"
          type="checkbox"
        />{{ f.item.name }}<small>{{ f.source }} · {{ f.item.kind }}</small></label
      >
      <div class="toolbar">
        <button
          :disabled="!featurePage"
          @click="featurePage--"
        >
          上一页</button
        ><span>{{ matchingFeatures.length }} 项 · 第 {{ featurePage + 1 }} 页</span
        ><button
          :disabled="(featurePage + 1) * 60 >= matchingFeatures.length"
          @click="featurePage++"
        >
          下一页
        </button>
      </div>
    </section>
    <section
      v-if="plan"
      class="import-review"
    >
      <div class="section-heading">
        <div>
          <span class="eyebrow">{{ plan.snapshot ? '完整替换' : '合并导入' }}</span>
          <h2>{{ plan.title }}</h2>
        </div>
        <button @click="report">下载核对清单</button>
      </div>
      <p
        v-if="plan.snapshot"
        class="pending-note"
      >
        确认后将替换为 {{ Object.keys(plan.snapshot.regions).length }} 条地区记录和
        {{ Object.keys(plan.snapshot.entries).length }} 条项目记录，先自动备份当前记录。
      </p>
      <p
        v-if="stale"
        class="inline-error"
        role="alert"
      >
        预览后记录已变化，请重新生成核对清单。
      </p>
      <nav
        v-if="!plan.snapshot"
        class="review-groups"
      >
        <button
          :aria-pressed="!group"
          @click="
            group = '';
            page = 0;
          "
        >
          全部 {{ plan.rows.length }}</button
        ><button
          v-for="[id, label] in groups"
          :key="id"
          :aria-pressed="group === id"
          @click="
            group = id;
            page = 0;
          "
        >
          {{ label }} {{ plan.rows.filter((r) => rowGroup(r) === id).length }}
        </button>
      </nav>
      <fieldset :disabled="busy || plan.applied || stale">
        <div
          v-if="plan.rows.length"
          class="toolbar"
        >
          <select
            v-model="state"
            aria-label="统一目标状态"
          >
            <option
              v-for="(label, value) in VISIT_LABELS"
              :key="value"
              :value="value"
            >
              {{ label }}
            </option></select
          ><button
            @click="
              plan.rows
                .filter((r) => r.include && r.kind === 'region')
                .forEach((r) => (r.state = state))
            "
          >
            套用到已选地区</button
          ><button
            @click="
              plan.rows.forEach((r) => {
                if (r.choice >= 0) r.include = true;
              })
            "
          >
            选择已匹配项</button
          ><button @click="plan.rows.forEach((r) => (r.include = false))">全部取消</button>
        </div>
        <div
          v-if="plan.rows.length"
          class="table-scroll"
        >
          <table>
            <thead>
              <tr>
                <th>选择</th>
                <th>输入</th>
                <th>匹配目标</th>
                <th>状态</th>
                <th>结果</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in visibleRows"
                :key="row.id"
              >
                <td>
                  <input
                    v-model="row.include"
                    type="checkbox"
                    :disabled="row.choice < 0"
                    :aria-label="'选择 ' + row.input"
                  />
                </td>
                <td>
                  {{ row.input }}<small>{{ row.source }}</small>
                </td>
                <td>
                  <select
                    v-model.number="row.choice"
                    :aria-label="'匹配 ' + row.input"
                    @change="row.include = row.choice >= 0"
                  >
                    <option :value="-1">未匹配／待选择</option>
                    <option
                      v-for="(c, i) in row.candidates"
                      :key="c.id"
                      :value="i"
                    >
                      {{ c.name }} · {{ c.path }}
                    </option>
                  </select>
                </td>
                <td>
                  <select
                    v-if="row.kind === 'region'"
                    v-model="row.state"
                    :aria-label="'状态 ' + row.input"
                  >
                    <option
                      v-for="(label, value) in VISIT_LABELS"
                      :key="value"
                      :value="value"
                    >
                      {{ label }}
                    </option></select
                  ><span v-else>项目到访</span>
                </td>
                <td>{{ row.result }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </fieldset>
      <div class="toolbar">
        <template v-if="matchingRows.length"
          ><button
            :disabled="!page"
            @click="page--"
          >
            上一页</button
          ><span
            >{{ matchingRows.length }} 项 · 已选择 {{ selectedCount }} 项 · 第
            {{ page + 1 }} 页</span
          ><button
            :disabled="(page + 1) * 60 >= matchingRows.length"
            @click="page++"
          >
            下一页
          </button></template
        ><button
          class="primary"
          :disabled="busy || plan.applied || stale || (!plan.snapshot && !selectedCount)"
          @click="confirm = true"
        >
          核对变更摘要
        </button>
      </div>
      <details
        v-if="plan.notes.length"
        class="rules"
      >
        <summary>未匹配与补充说明（{{ plan.notes.length }}）</summary>
        <p
          v-for="(note, i) in plan.notes"
          :key="i"
        >
          {{ note }}
        </p>
      </details>
    </section>
    <AppDialog
      v-if="confirm && plan"
      title="确认本次记录变更"
      @close="!busy && (confirm = false)"
      ><p v-if="plan.snapshot">完整替换当前所有记录，先保存自动备份。</p>
      <template v-else
        ><p>
          将处理 {{ selectedCount }} 个已选择项目，直接涉及 {{ impactedRegions.length }} 个地区。
        </p>
        <p class="note">
          地区状态只提升；项目标记按现有规则带入上级及共享地区。实际变更可在应用后核对清单中查看。
        </p>
        <p>
          {{
            impactedRegions
              .slice(0, 20)
              .map((id) => store.session!.index.regions.get(id)?.name)
              .join('、')
          }}{{ impactedRegions.length > 20 ? ' 等' : '' }}
        </p></template
      >
      <p
        v-if="job.message"
        role="status"
      >
        {{ job.message }}
      </p>
      <button
        class="primary"
        :disabled="busy || stale || plan.applied"
        @click="apply"
      >
        {{ busy ? '正在备份与保存…' : '备份并确认应用' }}
      </button></AppDialog
    >
  </div>
</template>
