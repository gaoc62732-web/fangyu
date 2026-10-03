<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { EntryView } from '@fangyu/domain';
import type { StadiumExperience } from '@fangyu/contracts';
import { useAppStore } from '../app/store.js';

const props = withDefaults(
  defineProps<{
    rows: EntryView[];
    selectedRegionId?: string | undefined;
    pageSize?: number;
  }>(),
  { pageSize: 50 },
);

const emit = defineEmits<{ locate: [entry: EntryView] }>();
const store = useAppStore();
const page = ref(0);
const editing = ref('');
const editingIds = ref<string[]>([]);
const name = ref('');
const note = ref('');
type GroupedEntry = EntryView & { groupEntryIds?: string[]; regionPaths?: string[] };
const groupIds = (entry: EntryView) => (entry as GroupedEntry).groupEntryIds || [entry.id];
const regionPaths = (entry: EntryView) => (entry as GroupedEntry).regionPaths || [];
const visible = computed(() =>
  props.rows.slice(page.value * props.pageSize, (page.value + 1) * props.pageSize),
);
const pageCount = computed(() => Math.max(1, Math.ceil(props.rows.length / props.pageSize)));

watch(
  () => props.rows,
  () => {
    page.value = Math.min(page.value, pageCount.value - 1);
  },
);

function mark(entry: EntryView, event: Event) {
  const visited = (event.target as HTMLInputElement).checked;
  store.commit((session) => {
    for (const id of groupIds(entry)) session.markEntry(id, visited, props.selectedRegionId);
  });
}

function markSubitem(entry: EntryView, subitemId: string, event: Event) {
  const visited = (event.target as HTMLInputElement).checked;
  store.commit((session) =>
    session.markSubitem(entry.id, subitemId, visited, props.selectedRegionId),
  );
}

function markStadiumExperience(entry: EntryView, type: StadiumExperience, event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  store.commit((session) => session.markStadiumExperience(entry.id, type, checked));
}

function edit(entry: EntryView) {
  editing.value = entry.id;
  editingIds.value = groupIds(entry);
  name.value = entry.name;
  note.value = entry.note;
}

function save() {
  if (
    store.commit((session) => {
      for (const id of editingIds.value) session.editEntry(id, name.value, note.value);
    })
  ) {
    editing.value = '';
    editingIds.value = [];
  }
}

function safeUrl(url?: string) {
  return /^https?:\/\//i.test(url || '') ? url : undefined;
}

function missingPoint(entry: EntryView) {
  const needsPoint =
    Boolean(entry.heritageComponentId) ||
    ['football-stadium', 'vn-national-special', 'vn-national-special-component'].includes(
      entry.categoryId,
    );
  return (
    needsPoint &&
    (entry.coordinateReferenceOnly ||
      entry.ordinaryPointEligible === false ||
      entry.coordinateStatus?.includes('representative') ||
      !entry.coordinates ||
      entry.coordinates.length !== 2 ||
      !entry.coordinates.every(Number.isFinite) ||
      Math.abs(entry.coordinates[0]) > 180 ||
      Math.abs(entry.coordinates[1]) > 90)
  );
}

function removePersonalEntry(entry: EntryView) {
  store.commit((session) => session.removeCustomEntry(entry.id));
}
</script>

<template>
  <p class="note">
    {{ rows.length }} 项 · 已标记 {{ rows.filter((row) => row.visited).length }} 项
  </p>
  <div class="entries">
    <article
      v-for="entry in visible"
      :key="entry.id"
      class="entry"
    >
      <label>
        <input
          type="checkbox"
          :checked="entry.checked"
          :indeterminate="entry.partial"
          :title="groupIds(entry).length > 1 ? '同时更新这个项目在全部所属政区的记录' : ''"
          @change="mark(entry, $event)"
        />
        <span>{{ entry.categoryId === 'football-stadium' ? '到访 · ' : '' }}{{ entry.name }}</span>
      </label>
      <div
        v-if="entry.categoryId === 'football-stadium'"
        class="stadium-experiences"
      >
        <label
          ><input
            type="checkbox"
            :checked="store.session!.stadiumExperience(entry.id, 'tour')"
            @change="markStadiumExperience(entry, 'tour', $event)"
          />参观球场</label
        >
        <label
          ><input
            type="checkbox"
            :checked="store.session!.stadiumExperience(entry.id, 'match')"
            @change="markStadiumExperience(entry, 'match', $event)"
          />现场观赛</label
        >
        <small>到访、参观球场、现场观赛三项独立记录，不自动互相勾选。</small>
      </div>
      <template v-if="regionPaths(entry).length">
        <small
          >涉及 {{ regionPaths(entry).length }} 个政区 ·
          {{ regionPaths(entry).slice(0, 3).join('；') }}</small
        >
        <details v-if="regionPaths(entry).length > 3">
          <summary>查看全部所属政区</summary>
          <small class="entry-region-paths">{{ regionPaths(entry).join('；') }}</small>
        </details>
      </template>
      <small v-else>{{ entry.path }} {{ entry.code }} {{ entry.lines?.join(' / ') }}</small>
      <small
        v-if="entry.nameTranslationNeedsReview"
        class="name-review-note"
        >{{
          entry.nameTranslationStatus === 'unresolved'
            ? '原始名称待核 / Source name unresolved'
            : '译名待核 / Provisional name'
        }}</small
      >
      <details
        v-if="entry.nameZh && entry.originalName"
        class="original-name"
      >
        <summary>原文名称 / Original name</summary>
        <span>{{ entry.originalName }}</span>
        <small v-if="entry.nameTranslationNote">{{ entry.nameTranslationNote }}</small>
      </details>
      <small v-if="missingPoint(entry)">精确坐标待核验；目前仅可查看所属地区。</small>
      <p
        v-if="entry.heritageMembershipStatus === 'excluded'"
        class="note"
      >
        未列入世界遗产：此处仅保留旧记录与备注，不计入世界遗产完成情况。
      </p>
      <small v-if="entry.coordinateStatus?.includes('representative')"
        >官方提供的是项目或多个地点共用的参考坐标，不作为独立地点图钉。</small
      >
      <small v-else-if="entry.coordinateReferenceOnly"
        >此坐标仅供范围参考，不作为独立地点图钉。</small
      >
      <small
        v-else-if="
          (entry.heritageComponentId || entry.nationalHeritageParentId) && entry.coordinates
        "
        >{{ entry.coordinatePrecisionNote || '地点参考坐标；不表示入口或测绘定位。' }}</small
      >
      <small v-else-if="entry.coordinateStatus === 'osm-polygon-interior'"
        >经官方身份核对的球场面内参考点，不表示球场入口。</small
      >
      <p
        v-if="entry.accessibilityStatus === 'not-open-to-public'"
        class="note"
      >
        原遗产地点不对公众开放；地图位置仅供辨认，不是参观入口。
        <span v-if="entry.accessibilityNote">{{ entry.accessibilityNote }}</span>
        <a
          v-if="safeUrl(entry.accessibilitySourceUrl)"
          :href="safeUrl(entry.accessibilitySourceUrl)"
          target="_blank"
          rel="noopener noreferrer"
          >开放情况来源</a
        >
      </p>
      <p
        v-if="entry.note"
        class="note"
      >
        {{ entry.note }}
      </p>
      <details v-if="entry.subitems.length">
        <summary>组成项目</summary>
        <label
          v-for="item in entry.subitems"
          :key="item.id"
          class="subitem"
        >
          <input
            type="checkbox"
            :checked="store.session!.subitemVisited(entry.id, item.id)"
            @change="markSubitem(entry, item.id, $event)"
          />
          {{ item.name }}
        </label>
      </details>
      <div class="toolbar">
        <a
          v-if="safeUrl(entry.coordinateSourceUrl)"
          :href="safeUrl(entry.coordinateSourceUrl)"
          target="_blank"
          rel="noopener noreferrer"
          >坐标来源<span v-if="entry.coordinateAttribution">
            · {{ entry.coordinateAttribution }}</span
          ></a
        >
        <a
          v-if="safeUrl(entry.coordinateLicenseUrl)"
          :href="safeUrl(entry.coordinateLicenseUrl)"
          target="_blank"
          rel="noopener noreferrer"
          >{{ entry.coordinateLicense || '坐标许可' }}</a
        >
        <a
          v-if="safeUrl(entry.source)"
          :href="safeUrl(entry.source)"
          target="_blank"
          rel="noopener noreferrer"
          >资料来源</a
        >
        <button @click="emit('locate', entry)">
          {{ missingPoint(entry) ? '查看所属地区' : '定位' }}
        </button>
        <button @click="edit(entry)">编辑名称与备注</button>
        <button
          v-if="!store.session!.index.entries.has(entry.id)"
          @click="removePersonalEntry(entry)"
        >
          删除个人项目
        </button>
      </div>
      <form
        v-if="editing === entry.id"
        @submit.prevent="save"
      >
        <label
          >名称<input
            v-model="name"
            required
            maxlength="1000"
        /></label>
        <label
          >备注<textarea
            v-model="note"
            maxlength="20000"
          ></textarea>
        </label>
        <button type="submit">保存</button>
        <button
          type="button"
          @click="editing = ''"
        >
          取消
        </button>
      </form>
    </article>
  </div>
  <p
    v-if="!rows.length"
    class="empty"
  >
    当前范围没有项目。
  </p>
  <div
    v-if="pageCount > 1"
    class="toolbar"
  >
    <button
      :disabled="page === 0"
      @click="page--"
    >
      上一页
    </button>
    <span>{{ page + 1 }} / {{ pageCount }}</span>
    <button
      :disabled="page + 1 >= pageCount"
      @click="page++"
    >
      下一页
    </button>
  </div>
</template>

<style scoped>
.stadium-experiences {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  margin: 8px 0;
}
.stadium-experiences small {
  flex-basis: 100%;
}
</style>
