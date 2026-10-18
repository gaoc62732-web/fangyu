<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue';
import AdminPointMap from '../components/AdminPointMap.vue';
import PointIcon from '../components/PointIcon.vue';
import AppDialog from '../components/AppDialog.vue';

type Region = {
  id: string;
  name: string;
  level: string;
  code?: string;
  parentId?: string | null;
  path: string;
};
type CategoryField = { key: string; label: string };
type Category = { id: string; name: string; fields?: CategoryField[] };
type Component = {
  id: string;
  name: string;
  aliases?: string[];
  regionIds: string[];
  regions: Region[];
  coordinates: [number, number] | null;
  locationNote?: string;
  description?: string;
  attributes?: Record<string, any>;
  categoryId?: string;
  adminRevision: number;
};
type Point = {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  aliases?: string[];
  regionIds: string[];
  regions: Region[];
  coordinates: [number, number] | null;
  coordinateStatus: 'available' | 'missing' | 'invalid' | 'incomplete';
  place?: Record<string, any> | null;
  componentCount: number;
  components?: Component[];
  pending?: { status: string; reason: string } | null;
  details?: Record<string, any>;
  identifiers?: any[];
  sourceRefs?: string[];
  display?: Record<string, any>;
  group?: Record<string, any>;
  attributes?: Record<string, any>;
  adminRevision: number;
};

const base = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const panel = ref<'list' | 'edit'>('list');
const selecting = ref(false);
const createCategoryId = ref('');
const baseline = ref('');
const saveState = ref(false);
const query = ref('');
const categoryId = ref('');
const locationStatus = ref('');
const page = ref(1);
const pageSize = 40;
const total = ref(0);
const items = ref<Point[]>([]);
const categories = ref<Category[]>([]);
const revision = ref(0);
const undoAvailable = ref(false);
const selectedId = ref('');
const draft = ref<Point | null>(null);
const aliasesText = ref('');
const longitudeText = ref('');
const latitudeText = ref('');
const descriptionText = ref('');
const locationNoteText = ref('');
const advancedText = ref('');
const categoryFieldValues = ref<Record<string, string>>({});
const editingComponent = ref<Component | null>(null);
const componentAliasesText = ref('');
const componentLongitudeText = ref('');
const componentLatitudeText = ref('');
const componentLocationNoteText = ref('');
const componentDescriptionText = ref('');
const componentFieldValues = ref<Record<string, string>>({});
const componentBaseline = ref('');
const componentRegionQuery = ref('');
const componentRegionResults = ref<Region[]>([]);
const componentSuggestedRegionIds = ref<string[]>([]);
const componentSuggestedRegions = ref<Region[]>([]);
const fieldsDialog = ref(false);
const fieldLabel = ref('');
const fieldKey = ref('');
const regionQuery = ref('');
const regionResults = ref<Region[]>([]);
const suggestedRegionIds = ref<string[]>([]);
const suggestedRegions = ref<Region[]>([]);
const creating = ref(false);
const createName = ref('');
const addingComponent = ref(false);
const newComponentName = ref('');

function formSnapshot() {
  return JSON.stringify([
    draft.value?.name,
    draft.value?.regionIds,
    aliasesText.value,
    longitudeText.value,
    latitudeText.value,
    descriptionText.value,
    locationNoteText.value,
    advancedText.value,
    categoryFieldValues.value,
  ]);
}
const dirty = computed(() => !!draft.value && baseline.value !== formSnapshot());
const componentDirty = computed(() =>
  Boolean(
    editingComponent.value &&
    componentBaseline.value !==
      JSON.stringify([
        editingComponent.value.name,
        editingComponent.value.regionIds,
        componentAliasesText.value,
        componentLongitudeText.value,
        componentLatitudeText.value,
        componentLocationNoteText.value,
        componentDescriptionText.value,
        componentFieldValues.value,
      ]),
  ),
);
const categoryFields = computed(
  () => categories.value.find((category) => category.id === draft.value?.categoryId)?.fields || [],
);
const suggestedRegion = computed(
  () =>
    suggestedRegions.value.find((region) => region.level === 'county') ||
    suggestedRegions.value.find((region) => region.level === 'city') ||
    suggestedRegions.value[0],
);
function openCreate() {
  createCategoryId.value = categoryId.value || categories.value[0]?.id || '';
  createName.value = '';
  error.value = '';
  creating.value = true;
}
function discardChanges() {
  if (!dirty.value && !componentDirty.value) return true;
  const targets = [componentDirty.value ? '子项' : '', dirty.value ? '点位' : ''].filter(Boolean);
  return window.confirm(`放弃未保存的${targets.join('和')}修改？`);
}
async function reload() {
  if (!discardChanges()) return;
  const id = draft.value?.id;
  await loadList();
  if (id) await selectPoint(id, false, true);
}
function restore() {
  if (draft.value && discardChanges()) void selectPoint(draft.value.id, false, true);
}
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const coordinate = computed<[number, number] | null>(() => {
  const longitude = Number(longitudeText.value);
  const latitude = Number(latitudeText.value);
  return longitudeText.value !== '' &&
    latitudeText.value !== '' &&
    Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    Math.abs(longitude) <= 180 &&
    Math.abs(latitude) <= 90
    ? [longitude, latitude]
    : null;
});
const componentCoordinate = computed<[number, number] | null>(() => {
  const longitude = Number(componentLongitudeText.value);
  const latitude = Number(componentLatitudeText.value);
  return componentLongitudeText.value !== '' &&
    componentLatitudeText.value !== '' &&
    Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    Math.abs(longitude) <= 180 &&
    Math.abs(latitude) <= 90
    ? [longitude, latitude]
    : null;
});
const mapCoordinate = computed(() =>
  editingComponent.value ? componentCoordinate.value : coordinate.value,
);
const displayedCoordinateStatus = computed<Point['coordinateStatus']>(() =>
  editingComponent.value
    ? componentCoordinate.value
      ? 'available'
      : 'missing'
    : draft.value?.coordinateStatus || 'missing',
);
function coordinateStatusLabel(status: Point['coordinateStatus']) {
  return status === 'available'
    ? '已定位'
    : status === 'invalid'
      ? '异常'
      : status === 'incomplete'
        ? '未完成全部定位'
        : '未定位';
}
const mapRegionIds = computed(() =>
  editingComponent.value ? editingComponent.value.regionIds : draft.value?.regionIds || [],
);
const mapFocusKey = computed(() => editingComponent.value?.id || draft.value?.id || '');

async function request(path: string, init?: RequestInit) {
  const method = (init?.method || 'GET').toUpperCase();
  let response: Response;
  try {
    response = await fetch(base + path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
  } catch {
    throw Error('本机点位服务不可用。');
  }
  if (response.status === 401 || response.status === 403) throw Error('本机服务拒绝访问。');
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try {
      message = (await response.json()).message || message;
    } catch {
      /* response may be plain text */
    }
    throw Error(message);
  }
  const result = response.status === 204 ? null : await response.json();
  if (method !== 'GET' && typeof window !== 'undefined') {
    // Notify an open /points tab without coupling the admin page to the app store.
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      window.localStorage.setItem('fangyu-local-catalog-revision', stamp);
    } catch {
      // A restricted storage context must not turn a successful JSON write into an error.
    }
    window.dispatchEvent(new CustomEvent('fangyu-local-catalog-updated', { detail: stamp }));
  }
  return result;
}

function resetForm(point: Point | null) {
  draft.value = point ? structuredClone(point) : null;
  aliasesText.value = point?.aliases?.join('\n') || '';
  longitudeText.value = point?.coordinates ? String(point.coordinates[0]) : '';
  latitudeText.value = point?.coordinates ? String(point.coordinates[1]) : '';
  descriptionText.value = point?.details?.description || '';
  const attributes = { ...(point?.attributes || {}) };
  delete attributes.coordinates;
  const details = { ...(point?.details || {}) };
  delete details.description;
  advancedText.value = JSON.stringify(
    {
      identifiers: point?.identifiers || [],
      sourceRefs: point?.sourceRefs || [],
      display: point?.display || {},
      group: point?.group || {},
      attributes,
      details,
    },
    null,
    2,
  );
  locationNoteText.value = point?.place?.location?.note || '';
  categoryFieldValues.value = Object.fromEntries(
    (categories.value.find((category) => category.id === point?.categoryId)?.fields || []).map(
      (field) => [field.key, String(point?.attributes?.[field.key] ?? '')],
    ),
  );
  editingComponent.value = null;
  addingComponent.value = false;
  newComponentName.value = '';
  suggestedRegionIds.value = [];
  suggestedRegions.value = [];
  regionQuery.value = '';
  regionResults.value = [];
  saveState.value = false;
  baseline.value = formSnapshot();
}

function componentSnapshot() {
  return JSON.stringify([
    editingComponent.value?.name,
    editingComponent.value?.regionIds,
    componentAliasesText.value,
    componentLongitudeText.value,
    componentLatitudeText.value,
    componentLocationNoteText.value,
    componentDescriptionText.value,
    componentFieldValues.value,
  ]);
}

function resetComponent(component: Component) {
  editingComponent.value = structuredClone(toRaw(component));
  componentAliasesText.value = component.aliases?.join('\n') || '';
  componentLongitudeText.value = component.coordinates ? String(component.coordinates[0]) : '';
  componentLatitudeText.value = component.coordinates ? String(component.coordinates[1]) : '';
  componentLocationNoteText.value = component.locationNote || '';
  componentDescriptionText.value = component.description || '';
  componentFieldValues.value = Object.fromEntries(
    categoryFields.value.map((field) => [
      field.key,
      String(component.attributes?.[field.key] ?? ''),
    ]),
  );
  componentBaseline.value = componentSnapshot();
  componentRegionQuery.value = '';
  componentRegionResults.value = [];
  componentSuggestedRegionIds.value = [];
  componentSuggestedRegions.value = [];
}

function openComponent(componentId: string) {
  if (busy.value || selecting.value || editingComponent.value?.id === componentId) return;
  if (componentDirty.value && !window.confirm('放弃未保存的子项修改？')) return;
  const current = draft.value?.components?.find((value) => value.id === componentId);
  if (!current) {
    error.value = '子项已不存在，请重新载入点位。';
    return;
  }
  resetComponent(current);
  panel.value = 'edit';
  nextTick(() => document.querySelector('.admin-editor-scroll')?.scrollTo({ top: 0 }));
}

function backToPoint() {
  if (componentDirty.value && !window.confirm('放弃未保存的子项修改？')) return;
  editingComponent.value = null;
  nextTick(() => document.querySelector('.admin-editor-scroll')?.scrollTo({ top: 0 }));
}

let listRequest = 0;
async function loadList() {
  const requestId = ++listRequest;
  loading.value = true;
  error.value = '';
  try {
    const params = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) });
    if (query.value.trim()) params.set('q', query.value.trim());
    if (categoryId.value) params.set('categoryId', categoryId.value);
    if (locationStatus.value) params.set('locationStatus', locationStatus.value);
    const result = await request('/admin/china/points?' + params);
    if (requestId !== listRequest) return;
    items.value = result.items;
    total.value = result.total;
    categories.value = result.categories;
    revision.value = Number(result.adminRevision || 0);
    undoAvailable.value = result.undoAvailable === true;
  } catch (cause) {
    if (requestId === listRequest) error.value = String(cause).replace(/^Error:\s*/, '');
  } finally {
    if (requestId === listRequest) loading.value = false;
  }
}

async function selectPoint(id: string, open = true, force = false) {
  if ((busy.value && !force) || selecting.value) return;
  if (!force && draft.value?.id === id) {
    panel.value = 'edit';
    return;
  }
  if (!force && !discardChanges()) return;
  selecting.value = true;
  error.value = '';
  try {
    const point = (await request('/admin/china/points/' + encodeURIComponent(id))) as Point;
    selectedId.value = id;
    revision.value = point.adminRevision;
    resetForm(point);
    if (open) panel.value = 'edit';
    await nextTick();
    document.querySelector('.admin-editor-scroll')?.scrollTo({ top: 0 });
  } catch (cause) {
    error.value = String(cause).replace(/^Error:\s*/, '');
  } finally {
    selecting.value = false;
  }
}

async function createPoint() {
  const name = createName.value.trim();
  if (!name) {
    error.value = '请填写新点位名称。';
    return;
  }
  const category = createCategoryId.value;
  if (!category || !discardChanges()) return;
  busy.value = true;
  error.value = '';
  try {
    const point = (await request('/admin/china/points', {
      method: 'POST',
      body: JSON.stringify({
        name: name.trim(),
        categoryId: category,
        expectedRevision: revision.value,
      }),
    })) as Point;
    revision.value = point.adminRevision;
    creating.value = false;
    createName.value = '';
    await loadList();
    selectedId.value = point.id;
    resetForm(point);
    panel.value = 'edit';
  } catch (cause) {
    error.value = String(cause).replace(/^Error:\s*/, '');
  } finally {
    busy.value = false;
  }
}

function parsedAdvanced() {
  try {
    const value = JSON.parse(advancedText.value || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw Error('高级字段必须是 JSON 对象');
    return value;
  } catch (cause) {
    throw Error('高级字段 JSON 无效：' + String(cause).replace(/^Error:\s*/, ''));
  }
}

async function save() {
  if (!draft.value || busy.value || selecting.value) return;
  const name = draft.value.name.trim();
  if (!name) {
    error.value = '点位名称不能为空。';
    return;
  }
  const nextCoordinate = coordinate.value;
  if (longitudeText.value || latitudeText.value) {
    if (!nextCoordinate || Math.abs(nextCoordinate[0]) > 180 || Math.abs(nextCoordinate[1]) > 90) {
      error.value = '经纬度必须是有效的经度和纬度。';
      return;
    }
  }
  busy.value = true;
  error.value = '';
  try {
    const advanced = parsedAdvanced();
    const updated = (await request('/admin/china/points/' + encodeURIComponent(draft.value.id), {
      method: 'PATCH',
      body: JSON.stringify({
        name,
        aliases: aliasesText.value
          .split(/\r?\n|,/)
          .map((value) => value.trim())
          .filter(Boolean),
        description: descriptionText.value,
        regionIds: draft.value.regionIds,
        ...advanced,
        attributes: { ...(advanced.attributes || {}), ...categoryFieldValues.value },
        coordinates: nextCoordinate,
        method: 'admin-map',
        note: locationNoteText.value,
        expectedRevision: draft.value.adminRevision,
      }),
    })) as Point;
    revision.value = updated.adminRevision;
    resetForm(updated);
    saveState.value = true;
    await loadList();
  } catch (cause) {
    error.value = String(cause).replace(/^Error:\s*/, '');
  } finally {
    busy.value = false;
  }
}

async function saveComponent() {
  if (!draft.value || !editingComponent.value || busy.value || selecting.value) return;
  if (!editingComponent.value.name.trim()) {
    error.value = '子项名称不能为空。';
    return;
  }
  if ((componentLongitudeText.value || componentLatitudeText.value) && !componentCoordinate.value) {
    error.value = '经纬度必须是有效的经度和纬度。';
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    const updated = (await request(
      `/admin/china/points/${encodeURIComponent(draft.value.id)}/components/${encodeURIComponent(editingComponent.value.id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          name: editingComponent.value.name.trim(),
          aliases: componentAliasesText.value
            .split(/\r?\n|,/)
            .map((value) => value.trim())
            .filter(Boolean),
          description: componentDescriptionText.value,
          regionIds: editingComponent.value.regionIds,
          coordinates: componentCoordinate.value,
          note: componentLocationNoteText.value,
          attributes: {
            ...(editingComponent.value.attributes || {}),
            ...componentFieldValues.value,
          },
          expectedRevision: draft.value.adminRevision,
        }),
      },
    )) as Component;
    const refreshed = (await request(
      '/admin/china/points/' + encodeURIComponent(draft.value.id),
    )) as Point;
    const updatedComponent =
      refreshed.components?.find((component) => component.id === updated.id) || updated;
    revision.value = refreshed.adminRevision;
    resetForm(refreshed);
    resetComponent(updatedComponent);
    saveState.value = true;
    await loadList();
  } catch (cause) {
    error.value = String(cause).replace(/^Error:\s*/, '');
  } finally {
    busy.value = false;
  }
}

async function createComponent() {
  if (!draft.value || busy.value || selecting.value) return;
  const name = newComponentName.value.trim();
  if (!name) return;
  if (!discardChanges()) return;
  busy.value = true;
  error.value = '';
  try {
    const current = (await request(
      '/admin/china/points/' + encodeURIComponent(draft.value.id),
    )) as Point;
    const created = (await request(
      `/admin/china/points/${encodeURIComponent(current.id)}/components`,
      {
        method: 'POST',
        body: JSON.stringify({ name, expectedRevision: current.adminRevision }),
      },
    )) as Component;
    const refreshed = (await request(
      '/admin/china/points/' + encodeURIComponent(current.id),
    )) as Point;
    resetForm(refreshed);
    const component = refreshed.components?.find((value) => value.id === created.id) || created;
    resetComponent(component);
    revision.value = refreshed.adminRevision;
    addingComponent.value = false;
    newComponentName.value = '';
    await loadList();
  } catch (cause) {
    error.value = String(cause).replace(/^Error:\s*/, '');
  } finally {
    busy.value = false;
  }
}

async function deleteComponent(component: Component) {
  if (!draft.value || busy.value || selecting.value) return;
  if (!discardChanges()) return;
  if (!window.confirm(`删除组成地点“${component.name}”？`)) return;
  busy.value = true;
  error.value = '';
  try {
    const current = (await request(
      '/admin/china/points/' + encodeURIComponent(draft.value.id),
    )) as Point;
    await request(
      `/admin/china/points/${encodeURIComponent(current.id)}/components/${encodeURIComponent(component.id)}`,
      {
        method: 'DELETE',
        body: JSON.stringify({ expectedRevision: current.adminRevision }),
      },
    );
    const refreshed = (await request(
      '/admin/china/points/' + encodeURIComponent(current.id),
    )) as Point;
    resetForm(refreshed);
    revision.value = refreshed.adminRevision;
    await loadList();
  } catch (cause) {
    error.value = String(cause).replace(/^Error:\s*/, '');
  } finally {
    busy.value = false;
  }
}

async function searchComponentRegions() {
  const query = componentRegionQuery.value.trim();
  const componentId = editingComponent.value?.id;
  componentRegionResults.value = [];
  if (!query) return;
  try {
    const results = (await request(
      '/admin/china/regions?q=' + encodeURIComponent(query),
    )) as Region[];
    if (editingComponent.value?.id === componentId && componentRegionQuery.value.trim() === query)
      componentRegionResults.value = results;
  } catch (cause) {
    error.value = String(cause).replace(/^Error:\s*/, '');
  }
}

async function resolveComponentRegions(ids: string[]) {
  componentSuggestedRegions.value = [];
  if (!ids.length) return;
  const componentId = editingComponent.value?.id;
  const position = componentCoordinate.value?.join(',');
  try {
    const regions = (await request(
      '/admin/china/regions?ids=' + encodeURIComponent(ids.join(',')),
    )) as Region[];
    if (
      editingComponent.value?.id === componentId &&
      componentCoordinate.value?.join(',') === position
    )
      componentSuggestedRegions.value = regions;
  } catch (cause) {
    error.value = String(cause).replace(/^Error:\s*/, '');
  }
}

function addComponentRegion(region: Region) {
  if (!editingComponent.value) return;
  editingComponent.value.regionIds = [...new Set([...editingComponent.value.regionIds, region.id])];
  if (!editingComponent.value.regions.some((value) => value.id === region.id))
    editingComponent.value.regions.push(region);
  componentRegionQuery.value = '';
  componentRegionResults.value = [];
}

function removeComponentRegion(id: string) {
  if (!editingComponent.value) return;
  editingComponent.value.regionIds = editingComponent.value.regionIds.filter(
    (value) => value !== id,
  );
  editingComponent.value.regions = editingComponent.value.regions.filter(
    (region) => region.id !== id,
  );
}

function applyComponentSuggestion(replace = false) {
  if (!editingComponent.value || !componentSuggestedRegionIds.value.length) return;
  const region =
    componentSuggestedRegions.value.find((value) => value.level === 'county') ||
    componentSuggestedRegions.value.find((value) => value.level === 'city') ||
    componentSuggestedRegions.value[0];
  if (!region) return;
  editingComponent.value.regionIds = replace
    ? [region.id]
    : [...new Set([...editingComponent.value.regionIds, region.id])];
  editingComponent.value.regions = replace
    ? [region]
    : [...editingComponent.value.regions.filter((value) => value.id !== region.id), region];
  componentSuggestedRegionIds.value = [];
  componentSuggestedRegions.value = [];
}

function clearComponentMap() {
  componentLongitudeText.value = '';
  componentLatitudeText.value = '';
  componentSuggestedRegionIds.value = [];
  componentSuggestedRegions.value = [];
}

async function removePoint() {
  if (!draft.value) return;
  const point = draft.value;
  const region = point.regions.map((value) => value.path || value.name).join(' / ') || '未关联区划';
  const children = point.componentCount
    ? `其下 ${point.componentCount} 个组成地点也会一并清理。`
    : '';
  if (!window.confirm(`确定删除“${point.name}”（${region}）？${children}可用撤销恢复。`)) return;
  busy.value = true;
  try {
    await request('/admin/china/points/' + encodeURIComponent(draft.value.id), {
      method: 'DELETE',
      body: JSON.stringify({ expectedRevision: draft.value.adminRevision }),
    });
    selectedId.value = '';
    resetForm(null);
    panel.value = 'list';
    await loadList();
  } catch (cause) {
    error.value = String(cause).replace(/^Error:\s*/, '');
  } finally {
    busy.value = false;
  }
}

async function undoLast() {
  if (busy.value || selecting.value || !undoAvailable.value || !discardChanges()) return;
  if (!window.confirm('撤销最近一次管理操作？')) return;
  busy.value = true;
  error.value = '';
  try {
    const result = (await request('/admin/china/undo', { method: 'POST' })) as {
      id: string | null;
      operation: 'create' | 'update' | 'location' | 'delete';
      revision: number;
    };
    revision.value = Number(result.revision || 0);
    await loadList();
    if (result.operation === 'create') {
      if (result.id === selectedId.value) {
        selectedId.value = '';
        resetForm(null);
        panel.value = 'list';
      } else if (draft.value?.id) {
        await selectPoint(draft.value.id, true, true);
      }
    } else {
      const restoreId = result.operation === 'delete' ? result.id : result.id || draft.value?.id;
      if (restoreId) await selectPoint(restoreId, true, true);
    }
  } catch (cause) {
    error.value = String(cause).replace(/^Error:\s*/, '');
  } finally {
    busy.value = false;
  }
}

async function searchRegions() {
  const query = regionQuery.value.trim();
  const pointId = draft.value?.id;
  regionResults.value = [];
  if (!query) return;
  try {
    const results = (await request(
      '/admin/china/regions?q=' + encodeURIComponent(query),
    )) as Region[];
    if (draft.value?.id === pointId && regionQuery.value.trim() === query)
      regionResults.value = results;
  } catch (cause) {
    error.value = String(cause).replace(/^Error:\s*/, '');
  }
}

async function resolveRegions(ids: string[]) {
  suggestedRegions.value = [];
  if (!ids.length) return;
  const pointId = draft.value?.id;
  const position = coordinate.value?.join(',');
  try {
    const regions = (await request(
      '/admin/china/regions?ids=' + encodeURIComponent(ids.join(',')),
    )) as Region[];
    if (draft.value?.id === pointId && coordinate.value?.join(',') === position)
      suggestedRegions.value = regions;
  } catch (cause) {
    error.value = String(cause).replace(/^Error:\s*/, '');
  }
}

function addRegion(region: Region) {
  if (!draft.value) return;
  draft.value.regionIds = [...new Set([...draft.value.regionIds, region.id])];
  if (!draft.value.regions.some((value) => value.id === region.id))
    draft.value.regions.push(region);
  regionQuery.value = '';
  regionResults.value = [];
}
function removeRegion(id: string) {
  if (!draft.value) return;
  draft.value.regionIds = draft.value.regionIds.filter((value) => value !== id);
  draft.value.regions = draft.value.regions.filter((value) => value.id !== id);
}
function applySuggestion() {
  if (!draft.value || !suggestedRegionIds.value.length) return;
  const id = suggestedRegion.value?.id;
  if (!id) return;
  draft.value.regionIds = [...new Set([...draft.value.regionIds, id])];
  const suggested = suggestedRegions.value.find((region) => region.id === id);
  if (suggested && !draft.value.regions.some((region) => region.id === id))
    draft.value.regions.push(suggested);
  suggestedRegionIds.value = [];
  suggestedRegions.value = [];
}
function replaceWithSuggestion() {
  if (!draft.value || !suggestedRegionIds.value.length) return;
  const id = suggestedRegion.value?.id;
  if (!id) return;
  draft.value.regionIds = [id];
  const suggested = suggestedRegions.value.find((region) => region.id === id);
  draft.value.regions = suggested
    ? [suggested]
    : draft.value.regions.filter((region) => region.id === id);
  suggestedRegionIds.value = [];
  suggestedRegions.value = [];
}
function mapPick(coordinates: [number, number], ids: string[]) {
  if (!draft.value || busy.value || selecting.value) return;
  if (editingComponent.value) {
    componentLongitudeText.value = String(coordinates[0]);
    componentLatitudeText.value = String(coordinates[1]);
    componentSuggestedRegionIds.value = ids;
    void resolveComponentRegions(ids);
    return;
  }
  panel.value = 'edit';
  longitudeText.value = String(coordinates[0]);
  latitudeText.value = String(coordinates[1]);
  suggestedRegionIds.value = ids;
  void resolveRegions(ids);
}
function clearMap() {
  longitudeText.value = '';
  latitudeText.value = '';
  suggestedRegionIds.value = [];
  suggestedRegions.value = [];
}

async function openFieldManager() {
  if (!draft.value) return;
  const id = draft.value.id;
  if (componentDirty.value && !window.confirm('放弃未保存的子项修改？')) return;
  if (dirty.value && !window.confirm('字段管理会重新载入当前点位。放弃未保存的修改？')) return;
  if (dirty.value) await selectPoint(id, false, true);
  if (editingComponent.value) editingComponent.value = null;
  fieldLabel.value = '';
  fieldKey.value = '';
  fieldsDialog.value = true;
}

async function addCategoryField() {
  if (!draft.value || busy.value) return;
  const label = fieldLabel.value.trim();
  const key = fieldKey.value.trim();
  if (!label || !key) {
    error.value = '请填写字段名称和 JSON 保存名。';
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    const result = await request(
      `/admin/china/categories/${encodeURIComponent(draft.value.categoryId)}/fields`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'add',
          label,
          key,
          targetId: draft.value.id,
          expectedRevision: revision.value,
        }),
      },
    );
    revision.value = result.adminRevision;
    fieldLabel.value = '';
    fieldKey.value = '';
    await loadList();
    await selectPoint(draft.value.id, false, true);
  } catch (cause) {
    error.value = String(cause).replace(/^Error:\s*/, '');
  } finally {
    busy.value = false;
  }
}

async function removeCategoryField(field: CategoryField) {
  if (!draft.value || busy.value) return;
  if (!window.confirm(`删除“${field.label}”并清除该类点位和子项中的保存值？`)) return;
  busy.value = true;
  error.value = '';
  try {
    const result = await request(
      `/admin/china/categories/${encodeURIComponent(draft.value.categoryId)}/fields`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'remove',
          key: field.key,
          targetId: draft.value.id,
          expectedRevision: revision.value,
        }),
      },
    );
    revision.value = result.adminRevision;
    await loadList();
    await selectPoint(draft.value.id, false, true);
  } catch (cause) {
    error.value = String(cause).replace(/^Error:\s*/, '');
  } finally {
    busy.value = false;
  }
}

function restoreComponent() {
  const component = draft.value?.components?.find(
    (value) => value.id === editingComponent.value?.id,
  );
  if (component && window.confirm('放弃未保存的子项修改？')) resetComponent(component);
}

let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(query, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page.value = 1;
    void loadList();
  }, 180);
});
watch([categoryId, locationStatus], () => {
  page.value = 1;
  void loadList();
});
watch(dirty, (changed) => {
  if (changed) saveState.value = false;
});
function preventUnload(event: BeforeUnloadEvent) {
  if (dirty.value || componentDirty.value) {
    event.preventDefault();
    event.returnValue = '';
  }
}
onMounted(() => window.addEventListener('beforeunload', preventUnload));
onBeforeUnmount(() => {
  clearTimeout(searchTimer);
  window.removeEventListener('beforeunload', preventUnload);
});
onMounted(() => void loadList());
</script>

<template>
  <div class="admin-points-page">
    <header class="admin-topbar">
      <div class="admin-title">
        <PointIcon
          name="compass"
          :size="21"
        />
        <h1>点位修正</h1>
      </div>
      <div class="admin-top-actions">
        <button
          class="admin-icon-button"
          type="button"
          title="撤销上一步"
          aria-label="撤销上一步"
          :disabled="busy || loading || selecting || !undoAvailable"
          @click="undoLast"
        >
          <PointIcon
            name="undo"
            :size="17"
          />
        </button>
        <button
          class="admin-icon-button"
          type="button"
          title="重新载入"
          aria-label="重新载入"
          :disabled="busy || loading || selecting"
          @click="reload"
        >
          <PointIcon
            name="refresh"
            :size="17"
            :class="{ 'admin-spinning': loading }"
          />
        </button>
        <button
          type="button"
          class="admin-new"
          :disabled="busy || !categories.length"
          @click="openCreate"
        >
          <PointIcon
            name="plus"
            :size="16"
          />新建
        </button>
      </div>
    </header>
    <div class="admin-workspace">
      <section
        class="admin-map-panel"
        aria-label="点位地图"
      >
        <AdminPointMap
          :coordinates="mapCoordinate"
          :focus-key="mapFocusKey"
          :highlight-region-ids="mapRegionIds"
          :readonly="!draft || busy || selecting"
          @pick="mapPick"
          @clear="editingComponent ? clearComponentMap() : clearMap()"
        />
      </section>
      <aside
        class="admin-side-panel"
        :aria-busy="selecting"
      >
        <div
          class="admin-panel-tabs"
          role="tablist"
          aria-label="点位管理"
        >
          <button
            id="admin-list-tab"
            type="button"
            role="tab"
            :aria-selected="panel === 'list'"
            aria-controls="admin-list"
            @click="panel = 'list'"
          >
            <PointIcon
              name="list"
              :size="16"
            />点位<span class="admin-count">{{ total.toLocaleString() }}</span>
          </button>
          <button
            id="admin-edit-tab"
            type="button"
            role="tab"
            :aria-selected="panel === 'edit'"
            aria-controls="admin-edit"
            :disabled="!draft"
            @click="panel = 'edit'"
          >
            编辑<span
              v-if="dirty"
              class="admin-dirty-dot"
              role="img"
              aria-label="未保存"
            />
          </button>
        </div>
        <div
          v-if="error"
          class="admin-alert"
          role="alert"
        >
          <PointIcon
            name="info"
            :size="16"
          /><span>{{ error }}</span
          ><button
            class="admin-icon-button"
            type="button"
            aria-label="关闭错误"
            @click="error = ''"
          >
            <PointIcon
              name="close"
              :size="14"
            />
          </button>
        </div>
        <section
          v-show="panel === 'list'"
          id="admin-list"
          class="admin-list-panel"
          role="tabpanel"
          aria-labelledby="admin-list-tab"
        >
          <div class="admin-filter-bar">
            <div class="admin-search">
              <PointIcon
                name="search"
                :size="17"
              /><input
                v-model="query"
                type="search"
                placeholder="搜索点位"
                aria-label="搜索名称、别名或 ID"
              />
            </div>
            <div class="admin-filter-row">
              <select
                v-model="categoryId"
                aria-label="类别"
              >
                <option value="">全部类别</option>
                <option
                  v-for="category in categories"
                  :key="category.id"
                  :value="category.id"
                >
                  {{ category.name }}
                </option></select
              ><select
                v-model="locationStatus"
                aria-label="位置状态"
              >
                <option value="">全部位置</option>
                <option value="missing">未定位</option>
                <option value="available">已有位置</option>
                <option value="invalid">位置异常</option>
                <option value="incomplete">未完成全部定位</option>
              </select>
            </div>
          </div>
          <div
            class="admin-point-list"
            :aria-busy="loading"
          >
            <div
              v-if="loading && !items.length"
              class="admin-skeletons"
              aria-label="载入中"
            >
              <div
                v-for="n in 8"
                :key="n"
                class="admin-skeleton"
              />
            </div>
            <p
              v-else-if="!error && !loading && !items.length"
              class="admin-empty"
            >
              无匹配点位
            </p>
            <button
              v-for="point in items"
              :key="point.id"
              type="button"
              class="admin-point-row"
              :class="{ active: point.id === selectedId }"
              :disabled="busy || selecting"
              :aria-pressed="point.id === selectedId"
              @click="selectPoint(point.id)"
            >
              <span
                class="admin-row-marker"
                :class="'status-' + point.coordinateStatus"
                ><PointIcon
                  name="location"
                  :size="18"
              /></span>
              <span class="admin-point-row-main"
                ><strong>{{ point.name }}</strong
                ><span
                  >{{ point.categoryName }} ·
                  {{
                    point.regions.map((region) => region.path || region.name).join(' / ') ||
                    '未关联区划'
                  }}
                  <template v-if="point.componentCount">
                    · {{ point.componentCount }} 项</template
                  ></span
                ></span
              >
              <span
                class="admin-status"
                :class="'status-' + point.coordinateStatus"
                >{{ coordinateStatusLabel(point.coordinateStatus) }}</span
              >
              <PointIcon
                name="arrow"
                :size="15"
                class="admin-row-arrow"
              />
            </button>
          </div>
          <footer class="admin-pagination">
            <span
              >{{ page }} <span class="admin-muted">/ {{ totalPages }}</span></span
            >
            <div>
              <button
                class="admin-icon-button"
                type="button"
                aria-label="上一页"
                :disabled="page <= 1 || loading"
                @click="
                  page--;
                  loadList();
                "
              >
                <PointIcon
                  name="back"
                  :size="17"
                /></button
              ><button
                class="admin-icon-button"
                type="button"
                aria-label="下一页"
                :disabled="page >= totalPages || loading"
                @click="
                  page++;
                  loadList();
                "
              >
                <PointIcon
                  name="arrow"
                  :size="17"
                />
              </button>
            </div>
          </footer>
        </section>
        <form
          v-if="draft"
          v-show="panel === 'edit'"
          id="admin-edit"
          class="admin-editor-panel"
          role="tabpanel"
          aria-labelledby="admin-edit-tab"
          @submit.prevent="editingComponent ? saveComponent() : save()"
        >
          <div class="admin-editor-heading">
            <div>
              <span class="admin-eyebrow">{{ draft.categoryName }}</span>
              <h2>{{ editingComponent?.name || draft.name }}</h2>
            </div>
            <span
              class="admin-status"
              :class="'status-' + displayedCoordinateStatus"
              >{{ coordinateStatusLabel(displayedCoordinateStatus) }}</span
            >
          </div>
          <fieldset
            v-if="editingComponent"
            class="admin-editor-scroll"
            :disabled="busy || selecting"
          >
            <section class="admin-field-section">
              <div class="admin-section-heading">
                <button
                  type="button"
                  class="admin-text-button"
                  @click="backToPoint"
                >
                  <PointIcon
                    name="back"
                    :size="14"
                  />返回点位
                </button>
                <span class="admin-muted">组成地点</span>
              </div>
              <nav
                v-if="(draft.components || []).length > 1"
                class="admin-component-nav"
                aria-label="组成地点"
              >
                <button
                  v-for="component in draft.components || []"
                  :key="component.id"
                  type="button"
                  :class="{ active: editingComponent.id === component.id }"
                  @click.stop="openComponent(component.id)"
                >
                  {{ component.name }}
                </button>
              </nav>
              <label
                >名称<input
                  v-model="editingComponent.name"
                  required
              /></label>
              <label
                >别名<textarea
                  v-model="componentAliasesText"
                  rows="2"
                />
              </label>
            </section>
            <section class="admin-field-section">
              <div class="admin-section-heading">
                <h3>位置</h3>
                <button
                  v-if="componentLongitudeText || componentLatitudeText"
                  type="button"
                  class="admin-text-button"
                  @click="clearComponentMap"
                >
                  清除
                </button>
              </div>
              <div class="admin-field-row">
                <label
                  >经度<input
                    v-model="componentLongitudeText"
                    inputmode="decimal"
                /></label>
                <label
                  >纬度<input
                    v-model="componentLatitudeText"
                    inputmode="decimal"
                /></label>
              </div>
              <div class="admin-region-editor">
                <label>所属政区</label>
                <div
                  v-if="editingComponent.regionIds.length"
                  class="admin-region-chips"
                >
                  <span
                    v-for="id in editingComponent.regionIds"
                    :key="id"
                    class="admin-region-chip"
                  >
                    <span>{{
                      editingComponent.regions.find((region) => region.id === id)?.path || id
                    }}</span>
                    <button
                      class="admin-icon-button"
                      type="button"
                      aria-label="移除政区"
                      @click="removeComponentRegion(id)"
                    >
                      <PointIcon
                        name="close"
                        :size="12"
                      />
                    </button>
                  </span>
                </div>
                <div
                  v-if="componentSuggestedRegions.length"
                  class="admin-suggestion"
                >
                  <div>
                    <PointIcon
                      name="location"
                      :size="15"
                    /><span>{{
                      (
                        componentSuggestedRegions.find((region) => region.level === 'county') ||
                        componentSuggestedRegions[0]
                      )?.path
                    }}</span>
                  </div>
                  <div class="admin-suggestion-actions">
                    <button
                      type="button"
                      @click="applyComponentSuggestion()"
                    >
                      添加关联
                    </button>
                    <button
                      v-if="editingComponent.regionIds.length"
                      type="button"
                      @click="applyComponentSuggestion(true)"
                    >
                      替换关联
                    </button>
                  </div>
                </div>
                <input
                  v-model="componentRegionQuery"
                  placeholder="搜索政区"
                  autocomplete="off"
                  @input="searchComponentRegions"
                />
                <div
                  v-if="componentRegionResults.length"
                  class="admin-region-results"
                >
                  <button
                    v-for="region in componentRegionResults"
                    :key="region.id"
                    type="button"
                    @click="addComponentRegion(region)"
                  >
                    <span>{{ region.path }}</span
                    ><PointIcon
                      name="plus"
                      :size="14"
                    />
                  </button>
                </div>
              </div>
              <label
                >位置备注<textarea
                  v-model="componentLocationNoteText"
                  rows="2"
                />
              </label>
            </section>
            <section class="admin-field-section">
              <div class="admin-section-heading"><h3>资料</h3></div>
              <label
                >简介<textarea
                  v-model="componentDescriptionText"
                  rows="4"
                />
              </label>
              <label
                v-for="field in categoryFields"
                :key="field.key"
                >{{ field.label }}<input v-model="componentFieldValues[field.key]"
              /></label>
            </section>
          </fieldset>
          <fieldset
            v-else
            class="admin-editor-scroll"
            :disabled="busy || selecting"
          >
            <section class="admin-field-section">
              <div class="admin-section-heading">
                <h3>位置</h3>
                <button
                  v-if="longitudeText || latitudeText"
                  type="button"
                  class="admin-text-button"
                  @click="clearMap"
                >
                  清除
                </button>
              </div>
              <div class="admin-field-row">
                <label
                  >经度<input
                    v-model="longitudeText"
                    inputmode="decimal" /></label
                ><label
                  >纬度<input
                    v-model="latitudeText"
                    inputmode="decimal"
                /></label>
              </div>
              <div class="admin-region-editor">
                <label for="admin-region-search">所属政区</label>
                <div
                  v-if="draft.regionIds.length"
                  class="admin-region-chips"
                >
                  <span
                    v-for="id in draft.regionIds"
                    :key="id"
                    class="admin-region-chip"
                    ><span>{{ draft.regions.find((region) => region.id === id)?.path || id }}</span
                    ><button
                      class="admin-icon-button"
                      type="button"
                      :aria-label="
                        '移除 ' + (draft.regions.find((region) => region.id === id)?.name || id)
                      "
                      @click="removeRegion(id)"
                    >
                      <PointIcon
                        name="close"
                        :size="12"
                      /></button
                  ></span>
                </div>
                <div
                  v-if="suggestedRegion && !draft.regionIds.includes(suggestedRegion.id)"
                  class="admin-suggestion"
                >
                  <div>
                    <PointIcon
                      name="location"
                      :size="15"
                    /><span>{{ suggestedRegion.path }}</span>
                  </div>
                  <div class="admin-suggestion-actions">
                    <button
                      type="button"
                      @click="applySuggestion"
                    >
                      添加关联</button
                    ><button
                      v-if="draft.regionIds.length"
                      type="button"
                      @click="replaceWithSuggestion"
                    >
                      替换关联
                    </button>
                  </div>
                </div>
                <input
                  id="admin-region-search"
                  v-model="regionQuery"
                  placeholder="搜索政区"
                  autocomplete="off"
                  @input="searchRegions"
                />
                <div
                  v-if="regionResults.length"
                  class="admin-region-results"
                >
                  <button
                    v-for="region in regionResults"
                    :key="region.id"
                    type="button"
                    @click="addRegion(region)"
                  >
                    <span>{{ region.path }}</span
                    ><PointIcon
                      name="plus"
                      :size="14"
                    />
                  </button>
                </div>
              </div>
              <label
                >位置备注<textarea
                  v-model="locationNoteText"
                  rows="2"
                />
              </label>
              <p
                v-if="draft.coordinateStatus === 'invalid' && !coordinate"
                class="admin-inline-warning"
              >
                坐标异常：{{ JSON.stringify(draft.attributes?.coordinates) }}
              </p>
              <p
                v-if="draft.pending?.reason && !coordinate"
                class="admin-inline-warning"
              >
                {{ draft.pending.reason }}
              </p>
            </section>
            <section class="admin-field-section">
              <div class="admin-section-heading"><h3>资料</h3></div>
              <label
                >名称<input
                  v-model="draft.name"
                  required /></label
              ><label
                >别名<textarea
                  v-model="aliasesText"
                  rows="2"
                /></label
              ><label
                >简介<textarea
                  v-model="descriptionText"
                  rows="3"
                />
              </label>
              <label
                v-for="field in categoryFields"
                :key="field.key"
                >{{ field.label }}<input v-model="categoryFieldValues[field.key]"
              /></label>
              <div class="admin-section-heading admin-field-tools">
                <span class="admin-muted">类别字段</span>
                <button
                  type="button"
                  class="admin-text-button"
                  @click="openFieldManager"
                >
                  管理
                </button>
              </div>
            </section>
            <section class="admin-field-section admin-components-section">
              <div class="admin-section-heading">
                <h3>组成地点</h3>
                <div class="admin-component-tools">
                  <span class="admin-muted">{{ (draft.components || []).length }}</span>
                  <button
                    class="admin-icon-button"
                    type="button"
                    title="添加组成地点"
                    aria-label="添加组成地点"
                    :disabled="busy || selecting"
                    @click="
                      addingComponent = !addingComponent;
                      newComponentName = '';
                    "
                  >
                    <PointIcon
                      :name="addingComponent ? 'close' : 'plus'"
                      :size="15"
                    />
                  </button>
                </div>
              </div>
              <form
                v-if="addingComponent"
                class="admin-component-add"
                @submit.prevent="createComponent"
              >
                <input
                  v-model="newComponentName"
                  aria-label="组成地点名称"
                  placeholder="名称"
                  autofocus
                />
                <button
                  class="admin-icon-button"
                  type="submit"
                  aria-label="确认添加"
                  :disabled="busy || !newComponentName.trim()"
                >
                  <PointIcon
                    name="check"
                    :size="15"
                  />
                </button>
              </form>
              <div
                v-if="draft.components?.length"
                class="admin-component-list"
              >
                <div
                  v-for="component in draft.components || []"
                  :key="component.id"
                  class="admin-component-row"
                >
                  <button
                    type="button"
                    class="admin-component-link"
                    :disabled="busy || selecting"
                    @click.stop="openComponent(component.id)"
                  >
                    <span>
                      <strong>{{ component.name }}</strong>
                      <small>{{
                        component.regions.map((region) => region.path || region.name).join(' / ') ||
                        '未关联政区'
                      }}</small>
                    </span>
                    <span class="admin-component-end">
                      <small
                        :class="component.coordinates ? 'status-available' : 'status-missing'"
                        >{{ component.coordinates ? '已定位' : '未定位' }}</small
                      >
                      <PointIcon
                        name="arrow"
                        :size="14"
                      />
                    </span>
                  </button>
                  <button
                    class="admin-icon-button admin-component-delete"
                    type="button"
                    :aria-label="'删除 ' + component.name"
                    title="删除组成地点"
                    :disabled="busy || selecting"
                    @click="deleteComponent(component)"
                  >
                    <PointIcon
                      name="close"
                      :size="14"
                    />
                  </button>
                </div>
              </div>
              <p
                v-else
                class="admin-muted admin-component-empty"
              >
                暂无组成地点
              </p>
            </section>
            <details
              :key="draft.id"
              class="admin-advanced"
            >
              <summary>
                更多资料<PointIcon
                  name="chevron"
                  :size="15"
                />
              </summary>
              <dl class="admin-record-meta">
                <div>
                  <dt>ID</dt>
                  <dd>{{ draft.id }}</dd>
                </div>
                <div v-if="draft.place">
                  <dt>关联场所</dt>
                  <dd>{{ draft.place.name || draft.place.id }}</dd>
                </div>
              </dl>
              <textarea
                v-model="advancedText"
                rows="12"
                spellcheck="false"
                aria-label="其他资料 JSON"
              />
            </details>
          </fieldset>
          <footer class="admin-editor-footer">
            <button
              v-if="!editingComponent"
              type="button"
              class="admin-delete"
              :disabled="busy || selecting"
              @click="removePoint"
            >
              删除
            </button>
            <div>
              <button
                v-if="editingComponent ? componentDirty : dirty"
                type="button"
                :disabled="busy || selecting"
                @click="editingComponent ? restoreComponent() : restore()"
              >
                还原</button
              ><button
                class="admin-save"
                type="submit"
                :disabled="busy || selecting || (editingComponent ? !componentDirty : !dirty)"
              >
                <PointIcon
                  v-if="saveState && !(editingComponent ? componentDirty : dirty)"
                  name="check"
                  :size="16"
                />{{
                  busy
                    ? '保存中…'
                    : saveState && !(editingComponent ? componentDirty : dirty)
                      ? '已保存'
                      : '保存'
                }}
              </button>
            </div>
          </footer>
        </form>
      </aside>
    </div>
    <AppDialog
      v-if="creating"
      panel-class="admin-create-dialog"
      title="新建点位"
      @close="!busy && (creating = false)"
      ><form
        class="admin-create-form"
        @submit.prevent="createPoint"
      >
        <label
          >名称<input
            v-model="createName"
            required
            autofocus /></label
        ><label
          >类别<select v-model="createCategoryId">
            <option
              v-for="category in categories"
              :key="category.id"
              :value="category.id"
            >
              {{ category.name }}
            </option>
          </select></label
        >
        <p
          v-if="error"
          class="admin-inline-warning"
          role="alert"
        >
          {{ error }}
        </p>
        <div class="admin-create-actions">
          <button
            type="button"
            :disabled="busy"
            @click="creating = false"
          >
            取消</button
          ><button
            type="submit"
            class="admin-save"
            :disabled="busy || !createName.trim()"
          >
            创建
          </button>
        </div>
      </form></AppDialog
    >
    <AppDialog
      v-if="fieldsDialog"
      panel-class="admin-fields-dialog"
      title="类别字段"
      @close="!busy && (fieldsDialog = false)"
    >
      <form
        class="admin-fields-form"
        @submit.prevent="addCategoryField"
      >
        <div class="admin-field-row">
          <label
            >显示名称<input
              v-model="fieldLabel"
              required
          /></label>
          <label
            >JSON 字段<input
              v-model="fieldKey"
              required
              pattern="[a-z][A-Za-z0-9_]*"
          /></label>
        </div>
        <div
          v-if="categoryFields.length"
          class="admin-fields-list"
        >
          <div
            v-for="field in categoryFields"
            :key="field.key"
          >
            <span>{{ field.label }}</span>
            <code>{{ field.key }}</code>
            <button
              type="button"
              class="admin-icon-button"
              :aria-label="'删除 ' + field.label"
              :disabled="busy"
              @click="removeCategoryField(field)"
            >
              <PointIcon
                name="close"
                :size="14"
              />
            </button>
          </div>
        </div>
        <p
          v-if="error"
          class="admin-inline-warning"
          role="alert"
        >
          {{ error }}
        </p>
        <div class="admin-create-actions">
          <button
            type="button"
            :disabled="busy"
            @click="fieldsDialog = false"
          >
            关闭
          </button>
          <button
            type="submit"
            class="admin-save"
            :disabled="busy || !fieldLabel.trim() || !fieldKey.trim()"
          >
            添加字段
          </button>
        </div>
      </form>
    </AppDialog>
  </div>
</template>
<style scoped>
.admin-points-page {
  --admin-muted: color-mix(in srgb, var(--atlas-ink) 58%, transparent);
  --admin-tint: color-mix(in srgb, var(--atlas-accent) 7%, var(--atlas-paper));
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--atlas-ink);
  background: var(--atlas-paper);
  font: 400 14px/1.5 var(--atlas-font);
}
.admin-points-page button,
.admin-create-form button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  padding: 6px 12px;
  border: 1px solid var(--atlas-line);
  border-radius: 6px;
  color: var(--atlas-ink);
  background: var(--atlas-paper);
  font: 400 13px/1.5 var(--atlas-font);
  box-shadow: none;
  cursor: pointer;
  transition:
    background 0.15s,
    border-color 0.15s;
}
.admin-points-page button:hover:not(:disabled),
.admin-create-form button:hover:not(:disabled) {
  background: var(--atlas-soft);
  border-color: color-mix(in srgb, var(--atlas-ink) 24%, var(--atlas-line));
}
.admin-points-page button:disabled,
.admin-create-form button:disabled {
  opacity: 0.4;
  cursor: default;
}
.admin-points-page input:not([type='checkbox']),
.admin-points-page select,
.admin-points-page textarea,
.admin-create-form input,
.admin-create-form select {
  display: block;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  min-height: 36px;
  padding: 8px 10px;
  border: 1px solid var(--atlas-line);
  border-radius: 6px;
  background: var(--atlas-paper);
  color: var(--atlas-ink);
  font: 400 13px/1.5 var(--atlas-font);
  box-shadow: none;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}
.admin-points-page textarea {
  resize: vertical;
}
.admin-points-page input::placeholder {
  color: var(--admin-muted);
}
.admin-points-page :is(button, input, select, textarea, summary):focus-visible,
.admin-create-form :is(input, select, button):focus-visible {
  outline: 2px solid color-mix(in srgb, var(--atlas-accent) 55%, transparent);
  outline-offset: 2px;
}
.admin-topbar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 50px;
  padding: 0 18px;
  border-bottom: 1px solid var(--atlas-line);
  background: var(--atlas-paper);
}
.admin-title,
.admin-top-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.admin-title > svg {
  opacity: 0.75;
}
.admin-title h1 {
  margin: 0;
  font: 400 16px/1.5 var(--atlas-title-font);
  letter-spacing: 0.04em;
}
.admin-points-page .admin-icon-button {
  width: 32px;
  min-height: 32px;
  flex: none;
  padding: 0;
  border-color: transparent;
  background: transparent;
}
.admin-points-page .admin-new {
  min-height: 30px;
  font-size: 12px;
}
.admin-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) clamp(370px, 30vw, 440px);
  flex: 1;
  min-height: 0;
}
.admin-map-panel {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--atlas-soft);
}
.admin-side-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-left: 1px solid var(--atlas-line);
  background: var(--atlas-paper);
}
.admin-panel-tabs {
  display: flex;
  flex: none;
  gap: 20px;
  height: 48px;
  padding: 0 22px;
  border-bottom: 1px solid var(--atlas-line);
}
.admin-panel-tabs > button {
  position: relative;
  gap: 7px;
  padding: 0 2px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--admin-muted);
}
.admin-panel-tabs > button[aria-selected='true'] {
  color: var(--atlas-ink);
}
.admin-panel-tabs > button[aria-selected='true']::after {
  position: absolute;
  bottom: -1px;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--atlas-accent);
  content: '';
}
.admin-panel-tabs > button:hover:not(:disabled) {
  background: transparent;
}
.admin-count {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  opacity: 0.6;
}
.admin-dirty-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #b77d3f;
}
.admin-list-panel,
.admin-editor-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  margin: 0;
}
.admin-filter-bar {
  flex: none;
  display: grid;
  gap: 9px;
  padding: 18px 20px 15px;
  border-bottom: 1px solid var(--atlas-line);
}
.admin-search {
  position: relative;
}
.admin-search > svg {
  position: absolute;
  top: 10px;
  left: 11px;
  color: var(--admin-muted);
  pointer-events: none;
}
.admin-search input {
  padding-left: 35px !important;
  background: var(--atlas-soft) !important;
  border-color: transparent !important;
}
.admin-filter-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 124px;
  gap: 8px;
}
.admin-filter-row select {
  min-height: 32px;
  padding: 5px 7px;
  font-size: 12px;
}
.admin-point-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 6px 10px;
  scrollbar-width: thin;
}
.admin-points-page .admin-point-row {
  display: flex;
  justify-content: flex-start;
  gap: 11px;
  width: 100%;
  min-height: 68px;
  margin: 2px 0;
  padding: 10px;
  border: 1px solid transparent;
  border-radius: 7px;
  text-align: left;
}
.admin-points-page .admin-point-row.active {
  background: var(--admin-tint);
  border-color: var(--atlas-line);
}
.admin-row-marker {
  display: grid;
  flex: none;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 7px;
  background: var(--atlas-soft);
}
.admin-point-row-main {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 3px;
}
.admin-point-row-main strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 400;
}
.admin-point-row-main > span {
  color: var(--admin-muted);
  font-size: 11px;
}
.admin-status {
  flex: none;
  white-space: nowrap;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  background: var(--atlas-soft);
}
.admin-status.status-missing {
  color: #986a39;
  background: color-mix(in srgb, #b98a4e 11%, var(--atlas-paper));
}
.admin-status.status-invalid {
  color: #ae5143;
  background: color-mix(in srgb, #ae5143 9%, var(--atlas-paper));
}
.admin-status.status-available {
  color: #56806b;
  background: color-mix(in srgb, #56806b 9%, var(--atlas-paper));
}
.admin-status.status-incomplete {
  color: #8f7040;
  background: color-mix(in srgb, #bf9a59 12%, var(--atlas-paper));
}
.admin-row-marker.status-incomplete {
  color: #8f7040;
}
.admin-row-marker.status-missing {
  color: #a47f52;
}
.admin-row-marker.status-invalid {
  color: #ae5143;
}
.admin-row-marker.status-available {
  color: #56806b;
}
.admin-row-arrow {
  flex: none;
  color: var(--admin-muted);
  opacity: 0;
}
.admin-point-row:hover .admin-row-arrow,
.admin-point-row.active .admin-row-arrow {
  opacity: 1;
}
.admin-pagination {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 51px;
  padding: 8px 20px;
  border-top: 1px solid var(--atlas-line);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.admin-pagination > div {
  display: flex;
  gap: 6px;
}
.admin-muted {
  color: var(--admin-muted);
}
.admin-editor-heading {
  flex: none;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 21px 22px 18px;
  border-bottom: 1px solid var(--atlas-line);
}
.admin-editor-heading > div {
  min-width: 0;
}
.admin-eyebrow {
  color: var(--admin-muted);
  font-size: 11px;
}
.admin-editor-heading h2 {
  margin: 6px 0 0;
  font: 400 21px/1.4 var(--atlas-title-font);
  overflow-wrap: anywhere;
}
.admin-editor-heading > .admin-status {
  margin-top: 4px;
}
.admin-editor-scroll {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: auto;
  margin: 0;
  padding: 0;
  border: 0;
  scrollbar-width: thin;
}
.admin-field-section {
  display: grid;
  gap: 14px;
  margin: 0 22px;
  padding: 21px 0;
  border-bottom: 1px solid var(--atlas-line);
}
.admin-component-list {
  display: grid;
}
.admin-component-row {
  display: flex;
  align-items: center;
  min-width: 0;
  border-top: 1px solid var(--atlas-line);
}
.admin-component-link {
  display: flex !important;
  justify-content: space-between !important;
  flex: 1;
  width: 100%;
  min-width: 0;
  padding: 11px 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  text-align: left;
}
.admin-component-delete {
  flex: none;
  margin-left: 6px;
  opacity: 0.55;
}
.admin-component-row:hover .admin-component-delete,
.admin-component-delete:focus-visible {
  opacity: 1;
}
.admin-component-tools {
  display: flex;
  align-items: center;
  gap: 9px;
}
.admin-component-add {
  display: flex;
  gap: 7px;
}
.admin-component-add input {
  flex: 1;
  min-width: 0;
}
.admin-component-link.active,
.admin-component-nav button.active {
  color: var(--atlas-accent) !important;
}
.admin-component-link > span:first-child,
.admin-component-end {
  display: grid;
  min-width: 0;
  gap: 3px;
}
.admin-component-link strong {
  font-weight: 500;
}
.admin-component-link small {
  overflow: hidden;
  color: var(--admin-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.admin-component-end {
  grid-auto-flow: column;
  align-items: center;
  justify-content: end;
  flex: none;
}
.admin-component-empty {
  margin: 0;
  font-size: 12px;
}
.admin-component-nav {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 0 0 3px;
}
.admin-component-nav button {
  min-height: 29px !important;
  flex: none;
  padding: 4px 8px !important;
  font-size: 11px !important;
}
.admin-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 21px;
}
.admin-section-heading h3 {
  margin: 0;
  font: 500 13px/1.5 var(--atlas-font);
}
.admin-points-page .admin-text-button {
  min-height: 20px;
  padding: 0;
  border: 0;
  color: var(--admin-muted);
  background: transparent;
  font-size: 11px;
}
.admin-field-section label,
.admin-create-form label {
  display: grid;
  gap: 6px;
  min-width: 0;
  color: var(--admin-muted);
  font-size: 12px;
}
.admin-field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.admin-field-row input {
  font-variant-numeric: tabular-nums;
}
.admin-field-section .admin-check {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
}
.admin-check input {
  width: 14px;
  height: 14px;
  margin: 0;
}
.admin-region-editor {
  display: grid;
  gap: 8px;
  min-width: 0;
}
.admin-region-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.admin-region-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 3px 5px 3px 8px;
  border: 1px solid var(--atlas-line);
  border-radius: 5px;
  background: var(--admin-tint);
  font-size: 11px;
}
.admin-region-chip > span {
  overflow-wrap: anywhere;
}
.admin-region-chip .admin-icon-button {
  width: 20px;
  min-height: 20px;
}
.admin-region-results {
  display: grid;
  max-height: 190px;
  overflow: auto;
  border: 1px solid var(--atlas-line);
  border-radius: 6px;
}
.admin-region-results > button {
  justify-content: space-between;
  border: 0;
  border-radius: 0;
  padding: 9px 10px;
  text-align: left;
  font-size: 12px;
}
.admin-suggestion {
  display: grid;
  gap: 9px;
  padding: 11px;
  border: 1px solid color-mix(in srgb, #b98a4e 35%, var(--atlas-line));
  border-radius: 6px;
  background: color-mix(in srgb, #b98a4e 6%, var(--atlas-paper));
}
.admin-suggestion > div:first-child {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12px;
}
.admin-suggestion svg {
  flex: none;
  margin-top: 2px;
  color: #a47f52;
}
.admin-suggestion-actions {
  display: flex;
  gap: 6px;
}
.admin-suggestion-actions button {
  min-height: 28px;
  padding: 4px 8px;
  font-size: 11px;
}
.admin-alert {
  display: flex;
  flex: none;
  align-items: flex-start;
  gap: 8px;
  max-height: 150px;
  overflow: auto;
  margin: 12px 16px 0;
  padding: 10px;
  border: 1px solid color-mix(in srgb, #ae5143 30%, var(--atlas-line));
  border-radius: 6px;
  background: color-mix(in srgb, #ae5143 6%, var(--atlas-paper));
  color: #ae5143;
  font-size: 12px;
}
.admin-alert > svg {
  flex: none;
  margin-top: 2px;
}
.admin-alert > span {
  flex: 1;
  overflow-wrap: anywhere;
}
.admin-alert .admin-icon-button {
  width: 20px;
  min-height: 20px;
}
.admin-inline-warning {
  margin: 0;
  color: #a46d3e;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.admin-advanced {
  margin: 0 22px;
  padding: 17px 0 22px;
}
.admin-advanced summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  list-style: none;
  color: var(--admin-muted);
  font-size: 12px;
}
.admin-advanced summary::-webkit-details-marker {
  display: none;
}
.admin-advanced[open] summary > svg {
  transform: rotate(180deg);
}
.admin-advanced textarea {
  font:
    11px/1.6 Consolas,
    monospace;
  tab-size: 2;
}
.admin-record-meta {
  display: grid;
  gap: 8px;
  margin: 15px 0;
  font-size: 11px;
}
.admin-record-meta > div {
  display: grid;
  grid-template-columns: 60px minmax(0, 1fr);
  gap: 8px;
}
.admin-record-meta dt {
  color: var(--admin-muted);
}
.admin-record-meta dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.admin-editor-footer {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 20px;
  border-top: 1px solid var(--atlas-line);
  background: var(--atlas-paper);
}
.admin-editor-footer > div {
  display: flex;
  gap: 7px;
}
.admin-points-page .admin-delete {
  color: #ad6255;
  border-color: transparent;
  background: transparent;
}
.admin-points-page .admin-save,
.admin-create-form .admin-save {
  min-width: 82px;
  background: var(--atlas-accent);
  color: var(--atlas-paper);
  border-color: var(--atlas-accent);
}
.admin-points-page .admin-save:hover:not(:disabled),
.admin-create-form .admin-save:hover:not(:disabled) {
  background: color-mix(in srgb, var(--atlas-accent) 88%, var(--atlas-paper));
  border-color: var(--atlas-accent);
}
.admin-empty {
  display: grid;
  place-items: center;
  height: 160px;
  margin: 0;
  color: var(--admin-muted);
  font-size: 13px;
}
.admin-skeletons {
  display: grid;
  gap: 8px;
  padding: 4px;
}
.admin-skeleton {
  height: 65px;
  border-radius: 6px;
  background: linear-gradient(
    100deg,
    var(--atlas-soft) 25%,
    var(--atlas-paper) 45%,
    var(--atlas-soft) 65%
  );
  background-size: 250% 100%;
  animation: admin-shimmer 1.6s ease infinite;
}
.admin-spinning {
  animation: admin-spin 1s linear infinite;
}
:global(.app-dialog.admin-create-dialog),
:global(.app-dialog.admin-fields-dialog) {
  --admin-muted: color-mix(in srgb, var(--atlas-ink) 58%, transparent);
  width: min(420px, calc(100vw - 32px));
  padding: 0;
  max-height: 88dvh;
  border: 1px solid var(--atlas-line);
  border-radius: 10px;
  box-shadow: 0 16px 60px rgb(20 35 24 / 14%);
  color: var(--atlas-ink);
  background: var(--atlas-paper);
}
:global(.app-dialog.admin-create-dialog::backdrop),
:global(.app-dialog.admin-fields-dialog::backdrop) {
  background: rgb(20 30 24 / 24%);
  backdrop-filter: blur(2px);
}
:global(.app-dialog.admin-create-dialog .dialog-heading),
:global(.app-dialog.admin-fields-dialog .dialog-heading) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 22px;
  margin: 0;
  border-bottom: 1px solid var(--atlas-line);
  background: var(--atlas-paper);
}
:global(.app-dialog.admin-create-dialog .dialog-heading h2),
:global(.app-dialog.admin-fields-dialog .dialog-heading h2) {
  margin: 0;
  font: 400 19px var(--atlas-font);
}
:global(.app-dialog.admin-create-dialog .dialog-heading button),
:global(.app-dialog.admin-fields-dialog .dialog-heading button) {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--atlas-ink);
  font-size: 20px;
  cursor: pointer;
}
:global(.app-dialog.admin-create-dialog .dialog-content),
:global(.app-dialog.admin-fields-dialog .dialog-content) {
  padding: 22px;
}
.admin-create-form,
.admin-fields-form {
  display: grid;
  gap: 18px;
}
.admin-fields-form label {
  display: grid;
  min-width: 0;
  gap: 6px;
  color: var(--admin-muted);
  font-size: 12px;
}
.admin-fields-list {
  display: grid;
  max-height: 34dvh;
  overflow: auto;
  border-top: 1px solid var(--atlas-line);
}
.admin-fields-list > div {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 32px;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  border-bottom: 1px solid var(--atlas-line);
  font-size: 12px;
}
.admin-fields-list code {
  overflow-wrap: anywhere;
  color: var(--admin-muted);
  font-size: 11px;
}
.admin-create-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 6px;
}
@keyframes admin-shimmer {
  to {
    background-position: -150% 0;
  }
}
@keyframes admin-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (min-width: 1800px) {
  .admin-workspace {
    grid-template-columns: minmax(0, 1fr) 460px;
  }
}
@media (max-width: 800px) {
  .admin-topbar {
    height: 46px;
    padding: 0 12px;
  }
  .admin-workspace {
    grid-template-columns: minmax(0, 1fr) 350px;
  }
  .admin-filter-bar {
    padding: 14px;
  }
  .admin-field-section,
  .admin-advanced {
    margin-right: 16px;
    margin-left: 16px;
  }
  .admin-editor-heading {
    padding: 17px 16px;
  }
  .admin-panel-tabs {
    padding: 0 16px;
  }
}
@media (max-width: 640px) {
  .admin-workspace {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(190px, 35%) minmax(0, 1fr);
  }
  .admin-side-panel {
    border-left: 0;
    border-top: 1px solid var(--atlas-line);
  }
  .admin-panel-tabs {
    height: 40px;
  }
  .admin-points-page .admin-point-row {
    min-height: 58px;
  }
  .admin-filter-bar {
    padding: 11px 14px;
  }
  .admin-editor-heading {
    padding: 12px 16px;
  }
  .admin-editor-heading h2 {
    font-size: 18px;
  }
  .admin-editor-footer {
    padding: 9px 14px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .admin-points-page * {
    animation: none !important;
    transition: none !important;
  }
}
</style>
