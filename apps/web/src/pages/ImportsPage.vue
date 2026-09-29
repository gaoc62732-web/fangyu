<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import { VISIT_LABELS, type ImportPlan, type VisitState } from '@fangyu/contracts';
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

const store = useAppStore();
const plan = ref<ImportPlan>();
const stage = ref<GeographicStage>();
const spatial = shallowRef<CountySpatialIndex>();
const busy = ref(false);
const message = ref('');
const names = ref('');
const category = ref('railway-station');
const state = ref<VisitState>('transit');
const featureSearch = ref('');
const page = ref(0);
const featurePage = ref(0);
const perPage = 100;
const visibleRows = computed(
  () => plan.value?.rows.slice(page.value * perPage, (page.value + 1) * perPage) || [],
);
const matchingFeatures = computed(
  () =>
    stage.value?.features.filter((feature) =>
      [feature.source, feature.item.name, feature.item.kind, feature.item.tagSummary]
        .join(' ')
        .toLowerCase()
        .includes(featureSearch.value.toLowerCase()),
    ) || [],
);
const visibleFeatures = computed(() =>
  matchingFeatures.value.slice(featurePage.value * perPage, (featurePage.value + 1) * perPage),
);
const stale = computed(() => {
  void store.revision;
  return Boolean(
    plan.value && !plan.value.applied && plan.value.baseRevision !== store.session!.revision,
  );
});
const selectedCount = computed(
  () => plan.value?.rows.filter((row) => row.include && row.choice >= 0).length || 0,
);

async function work(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  message.value = '';
  try {
    await action();
  } catch (cause) {
    message.value = String(cause);
  } finally {
    busy.value = false;
  }
}

async function countyIndex() {
  if (!spatial.value)
    spatial.value = new CountySpatialIndex(store.session!, await store.ensureGeometry('china'));
  return spatial.value;
}

function files(event: Event): File[] {
  const input = event.target as HTMLInputElement;
  const selected = [...(input.files || [])];
  input.value = '';
  return selected;
}

async function chooseRecord(event: Event) {
  const file = files(event)[0];
  if (!file) return;
  await work(async () => {
    plan.value = undefined;
    plan.value = await parseRecordFile(store.session!, file);
    page.value = 0;
  });
}

async function chooseNames(event: Event) {
  const file = files(event)[0];
  if (!file) return;
  await work(async () => {
    plan.value = undefined;
    plan.value = await parseNamesFile(store.session!, file, category.value);
    page.value = 0;
  });
}

async function previewNames() {
  await work(async () => {
    plan.value = namePlan(store.session!, names.value, category.value, '粘贴清单');
    page.value = 0;
  });
}

async function chooseGeographic(event: Event) {
  const selected = files(event);
  await work(async () => {
    plan.value = undefined;
    stage.value = undefined;
    stage.value = await stageGeographicFiles(store.session!, selected);
    featurePage.value = 0;
    if (!stage.value.features.length) await previewGeographic();
  });
}

async function previewGeographic() {
  if (!stage.value) return;
  plan.value = geographicPreview(store.session!, await countyIndex(), stage.value, state.value);
  page.value = 0;
}

async function choosePhotos(event: Event) {
  const selected = files(event);
  await work(async () => {
    plan.value = undefined;
    plan.value = await photoPlan(store.session!, await countyIndex(), selected, (text) => {
      message.value = text;
    });
    page.value = 0;
  });
}

async function apply() {
  await work(async () => {
    const current = plan.value;
    if (!current || current.applied) return;
    if (store.session!.revision !== current.baseRevision) throw Error('记录已变化，请重新预览。');
    if (current.snapshot) store.session!.validate(current.snapshot);
    await store.saveArchive(current.title + '前自动备份');
    if (store.session!.revision !== current.baseRevision)
      throw Error('备份期间记录已变化，请重新预览。');
    let results = new Map<string, string>();
    const committed = store.commit((session) => {
      results = applyRows(session, current);
    });
    if (!committed) throw Error(store.error);
    for (const row of current.rows) {
      row.result = results.get(row.id) || row.result;
    }
    current.applied = true;
    message.value = '已应用，可通过撤销或存档恢复。';
  });
}

function report() {
  const current = plan.value;
  if (!current) return;
  exportCsv(
    [
      ['来源', '输入', '类别', '匹配目标', '已选择', '目标状态', '结果'],
      ...current.rows.map((row) => [
        row.source,
        row.input,
        row.kind,
        row.candidates[row.choice]?.path,
        row.include,
        row.state,
        row.result,
      ]),
      ...current.notes.map((note) => ['', '', '', '', '', '', note]),
    ],
    '方舆导入核对清单.csv',
  );
}

async function excel() {
  await work(async () => {
    const bytes = await exportWorkbook(store.session!);
    download(
      new Blob([new Uint8Array(bytes)], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      '方舆旅行记录.xlsx',
    );
  });
}

function selectFeatures(selected: boolean) {
  for (const feature of matchingFeatures.value) feature.selected = selected;
}
</script>

<template>
  <section class="page-heading">
    <h2>导入与导出</h2>
    <p>解析文件后核对预览。写入前自动备份，批量导入只提升已有到访状态。</p>
  </section>
  <div class="toolbar">
    <button @click="exportJson(store.session!.snapshot())">导出 JSON 备份</button>
    <button
      :disabled="busy"
      @click="excel"
    >
      导出 Excel
    </button>
  </div>
  <fieldset
    :disabled="busy"
    class="card"
  >
    <legend>记录文件</legend>
    <label
      >JSON / Excel / Railtrack<input
        type="file"
        accept=".json,.xlsx"
        @change="chooseRecord"
    /></label>
  </fieldset>
  <fieldset
    :disabled="busy"
    class="card"
  >
    <legend>名称清单</legend>
    <p>每行一个项目，可用“名称 | 地区”限定同名地点；机场支持代码与别名。</p>
    <select
      v-model="category"
      aria-label="名称类别"
    >
      <option
        v-for="item in store.session!.index.catalog.categories"
        :key="item.id"
        :value="item.id"
      >
        {{ item.name }}
      </option>
    </select>
    <textarea
      v-model="names"
      aria-label="名称清单"
    ></textarea>
    <button @click="previewNames">生成预览</button>
    <label
      >或读取文件<input
        type="file"
        accept=".txt,.csv,.tsv,.docx"
        @change="chooseNames"
    /></label>
  </fieldset>
  <fieldset
    :disabled="busy"
    class="card"
  >
    <legend>轨迹与照片位置</legend>
    <label
      >KML / OSM / PBF<input
        type="file"
        multiple
        accept=".kml,.osm,.pbf"
        @change="chooseGeographic"
    /></label>
    <label
      >照片 GPS<input
        type="file"
        multiple
        accept=".jpg,.jpeg,.png,.tif,.tiff,.heic,.heif"
        @change="choosePhotos"
    /></label>
  </fieldset>
  <p role="status">{{ busy ? '正在处理… ' : '' }}{{ message }}</p>

  <section
    v-if="stage?.features.length"
    class="card"
  >
    <h3>先选择 OSM 地图要素</h3>
    <p>地图要素不自动代表旅行轨迹。仅所选点线参与匹配。</p>
    <div class="toolbar">
      <input
        v-model="featureSearch"
        type="search"
        placeholder="名称或标签"
        aria-label="筛选 OSM 要素"
        @input="featurePage = 0"
      />
      <button @click="selectFeatures(true)">选择筛选结果</button>
      <button @click="selectFeatures(false)">取消筛选结果</button>
      <button
        :disabled="busy"
        @click="work(previewGeographic)"
      >
        匹配所选要素
      </button>
      <button
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
      v-for="feature in visibleFeatures"
      :key="feature.id"
      class="selection-row"
    >
      <input
        v-model="feature.selected"
        type="checkbox"
      />{{ feature.source }} · {{ feature.item.name }} · {{ feature.item.kind }}
    </label>
    <div class="toolbar">
      <button
        :disabled="!featurePage"
        @click="featurePage--"
      >
        上一页
      </button>
      <span>{{ matchingFeatures.length }} 项 · 第 {{ featurePage + 1 }} 页</span>
      <button
        :disabled="(featurePage + 1) * perPage >= matchingFeatures.length"
        @click="featurePage++"
      >
        下一页
      </button>
    </div>
  </section>

  <section
    v-if="plan"
    class="card"
  >
    <h3>{{ plan.title }}预览</h3>
    <p v-if="plan.snapshot">
      将恢复 {{ Object.keys(plan.snapshot.regions).length }} 条地区记录和
      {{ Object.keys(plan.snapshot.entries).length }} 条项目记录。
    </p>
    <p
      v-if="stale"
      role="alert"
    >
      记录在预览后发生变化，请重新生成预览。
    </p>
    <fieldset :disabled="busy || plan.applied || stale">
      <div class="toolbar">
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
          </option>
        </select>
        <button
          @click="
            plan.rows
              .filter((row) => row.include && row.kind === 'region')
              .forEach((row) => (row.state = state))
          "
        >
          套用到已选地区
        </button>
        <button
          @click="
            plan.rows.forEach((row) => {
              if (row.choice >= 0) row.include = true;
            })
          "
        >
          选择已匹配项
        </button>
        <button @click="plan.rows.forEach((row) => (row.include = false))">全部取消</button>
      </div>
      <div class="table-scroll">
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
                    v-for="(candidate, index) in row.candidates"
                    :key="candidate.id"
                    :value="index"
                  >
                    {{ candidate.name }} · {{ candidate.path }}
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
                  </option>
                </select>
                <span v-else>项目到访</span>
              </td>
              <td>{{ row.result }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </fieldset>
    <div class="toolbar">
      <button
        :disabled="!page"
        @click="page--"
      >
        上一页
      </button>
      <span>{{ plan.rows.length }} 项 · 已选择 {{ selectedCount }} 项 · 第 {{ page + 1 }} 页</span>
      <button
        :disabled="(page + 1) * perPage >= plan.rows.length"
        @click="page++"
      >
        下一页
      </button>
      <button
        :disabled="busy || plan.applied || stale || (!plan.snapshot && !selectedCount)"
        @click="apply"
      >
        备份并确认应用
      </button>
      <button @click="report">下载核对清单</button>
    </div>
    <details v-if="plan.notes.length">
      <summary>未匹配与补充说明（{{ plan.notes.length }}）</summary>
      <p
        v-for="(note, index) in plan.notes"
        :key="index"
      >
        {{ note }}
      </p>
    </details>
  </section>
</template>
