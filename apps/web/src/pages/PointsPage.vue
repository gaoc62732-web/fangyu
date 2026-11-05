<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch, watchEffect } from 'vue';
import { useRoute } from 'vue-router';
import { pointVisitColors } from '@fangyu/map-renderer';
import {
  isScope,
  getScopeConfig,
  type Scope,
  type MapLevel,
  type CatalogEntry,
} from '@fangyu/contracts';
import {
  pointGroup,
  pointView,
  childVisited,
  pointRecordIsShared,
  relatedPoints,
  pointRegions,
  drawablePoint,
  applyPointCheckin,
  DEFAULT_POINT_POLICIES,
  type PointChange,
  type PointGroup,
  type EntryView,
} from '@fangyu/domain';
import PointIcon from '../components/PointIcon.vue';
import HelpTip from '../components/HelpTip.vue';
import PointRegionSummary from '../components/PointRegionSummary.vue';
import PointExplorer from '../components/PointExplorer.vue';
import type { PointSearchResult } from '../features/points/point-search.js';
import { pointCategoryAppearance } from '../features/points/point-category-appearance.js';
import { pointDetails } from '../features/points/point-details.js';
import { useAppStore } from '../app/store.js';
import { useSharedMap } from '../features/maps/shared-map.js';
import MapSurface from '../components/MapSurface.vue';
import { validCoordinates } from '../features/maps/map-coordinates.js';

const store = useAppStore();
const pointColors = computed(() => pointVisitColors(store.colors));
const route = useRoute();
const sharedMap = useSharedMap();
const fallbackMapProps = computed(() => ({
  scope: scope.value,
  selected: selectedRegion.value,
  level: level.value,
  category: mapCategory.value,
  points: mapEntries.value,
  highlightedPointIds: highlightedPointIds.value,
  focus: pointFocus.value,
  focusPoints: pointLocations.value,
  initialCamera: initialCamera.value,
  previewRegions: previewRegions.value,
  pointMode: true,
}));
const session = computed(() => store.session!);
const policies = computed(() => {
  void store.revision;
  return { ...DEFAULT_POINT_POLICIES, ...session.value.preferences.pointCheckin };
});
const inherited = store.regionalMap;
const rememberedScope = localStorage.getItem('fangyu-point-scope');
const scope = ref<Scope>(inherited?.scope || (rememberedScope && isScope(rememberedScope) ? rememberedScope : 'china'));
const selectedRegion = ref(inherited?.scope === scope.value ? inherited.selected : '');
const level = ref<MapLevel>(inherited?.level || session.value.preferences.mapLevel);
const initialCamera = ref(inherited?.camera);
const pointFocus = ref<[number, number] | null>(null);
const pointLocations = ref<[number, number][] | null>(null);
const category = ref(localStorage.getItem('fangyu-point-category:' + scope.value) || localStorage.getItem('fangyu-point-category') || store.category);
let categoryScope = scope.value;
const explorer = ref<InstanceType<typeof PointExplorer>>();
const searchResults = shallowRef<PointSearchResult[] | null>(null);
const searchIds = computed(() => searchResults.value ? new Set(searchResults.value.map((item) => item.id)) : null);
const mapCategory = computed(() => searchResults.value ? '' : category.value);
const selectedId = ref('');
const selectedSubitemId = ref('');
const detailParentId = ref('');
const panel = ref<'detail' | null>(null);
const panelElement = ref<HTMLElement>();
const panelBody = ref<HTMLElement>();
const workspace = ref<HTMLElement>();
const workspaceWidth = ref(window.innerWidth);
const preferredPanelWidth = ref(390);
const maxPanelWidth = computed(() => Math.max(320, Math.min(680, workspaceWidth.value - 320)));
const panelWidth = computed(() => Math.min(maxPanelWidth.value, preferredPanelWidth.value));
const resizingPanel = ref(false);
let resizeStart: { x: number; width: number } | undefined;
let workspaceObserver: ResizeObserver | undefined;
function setPanelWidth(width: number) {
  preferredPanelWidth.value = Math.max(320, Math.min(maxPanelWidth.value, width));
}
function startPanelResize(event: PointerEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  resizeStart = { x: event.clientX, width: panelWidth.value };
  resizingPanel.value = true;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}
function movePanelResize(event: PointerEvent) {
  if (resizeStart) setPanelWidth(resizeStart.width + resizeStart.x - event.clientX);
}
function stopPanelResize() {
  resizeStart = undefined;
  resizingPanel.value = false;
}
function keyPanelResize(event: KeyboardEvent) {
  if (event.key === 'ArrowLeft') setPanelWidth(panelWidth.value + 20);
  else if (event.key === 'ArrowRight') setPanelWidth(panelWidth.value - 20);
  else if (event.key === 'Home') setPanelWidth(320);
  else if (event.key === 'End') setPanelWidth(maxPanelWidth.value);
  else return;
  event.preventDefault();
}
onMounted(() => {
  workspaceObserver = new ResizeObserver(() => {
    if (workspace.value) workspaceWidth.value = workspace.value.clientWidth;
  });
  if (workspace.value) workspaceObserver.observe(workspace.value);
});
onBeforeUnmount(() => workspaceObserver?.disconnect());
const message = ref('');
const pending = ref<{
  stage: 'children' | 'identities' | 'regions';
  changes: PointChange[];
  group?: PointGroup;
  choices: string[];
  options: { id: string; name: string; detail?: string; disabled?: boolean }[];
}>();
const allChoicesSelected = computed(() => {
  const options = pending.value?.options.filter((option) => !option.disabled) || [];
  return options.length > 0 && options.every((option) => pending.value!.choices.includes(option.id));
});
const scopeEntries = computed(() => {
  void store.revision;
  return session.value
    .allEntries()
    .filter((entry) =>
      session.value.index.entryRegions(entry, scope.value).length ||
      entry.subitems.some((child) =>
        (child.regionIds || []).some((id) => session.value.index.regions.get(id)?.scope === scope.value),
      ),
    );
});
const categories = computed(() => {
  const ids = new Set(scopeEntries.value.map((e) => e.categoryId));
  return session.value.index.catalog.categories.filter((c) => ids.has(c.id));
});
watch(
  categories,
  (choices) => {
    if (categoryScope !== scope.value) {
      categoryScope = scope.value;
      category.value = localStorage.getItem('fangyu-point-category:' + scope.value) || category.value;
    }
    if (!choices.some((c) => c.id === category.value))
      category.value =
        choices.find((c) =>
          scopeEntries.value.some((e) => e.categoryId === c.id && drawablePoint(e)),
        )?.id ||
        choices[0]?.id ||
        '';
  },
  { immediate: true },
);
const entries = computed(() =>
  [...new Map([...(searchResults.value
    ? [...new Map(searchResults.value.map((item) => [item.entry.id, item.entry])).values()]
    : scopeEntries.value.filter((e) => e.categoryId === category.value)), ...detailEntries.value]
    .map((entry) => [entry.id, entry])).values()]
    .map((e) => pointView(session.value, e)),
);
const detailEntries = computed(() => {
  if (!panel.value || !selectedId.value) return [];
  const found = new Map<string, CatalogEntry>();
  const visit = (entry: CatalogEntry) => {
    if (found.has(entry.id)) return;
    found.set(entry.id, entry);
    for (const child of pointGroup(session.value, entry)?.children || [])
      if (!child.self && !child.subitemId) visit(session.value.entry(child.entryId));
  };
  visit(session.value.entry(selectedId.value));
  return [...found.values()];
});
const detailEntryIds = computed(() => new Set(detailEntries.value.map((entry) => entry.id)));
watch(category, (value) => {
  store.category = value;
  localStorage.setItem('fangyu-point-category', value);
  localStorage.setItem('fangyu-point-category:' + scope.value, value);
}, { immediate: true });
watch(scope, (value) => localStorage.setItem('fangyu-point-scope', value), { immediate: true });
const mapPointData = computed(() => {
  const points: EntryView[] = [];
  const subitems = new Map<string, { parent: CatalogEntry; id: string }>();
  for (const entry of entries.value) {
    if (detailEntryIds.value.has(entry.id) || !searchIds.value || searchIds.value.has(entry.id)) {
      points.push(entry);
    }
    for (const child of entry.subitems) {
      const coordinates = child.coordinates;
      if (!coordinates || coordinates.length !== 2 || !coordinates.every(Number.isFinite)) continue;
      const id = `${entry.id}__subitem__${child.id}`;
      if (!detailEntryIds.value.has(entry.id) && searchIds.value && !searchIds.value.has(id)) continue;
      const regionIds = child.regionIds?.length ? child.regionIds : entry.regionIds;
      points.push({
        ...entry,
        id,
        name: child.name,
        aliases: [],
        regionIds,
        path: regionIds.map((regionId) => session.value.index.paths.get(regionId) || '').filter(Boolean).join(' / '),
        coordinates,
        coordinateStatus: 'available',
        coordinateReferenceOnly: false,
        ordinaryPointEligible: true,
        description: child.description || '',
        attributes: child.attributes || {},
        subitems: [],
        checked: session.value.subitemVisited(entry.id, child.id),
        visited: session.value.subitemVisited(entry.id, child.id),
        partial: false,
      });
      subitems.set(id, { parent: entry, id: child.id });
    }
  }
  return { points, subitems };
});
const mapEntries = computed(() => mapPointData.value.points);
const highlightedPointIds = computed(() => {
  if (!panel.value || !selectedId.value) return [];
  if (selectedSubitemId.value) {
    const id = selectedId.value + '__subitem__' + selectedSubitemId.value;
    return mapEntries.value.some((entry) => entry.id === id && drawablePoint(entry)) ? [id] : [];
  }
  return mapEntries.value.filter((entry) => drawablePoint(entry) &&
    (detailEntryIds.value.has(entry.id) || detailEntryIds.value.has(mapPointData.value.subitems.get(entry.id)?.parent.id || '')))
    .map((entry) => entry.id);
});
const mappedCount = computed(() => mapEntries.value.filter(drawablePoint).length);
const active = computed<EntryView | undefined>(() => {
  void store.revision;
  const entry = selectedId.value ? session.value.entry(selectedId.value) : undefined;
  if (!entry) return;
  const child = selectedSubitemId.value
    ? session.value.entry(entry.recordId).subitems.find((item) => item.id === selectedSubitemId.value)
    : undefined;
  if (!child) {
    const parentId = detailParentId.value || canonicalParents.value.get(entry.id);
    return pointView(session.value, pointDetails(entry, parentId ? session.value.entry(parentId) : undefined));
  }
  const regionIds = child.regionIds?.length ? child.regionIds : entry.regionIds;
  const checked = session.value.subitemVisited(entry.id, child.id);
  return pointDetails({
    id: entry.id + '__subitem__' + child.id,
    recordId: entry.recordId, scope: entry.scope, categoryId: entry.categoryId,
    name: child.name, aliases: [], subitems: [], regionIds,
    coordinates: child.coordinates ?? null,
    description: child.description || '', attributes: child.attributes || {},
    locationNote: child.locationNote || '',
    checked, visited: checked, partial: false, note: '',
    path: regionIds.map((id) => session.value.index.paths.get(id) || '').filter(Boolean).join(' / '),
  } satisfies EntryView, entry);
});
const group = computed(() => (active.value && !selectedSubitemId.value ? pointGroup(session.value, active.value) : undefined));
const detailParent = computed(() => detailParentId.value ? session.value.entry(detailParentId.value) : undefined);
const canonicalParents = computed(() => {
  const parents = new Map<string, string>();
  const catalog = session.value.index.catalog;
  for (const project of catalog.heritageProjects || [])
    for (const id of project.componentEntryIds)
      if (project.legacyEntryIds[0] && !parents.has(id)) parents.set(id, project.legacyEntryIds[0]);
  for (const parent of catalog.nationalHeritage?.datasets.flatMap((dataset) => dataset.parents) || [])
    for (const id of parent.componentEntryIds || [])
      if (id !== parent.entryId && !parents.has(id)) parents.set(id, parent.entryId);
  return parents;
});
const activeLocationNote = computed(() => active.value?.locationNote ?? active.value?.coordinatePrecisionNote ?? '');
const activeAppearance = computed(() => pointCategoryAppearance(
  active.value?.categoryId || category.value,
  session.value.index.catalog.categories.find((item) => item.id === (active.value?.categoryId || category.value))?.name,
));
const shared = computed(() =>
  selectedId.value ? pointRecordIsShared(session.value, session.value.entry(selectedId.value)) : false,
);
const related = computed(() => (active.value && !selectedSubitemId.value ? relatedPoints(session.value, active.value) : []));
const sharedIdentities = computed(() =>
  active.value && !selectedSubitemId.value
    ? (session.value.index.byRecord.get(active.value.recordId) || []).filter(
        (e) => e.id !== active.value!.id && e.categoryId !== active.value!.categoryId,
      )
    : [],
);
const parentProjects = computed(() =>
  active.value && !selectedSubitemId.value
    ? (session.value.index.catalog.heritageProjects || [])
        .filter((p) => p.componentEntryIds.includes(active.value!.id))
        .flatMap((p) => p.legacyEntryIds.slice(0, 1).map((id) => session.value.entry(id)))
    : [],
);
const progress = computed(() =>
  group.value ? group.value.children.filter((c) => childVisited(session.value, c)).length : 0,
);
const activeRegionIds = computed(() => {
  if (!active.value) return [];
  const ids = new Set([
    ...active.value.regionIds,
    ...session.value.index.entryRegions(active.value, scope.value),
  ]);
  for (const entry of detailEntries.value) {
    if (selectedSubitemId.value) break;
    for (const id of entry.regionIds) ids.add(id);
    for (const child of entry.subitems)
      for (const id of child.regionIds || []) ids.add(id);
  }
  return [...ids];
});
const previewRegions = computed(() =>
  pending.value?.stage === 'regions'
    ? pending.value.choices
    : active.value
      ? pointRegions(session.value, active.value, scope.value).filter(
          (id) => session.value.index.regions.get(id)?.scope === scope.value,
        )
      : [],
);
watchEffect(() => {
  Object.assign(sharedMap.view, {
    mode: 'points',
    scope: scope.value,
    selected: selectedRegion.value,
    level: level.value,
    category: mapCategory.value,
    points: mapEntries.value,
    highlightedPointIds: highlightedPointIds.value,
    focus: pointFocus.value,
    focusPoints: pointLocations.value,
    initialCamera: initialCamera.value,
    previewRegions: previewRegions.value,
    rightInset: panel.value ? `${panelWidth.value}px` : '0px',
    onSelect: () => {},
    onPoint: choosePoint,
    onLevel: (value: Exclude<MapLevel, 'country'>) => (level.value = value),
    onOverview: () => {},
    onCluster: () => {},
  });
});
const categoryName = (id: string) =>
  session.value.index.catalog.categories.find((c) => c.id === id)?.name || id;
function filledCategoryFields(categoryId: string, attributes?: Record<string, unknown>) {
  const fields = session.value.index.catalog.categories.find((category) => category.id === categoryId)?.fields || [];
  return fields.flatMap((field) => {
    const value = attributes?.[field.key];
    if (value === undefined || value === null || String(value).trim() === '') return [];
    return [{ key: field.key, label: field.label, value: String(value) }];
  });
}
const activeCategoryFields = computed(() =>
  active.value ? filledCategoryFields(active.value.categoryId, active.value.attributes) : [],
);
const activeCategoryFieldKeys = computed(() => new Set(activeCategoryFields.value.map((field) => field.key)));
const stateLabel = computed(() =>
  active.value?.checked ? '已点亮' : active.value?.partial ? '部分到访' : '未点亮',
);

async function focusPanel() {
  await nextTick();
  panelElement.value?.focus({ preventScroll: true });
}
function fitEntry(entry: CatalogEntry, subitemId?: string) {
  pointFocus.value = null;
  pointLocations.value = null;
  if (subitemId) {
    const child = session.value.entry(entry.recordId).subitems.find((item) => item.id === subitemId);
    if (validCoordinates(child?.coordinates)) pointFocus.value = [...child!.coordinates!] as [number, number];
    return;
  }
  if (!pointGroup(session.value, entry)) {
    if (drawablePoint(entry)) pointFocus.value = [...entry.coordinates!] as [number, number];
    return;
  }
  const coordinates: [number, number][] = [];
  const visited = new Set<string>();
  const collect = (item: CatalogEntry) => {
    if (visited.has(item.id)) return;
    visited.add(item.id);
    if (drawablePoint(item)) coordinates.push(item.coordinates!);
    for (const child of pointGroup(session.value, item)?.children || []) {
      if (child.self) continue;
      if (child.subitemId) {
        if (validCoordinates(child.coordinates)) coordinates.push(child.coordinates!);
      } else collect(session.value.entry(child.entryId));
    }
  };
  collect(entry);
  if (coordinates.length) pointLocations.value = [...new Map(coordinates.map((point) => [point.join(','), point])).values()];
}
function openEntry(entry: CatalogEntry, parentId = canonicalParents.value.get(entry.id) || '') {
  if (pending.value) finish();
  category.value = entry.categoryId;
  selectedId.value = entry.id;
  selectedSubitemId.value = '';
  detailParentId.value = parentId;
  panel.value = 'detail';
  message.value = '';
  fitEntry(entry);
  void focusPanel();
  void nextTick(() => { if (panelBody.value) panelBody.value.scrollTop = 0; });
}
function openSubitem(parent: CatalogEntry, id: string) {
  openEntry(parent, parent.id);
  selectedSubitemId.value = id;
  fitEntry(parent, id);
}
function choosePoint(id: string) {
  const subitem = mapPointData.value.subitems.get(id);
  if (subitem) {
    openSubitem(subitem.parent, subitem.id);
    return;
  }
  try {
    openEntry(session.value.entry(id));
  } catch {
    // A point can disappear after a catalog refresh while its marker is mounted.
  }
}
// Existing record-list location links now open the point module directly.
watch(
  () => [route.query.entry, route.query.scope, route.query.subitem],
  ([id, requestedScope, requestedSubitem]) => {
    if (typeof id !== 'string') return;
    let entry: CatalogEntry;
    try {
      entry = session.value.entry(id);
    } catch {
      return;
    }
    const targetScope =
      typeof requestedScope === 'string' &&
      isScope(requestedScope) &&
      session.value.index.entryRegions(entry, requestedScope).length
        ? requestedScope
        : entry.scope;
    if (scope.value !== targetScope) {
      scope.value = targetScope;
      switchScope();
    }
    const child =
      typeof requestedSubitem === 'string'
        ? entry.subitems.find((item) => item.id === requestedSubitem)
        : undefined;
    if (child) openSubitem(entry, child.id);
    else openEntry(entry);
  },
  { immediate: true },
);
function openSearchResult(item: PointSearchResult) {
  if (item.subitemId) openSubitem(item.entry, item.subitemId);
  else openEntry(item.entry);
}
function closePanel() {
  if (pending.value) finish();
  panel.value = null;
  selectedId.value = '';
  selectedSubitemId.value = '';
  detailParentId.value = '';
  pointFocus.value = null;
  pointLocations.value = null;
}
function openChild(child: PointGroup['children'][number]) {
  if (child.self) return;
  if (child.subitemId) openSubitem(session.value.entry(child.entryId), child.subitemId);
  else openEntry(session.value.entry(child.entryId), selectedId.value);
}
function returnToParent() {
  if (detailParent.value) openEntry(detailParent.value);
}
function switchScope() {
  if (pending.value) finish();
  selectedRegion.value = '';
  level.value = getScopeConfig(scope.value).defaultLevel;
  initialCamera.value = undefined;
  pointFocus.value = null;
  pointLocations.value = null;
  selectedId.value = '';
  selectedSubitemId.value = '';
  detailParentId.value = '';
  panel.value = null;
  searchResults.value = null;
}
function changeCategory() {
  if (pending.value) finish();
  selectedId.value = '';
  selectedSubitemId.value = '';
  detailParentId.value = '';
  pointFocus.value = null;
  pointLocations.value = null;
  searchResults.value = null;
  if (panel.value === 'detail') panel.value = null;
}
function finish(regions: string[] = []) {
  const changes = pending.value?.changes || [];
  if (changes.length) {
    if (store.commit((current) => applyPointCheckin(current, changes, regions)))
      message.value = '已保存到访记录';
  }
  pending.value = undefined;
}
function addedEntries(changes: PointChange[]) {
  return changes.flatMap((change) => {
    const entry = session.value.entry(change.entryId);
    const added: CatalogEntry[] = [];
    if ((change.selfVisited && !session.value.pointSelfVisited(entry.id)) ||
      (change.visited && !session.value.view(entry).checked)) added.push(entry);
    for (const id of change.subitemIds || []) {
      if (session.value.subitemVisited(entry.id, id)) continue;
      const child = session.value.entry(entry.recordId).subitems.find((item) => item.id === id);
      if (child) added.push({
        ...entry, id: entry.id + '__subitem__' + child.id, name: child.name, subitems: [],
        regionIds: child.regionIds?.length ? child.regionIds : entry.regionIds,
        topicRegions: undefined, coordinates: child.coordinates,
      });
    }
    return added;
  });
}
function regionStep(changes: PointChange[]) {
  const additions = addedEntries(changes);
  const ids = [...new Set(additions.flatMap((e) => pointRegions(session.value, e, scope.value)))];
  const unvisited = ids.filter((id) => !session.value.arrived(id));
  if (!unvisited.length || policies.value.regions === 'never') {
    pending.value = { stage: 'regions', changes, choices: [], options: [] };
    finish();
    return;
  }
  // Several covered regions always require an explicit actual-visit choice.
  if (policies.value.regions === 'auto' && ids.length === 1) {
    pending.value = { stage: 'regions', changes, choices: [], options: [] };
    finish(unvisited);
    return;
  }
  pending.value = {
    stage: 'regions',
    changes,
    choices: ids.length === 1 ? unvisited : [],
    options: unvisited.map((id) => ({
      id,
      name: session.value.index.regions.get(id)!.name,
      detail: session.value.index.ancestors(id)
        .filter((region) => region.id !== id && region.scope === scope.value)
        .map((region) => region.name).join(' · '),
    })),
  };
}
function identityStep(changes: PointChange[]) {
  const primaryIds = new Set(changes.map((c) => c.entryId));
  const identities = [
    ...new Map(
      addedEntries(changes).flatMap((e) =>
        relatedPoints(session.value, e)
          .filter(
            (r) =>
              r.kind === 'same-place' &&
              r.entry.categoryId !== e.categoryId &&
              !primaryIds.has(r.entry.id) &&
              !pointRecordIsShared(session.value, r.entry) &&
              !pointGroup(session.value, r.entry) &&
              !session.value.view(r.entry).checked,
          )
          .map((r) => [r.entry.id, r.entry] as const),
      ),
    ).values(),
  ];
  if (!identities.length || policies.value.identities === 'never') {
    regionStep(changes);
    return;
  }
  if (policies.value.identities === 'auto') {
    regionStep([...changes, ...identities.map((e) => ({ entryId: e.id, visited: true }))]);
    return;
  }
  pending.value = {
    stage: 'identities',
    changes,
    choices: [],
    options: identities.map((e) => ({
      id: e.id,
      name: e.nameZh || e.name,
      detail: categoryName(e.categoryId),
    })),
  };
}
function groupChanges(selected: string[], entry = session.value.entry(selectedId.value)): PointChange[] {
  const currentGroup = pointGroup(session.value, entry)!;
  const selectedSet = new Set(selected);
  const changes: PointChange[] = [];
  const own = currentGroup.children.find((child) => child.self);
  const subitems = currentGroup.children.filter((child) => child.subitemId);
  if (subitems.length) changes.push({
    entryId: entry.id, visited: false,
    subitemIds: subitems.filter((child) => selectedSet.has(child.id)).map((child) => child.subitemId!),
    selfVisited: own ? selectedSet.has(own.id) : false,
  });
  else if (own && selectedSet.has(own.id) !== childVisited(session.value, own))
    changes.push({ entryId: entry.id, visited: false, selfVisited: selectedSet.has(own.id) });
  for (const child of currentGroup.children) {
    if (child.self || child.subitemId || selectedSet.has(child.id) === childVisited(session.value, child)) continue;
    const target = session.value.entry(child.entryId);
    const nested = pointGroup(session.value, target);
    if (nested) changes.push(...groupChanges(selectedSet.has(child.id) ? nested.children.map((item) => item.id) : [], target));
    else changes.push({ entryId: child.entryId, visited: selectedSet.has(child.id) });
  }
  return changes;
}
function beginCheckin() {
  if (!active.value || shared.value) return;
  if (selectedSubitemId.value) {
    const entry = session.value.entry(selectedId.value);
    const ids = session.value.entry(entry.recordId).subitems
      .filter((child) => child.id === selectedSubitemId.value
        ? !session.value.subitemVisited(entry.id, child.id)
        : session.value.subitemVisited(entry.id, child.id))
      .map((child) => child.id);
    const change = {
      entryId: entry.id, visited: false, subitemIds: ids,
      selfVisited: session.value.pointSelfVisited(entry.id),
    };
    if (active.value.checked) {
      pending.value = { stage: 'regions', changes: [change], choices: [], options: [] };
      finish();
    } else identityStep([change]);
    return;
  }
  if (group.value) {
    if (!group.value.children.length) {
      message.value = '该项目尚未收录组成地点，暂不能记录总项目完成状态。';
      return;
    }
    const options = group.value.children.map((c) => ({
      id: c.id,
      name: c.name,
      disabled: pointRecordIsShared(session.value, session.value.entry(c.entryId)),
    }));
    pending.value = {
      stage: 'children',
      changes: [],
      group: group.value,
      choices: group.value.children.filter((c) => childVisited(session.value, c)).map((c) => c.id),
      options,
    };
    return;
  }
  const change = { entryId: active.value.id, visited: !active.value.checked };
  if (!change.visited) {
    pending.value = { stage: 'regions', changes: [change], choices: [], options: [] };
    finish();
  } else identityStep([change]);
}
function confirmStep() {
  const draft = pending.value;
  if (!draft) return;
  if (draft.stage === 'children') identityStep(groupChanges(draft.choices));
  else if (draft.stage === 'identities')
    regionStep([...draft.changes, ...draft.choices.map((entryId) => ({ entryId, visited: true }))]);
  else finish(draft.choices);
}
function skipStep() {
  const draft = pending.value;
  if (!draft) return;
  if (draft.stage === 'children') pending.value = undefined;
  else if (draft.stage === 'identities') regionStep(draft.changes);
  else finish();
}
function toggleAllChoices() {
  if (!pending.value) return;
  const preserved = pending.value.choices.filter(
    (id) => pending.value!.options.find((o) => o.id === id)?.disabled,
  );
  pending.value.choices = allChoicesSelected.value ? preserved : [
    ...preserved, ...pending.value.options.filter((o) => !o.disabled).map((o) => o.id),
  ];
}
onBeforeUnmount(() => {
  if (pending.value) finish();
});
</script>

<template>
  <section class="point-page" :style="{ '--point-visited': pointColors.visitedColor, '--point-unvisited': pointColors.unvisitedColor, '--point-partial': pointColors.partialColor, '--point-visited-ink': pointColors.visitedTextColor, '--point-unvisited-ink': pointColors.unvisitedTextColor, '--point-partial-ink': pointColors.partialTextColor }">
    <div
      ref="workspace"
      class="point-workspace"
      :class="{ 'has-panel': panel, 'resizing-panel': resizingPanel }"
      :style="{ '--point-panel-width': panelWidth + 'px', '--point-map-right-inset': panel ? panelWidth + 'px' : '0px' }"
    >
      <div class="point-map">
        <MapSurface
          v-if="!sharedMap.provided"
          v-bind="fallbackMapProps"
          @point="choosePoint"
          @level="level = $event"
        />
        <PointExplorer
          ref="explorer"
          :scope="scope"
          :category="category"
          :categories="categories"
          :entries="scopeEntries"
          @update:scope="scope = $event; switchScope()"
          @update:category="category = $event; changeCategory()"
          @search="searchResults = $event"
          @select="openSearchResult"
        />
        <footer class="point-page-caption">
          <span role="status">{{
            message ||
            (mappedCount
              ? `${mappedCount.toLocaleString()} 处地图点位`
              : searchResults ? '没有符合条件的地图点位' : '本类别暂无可显示点位，可搜索地点记录到访')
          }}</span>
          <div class="point-page-caption-tools">
            <span class="atlas-save-state">{{ store.saveStatus }}</span
            ><button
              :disabled="!store.canUndo || !!pending"
              aria-label="撤销"
              @click="
                store.undo();
                message = '已撤销上一步';
              "
            >
              <PointIcon
                name="undo"
                :size="15"
              />
            </button>
          </div>
        </footer>
      </div>
      <aside
        v-if="panel"
        ref="panelElement"
        class="point-panel"
        tabindex="-1"
        aria-label="点位资料栏"
        @keydown.esc="closePanel"
      >
        <div
          class="point-panel-resize"
          role="separator"
          aria-label="调整资料栏宽度"
          aria-orientation="vertical"
          :aria-valuenow="panelWidth"
          :aria-valuemin="320"
          :aria-valuemax="maxPanelWidth"
          tabindex="0"
          title="左右拖动调整资料栏宽度；方向键每次调整 20px"
          @pointerdown="startPanelResize"
          @pointermove="movePanelResize"
          @pointerup="stopPanelResize"
          @pointercancel="stopPanelResize"
          @lostpointercapture="stopPanelResize"
          @keydown="keyPanelResize"
        >
          <span />
        </div>
        <div class="point-panel-head">
          <div class="point-panel-tools">
            <span class="point-panel-category" :style="{ color: activeAppearance.color }"><PointIcon :name="activeAppearance.icon" :size="16" />{{ categoryName(active?.categoryId || category) }}</span
            ><button
              class="close-panel"
              aria-label="收起资料栏"
              @click="closePanel"
            >
              <PointIcon
                name="close"
                :size="18"
              />
            </button>
          </div>
          <template v-if="panel === 'detail' && active">
            <button v-if="detailParent && !pending" class="point-parent-back" type="button" @click="returnToParent"><PointIcon name="back" :size="15" /><span>{{ detailParent.nameZh || detailParent.name }}</span></button>
            <h3 :title="active.name">{{ active.nameZh || active.name }}</h3>
            <p
              v-if="!pending && active.nameEn && active.nameEn !== (active.nameZh || active.name)"
              class="english-name"
            >
              {{ active.nameEn }}
            </p>
            <div v-if="!pending && (activeRegionIds.length || activeLocationNote)" class="point-panel-location"><PointIcon name="location" :size="14" /><PointRegionSummary v-if="activeRegionIds.length" :region-ids="activeRegionIds" :scope="scope" /><span v-else>位置备注</span><HelpTip v-if="activeLocationNote" :text="activeLocationNote" label="位置备注" /></div>
            <div v-if="!pending" class="point-record-toolbar">
            <div class="point-status" :class="{ 'is-checked': active.checked, 'is-partial': active.partial }">
              <i :class="{ lit: active.checked, partial: active.partial }" />{{ stateLabel }}
              <span v-if="!group && !drawablePoint(active)" class="point-coordinate-status">暂无坐标</span>
            </div>
            <button
              v-if="!pending"
              class="point-primary-action"
              :class="{ 'is-checked': active.checked && !group }"
              :disabled="shared"
              @click="beginCheckin"
            >
              <PointIcon
                :name="active.checked && !group ? 'undo' : 'check'"
                :size="17"
              /><span>{{ group ? '记录到访' : active.checked ? '取消点亮' : '点亮地点' }}</span>
            </button>
            </div>
          </template>
        </div>
        <div
          ref="panelBody"
          class="point-panel-body"
        >
          <template v-if="active">
            <section
              v-if="pending"
              class="point-confirmation"
              aria-live="polite"
            >
              <div class="point-confirm-heading">
              <h4>
                {{
                  pending.stage === 'children'
                    ? '记录到访'
                    : pending.stage === 'identities'
                      ? '关联类别'
                      : '点亮政区'
                }}
                <small>{{ pending.choices.length }} / {{ pending.options.length }}</small>
              </h4>
              <button
                class="select-all"
                type="button"
                @click="toggleAllChoices"
              >
                {{ allChoicesSelected ? '取消全选' : '全选' }}
              </button>
              </div>
              <div class="point-choices">
                <label
                  v-for="option in pending.options"
                  :key="option.id"
                  class="point-choice"
                  :class="{ chosen: pending.choices.includes(option.id), 'is-disabled': option.disabled }"
                  :title="option.disabled ? '共用记录暂不可修改' : undefined"
                  ><input
                    v-model="pending.choices"
                    type="checkbox"
                    :value="option.id"
                    :disabled="option.disabled"
                  /><span>{{ option.name }}<small v-if="option.detail">{{ option.detail }}</small></span></label
                >
              </div>
            </section>
            <template v-else>
              <p
                v-if="shared"
                class="atlas-quiet-note"
              >
                此地点与其他类别共用旧记录。保留现有状态，待拆分记录后开放此处点亮。
              </p>
              <dl v-if="activeCategoryFields.length || active.designation || active.code || active.year || active.heritageType" class="point-facts">
                <div v-if="active.designation && !activeCategoryFieldKeys.has('designation')">
                  <dt>认定类别</dt>
                  <dd>{{ active.designation }}</dd>
                </div>
                <div v-if="active.code && !activeCategoryFieldKeys.has('code')">
                  <dt>编号</dt>
                  <dd>{{ active.code }}</dd>
                </div>
                <div v-for="field in activeCategoryFields" :key="field.key">
                  <dt>{{ field.label }}</dt>
                  <dd>{{ field.value }}</dd>
                </div>
                <div v-if="active.year && !activeCategoryFieldKeys.has('year')">
                  <dt>认定年份</dt>
                  <dd>{{ active.year }}</dd>
                </div>
                <div v-if="active.heritageType && !activeCategoryFieldKeys.has('heritageType')">
                  <dt>遗产类型</dt>
                  <dd>{{ active.heritageType }}</dd>
                </div>
              </dl>
              <section v-if="active.description" class="point-detail-section">
                <h4>地点简介</h4>
                <p class="atlas-description">{{ active.description }}</p>
              </section>
              <section
                v-if="group"
                class="point-detail-section"
              >
                <div class="atlas-section-heading">
                  <h4>组成地点</h4>
                  <span>{{ progress }} / {{ group.children.length }}</span>
                </div>
                <div v-if="group.children.length" class="point-group-progress" role="progressbar" aria-label="组成地点到访进度" :aria-valuemin="0" :aria-valuemax="group.children.length" :aria-valuenow="progress"><span :style="{ width: progress / group.children.length * 100 + '%' }" /></div>
                <article
                  v-for="child in group.children"
                  :key="child.id"
                  class="point-child-record"
                >
                  <div v-if="child.self" class="point-related-row point-self-row">
                    <span>{{ child.name }}</span>
                    <small class="point-child-state" :class="{ lit: childVisited(session, child) }">{{ childVisited(session, child) ? '已点亮' : '未点亮' }}</small>
                  </div>
                  <button
                    v-else
                    class="point-related-row"
                    @click="openChild(child)"
                  >
                    <span>{{ child.name }}</span
                    ><small class="point-child-state" :class="{ lit: childVisited(session, child) }">{{
                      childVisited(session, child) ? '已点亮' : '未点亮'
                    }}<PointIcon name="arrow" :size="14" /></small>
                  </button>
                </article>
                <p
                  v-if="!group.children.length"
                  class="atlas-quiet-note"
                >
                  尚未收录组成地点。
                </p>
              </section>
              <section
                v-if="parentProjects.length"
                class="point-detail-section"
              >
                <h4>所属总项目</h4>
                <button
                  v-for="parent in parentProjects"
                  :key="parent.id"
                  class="point-related-row"
                  @click="openEntry(parent)"
                >
                  <span>{{ parent.nameZh || parent.name }}</span
                  ><PointIcon
                    name="arrow"
                    :size="15"
                  />
                </button>
              </section>
              <section
                v-if="related.length || sharedIdentities.length"
                class="point-detail-section"
              >
                <h4>关联身份</h4>
                <button
                  v-for="r in related"
                  :key="r.entry.id"
                  class="point-related-row"
                  @click="openEntry(r.entry)"
                >
                  <span>{{ r.entry.nameZh || r.entry.name }}</span
                  ><small>{{
                    r.kind === 'same-place'
                      ? categoryName(r.entry.categoryId)
                      : r.kind === 'contains'
                        ? '包含关系'
                        : '部分重叠'
                  }}</small></button
                ><button
                  v-for="entry in sharedIdentities"
                  :key="entry.id"
                  class="point-related-row"
                  @click="openEntry(entry)"
                >
                  <span>{{ entry.nameZh || entry.name }}</span
                  ><small>{{ categoryName(entry.categoryId) }} · 旧共用记录</small>
                </button>
              </section>
              <section v-if="active.note" class="point-detail-section">
                <h4>备注</h4>
                <p class="atlas-description">{{ active.note }}</p>
              </section>
            </template>
          </template>
        </div>
        <footer
          v-if="pending"
          class="atlas-confirm-footer"
        >
          <div class="point-confirm-actions">
            <button class="atlas-skip" type="button" @click="skipStep">
              {{ pending.stage === 'children' ? '取消' : pending.stage === 'regions' ? '暂不点亮' : '跳过' }}
            </button>
            <button
              class="point-primary-action"
              type="button"
              :disabled="pending.stage !== 'children' && !pending.choices.length"
              @click="confirmStep"
            >
              <PointIcon name="check" :size="16" />
              <span>{{ pending.stage === 'children' ? '确认到访' : pending.stage === 'regions' ? '点亮所选' : '确认关联' }}</span>
            </button>
          </div>
        </footer>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.point-page {
  --point-paper: var(--atlas-paper);
  --point-line: var(--atlas-line);
  --point-ink: var(--atlas-ink);
  --point-muted: #4b5348;
  --point-decoration: #858a7f;
  --point-title-size: 28px;
  --point-body-size: 14px;
  --point-meta-size: 12px;
  --point-accent: var(--point-visited);
  --point-gold: #9b7c45;
  height: calc(100dvh - 56px);
  min-height: 480px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: transparent;
  color: var(--point-ink);
  position: relative;
  z-index: 1;
  pointer-events: none;
  font: 400 14px/1.6 var(--atlas-font);
}
.point-page button,
.point-page select,
.point-page input {
  font: inherit;
  color: inherit;
  border: 0;
  background: transparent;
  box-shadow: none;
  outline-offset: 4px;
}
.point-page button {
  cursor: pointer;
  font-weight: 300;
  border-radius: 0;
}
.point-page button:disabled {
  cursor: default;
  opacity: 0.45;
}
.point-page button:focus-visible,
.point-page a:focus-visible,
.point-page select:focus-visible,
.point-page input:focus-visible {
  outline: 2px solid #a18b5d;
}
.atlas-header {
  height: 56px;
  min-height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 32px;
  border-bottom: 1px solid var(--point-line);
  z-index: 6;
}
.atlas-brand {
  display: flex;
  align-items: center;
  gap: 13px;
}
.atlas-brand > svg {
  color: #6e785f;
}
.atlas-brand > span {
  font-family: inherit;
  font-weight: 300;
  font-size: 22px;
  letter-spacing: 0.12em;
}
.atlas-brand i {
  height: 17px;
  width: 1px;
  background: #d7d9cc;
  margin: 0 5px;
}
.atlas-brand h1 {
  margin: 0;
  font-size: var(--point-body-size);
  font-weight: 400;
  letter-spacing: 0.13em;
}
.atlas-header-actions {
  display: flex;
  align-items: center;
  gap: 28px;
}
.atlas-header-actions button,
.atlas-header-actions a {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  font-size: var(--point-body-size);
  color: var(--point-ink);
  text-decoration: none;
}
.atlas-header-actions a {
}
.point-workspace {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.point-map {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.point-map :deep(.map-card) {
  height: 100%;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  min-height: 0;
}
.point-map :deep(.map-surface) {
  height: 100%;
  min-height: 0;
}
.point-map :deep(.maplibregl-ctrl-attrib) {
  font-size: 12px;
  background: #fffefaac;
}
.point-map :deep(.maplibregl-ctrl-bottom-right) {
  bottom: 40px;
}
.point-page-caption {
  position: absolute;
  z-index: 2;
  left: 0;
  bottom: 0;
  right: 0;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 24px;
  font-size: var(--point-meta-size);
  color: var(--point-ink);
  background: #fffefadf;
  backdrop-filter: blur(12px);
  border-top: 1px solid #e6e6dc;
  pointer-events: auto;
}
.point-page-caption > div {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}
.point-page-caption-tools {
  position: relative;
  gap: 14px;
}
.point-page-caption button {
  padding: 0;
  display: flex;
}
.atlas-save-state {
  font-size: var(--point-meta-size);
}
.point-panel {
  position: absolute;
  inset: 0 0 0 auto;
  width: var(--point-panel-width, 390px);
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-left: 1px solid var(--point-line);
  background: var(--point-paper);
  outline: none;
  z-index: 5;
  pointer-events: auto;
}
.point-panel-resize {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -5px;
  width: 10px;
  z-index: 6;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: col-resize;
  touch-action: none;
}
.point-panel-resize span {
  width: 2px;
  height: 40px;
  border-radius: 2px;
  background: #c7cbbf;
}
.point-panel-resize:hover,
.point-panel-resize:focus-visible,
.resizing-panel .point-panel-resize {
  background: #343d3212;
  outline: none;
}
.point-panel-resize:hover span,
.point-panel-resize:focus-visible span,
.resizing-panel .point-panel-resize span {
  background: var(--point-accent);
}
.resizing-panel {
  user-select: none;
  cursor: col-resize;
}
.point-panel-head {
  flex: 0 0 auto;
  padding: 14px 22px 16px;
  border-bottom: 1px solid var(--point-line);
}
.point-panel-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.point-panel-tools > span {
  font-size: var(--point-meta-size);
  letter-spacing: 0;
}
.point-panel-category {
  display: flex;
  align-items: center;
  gap: 6px;
}
.point-page .point-parent-back {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  margin: 0 0 12px;
  padding: 3px 0;
  color: var(--point-accent);
  font-size: 12px;
  line-height: 1.45;
  text-align: left;
}
.point-parent-back > svg { flex: none; }
.point-parent-back > span { min-width: 0; overflow-wrap: anywhere; }
.point-parent-back:hover { text-decoration: underline; text-underline-offset: 3px; }
.close-panel {
  padding: 5px !important;
  display: flex;
  color: var(--point-ink) !important;
}
.close-panel:hover {
  color: var(--point-ink) !important;
}
.point-panel h3 {
  font-family: var(--atlas-title-font);
  font-size: var(--point-title-size);
  font-weight: 300;
  line-height: 1.35;
  margin: 0 0 7px;
  letter-spacing: 0;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.english-name {
  margin: 0 0 8px;
  color: var(--point-ink);
  font-size: var(--point-meta-size);
  line-height: 1.5;
  opacity: 0.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.point-panel-location {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.55;
}
.point-panel-location > svg { flex: none; margin-top: 2px; opacity: .6; }
.point-panel-location > span { min-width: 0; overflow-wrap: anywhere; }
.point-panel-location :deep(.help-tip) { align-self: center; }
.point-record-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-top: 12px;
}
.point-status {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  font-size: var(--point-meta-size);
  padding: 3px 7px;
  border: 1px solid color-mix(in srgb, var(--point-ink) 12%, transparent);
  border-radius: 5px;
  background: var(--point-unvisited);
  color: var(--point-unvisited-ink);
}
.point-status.is-checked { background: var(--point-visited); color: var(--point-visited-ink); }
.point-status.is-partial { background: var(--point-partial); color: var(--point-partial-ink); }
.point-status i {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: currentColor;
  opacity: .65;
}
.point-status i.lit {
  background: currentColor;
}
.point-status i.partial { background: currentColor; }
.point-status .point-coordinate-status {
  color: inherit;
  margin-left: 2px;
  padding-left: 8px;
  border-left: 1px solid var(--point-line);
  font-size: 11px;
  opacity: .55;
}
.point-status span {
  margin-left: auto;
  color: var(--point-ink);
  font-size: var(--point-body-size);
  font-variant-numeric: tabular-nums;
}
.point-status b {
  font-size: var(--point-meta-size);
  font-weight: 400;
  color: var(--point-ink);
}
.point-page .point-primary-action {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 38px;
  padding: 0 13px;
  background: var(--point-accent);
  color: var(--point-visited-ink);
  border-radius: 8px;
  font-size: var(--point-body-size);
  font-weight: 400;
  letter-spacing: 0.02em;
}
.point-primary-action > svg:last-child {
  margin-left: auto;
}
.point-panel-head .point-primary-action {
  width: fit-content;
  max-width: 100%;
  height: auto;
  min-height: 34px;
  padding: 7px 11px;
  gap: 6px;
  font-size: 13px;
}
.point-panel-head .point-primary-action.is-checked { background: var(--atlas-soft); color: var(--point-ink); }
.point-primary-action:hover {
  background: color-mix(in srgb, var(--point-visited) 85%, #000);
}
.point-primary-action:disabled {
  background: #b0b4a5 !important;
}
.point-panel-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  margin: 4px 4px 4px 0;
  padding: 0 18px 20px 22px;
}
.point-panel-body::-webkit-scrollbar { width: 6px; }
.point-panel-body::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
.point-panel-body::-webkit-scrollbar-track { margin: 8px 0; background: transparent; }
.point-panel-body::-webkit-scrollbar-thumb { border-radius: 8px; background: #929d9580; }
@supports not selector(::-webkit-scrollbar) {
  .point-panel-body { scrollbar-width: thin; scrollbar-color: #929d9580 transparent; }
}
.point-facts {
  margin: 14px 0 16px;
}
.point-facts > div {
  display: grid;
  align-items: center;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 12px;
  margin: 7px 0;
  font-size: var(--point-body-size);
  line-height: 1.65;
}
.point-facts dt {
  color: var(--point-ink);
  font-size: var(--point-meta-size);
  opacity: .55;
}
.point-facts dd {
  margin: 0;
  color: var(--point-ink);
  overflow-wrap: anywhere;
}
.point-detail-section {
  border-top: 1px solid var(--point-line);
  margin-top: 16px;
  padding: 14px 0 0;
}
.point-detail-section:first-child { border-top: 0; margin-top: 0; }
.point-detail-section h4 {
  font-size: var(--point-body-size);
  font-weight: 400;
  letter-spacing: 0;
  margin: 0 0 10px;
}
.atlas-section-heading {
  display: flex;
  justify-content: space-between;
}
.atlas-section-heading > span {
  font-size: var(--point-meta-size);
  color: var(--point-ink);
}
.atlas-quiet-note {
  font-size: var(--point-meta-size);
  line-height: 1.65;
  color: var(--point-ink);
  margin: 10px 0;
  opacity: .6;
}
.atlas-empty-description {
  margin: 32px 0 10px;
  padding-top: 20px;
  border-top: 1px solid var(--point-line);
}
.atlas-description {
  font-size: var(--point-body-size);
  line-height: 1.8;
  margin: 8px 0 12px;
  color: var(--point-ink);
  white-space: pre-line;
}
.point-related-row,
.point-list-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  text-align: left;
  padding: 10px 0 !important;
  border-bottom: 1px solid var(--point-line) !important;
  font-size: var(--point-body-size) !important;
  color: var(--point-ink) !important;
}
.point-related-row:hover,
.point-list-row:hover {
  background: var(--atlas-soft);
}
.point-related-row > span { min-width: 0; overflow-wrap: anywhere; }
.point-related-row > small { flex: none; }
.point-related-row small {
  font-size: var(--point-meta-size);
  color: var(--point-ink);
}
.point-related-row small.lit,
.point-list-state.lit {
  color: var(--point-accent);
}
.point-child-record {
  padding-bottom: 0;
  border-bottom: 1px solid var(--point-line);
}
.point-child-record + .point-child-record {
  margin-top: 0;
}
.point-child-record .point-related-row {
  border-bottom: 0 !important;
}
.point-self-row { cursor: default; }
.point-self-row:hover { background: transparent; }
.point-child-state { display: flex; align-items: center; gap: 7px; }
.point-related-row .point-child-state { padding: 2px 5px; border-radius: 4px; background: var(--point-unvisited); color: var(--point-unvisited-ink); }
.point-related-row .point-child-state.lit { background: var(--point-visited); color: var(--point-visited-ink); }
.point-self-row > .point-child-state::after { content: ''; flex: none; width: 14px; }
.point-child-state > svg { color: currentColor; opacity: .65; }
.point-child-meta {
  margin: 4px 0;
  color: var(--point-ink);
  font-size: var(--point-meta-size);
  line-height: 1.6;
  opacity: .6;
}
.point-child-fields {
  display: grid;
  gap: 5px;
  margin: 6px 0 10px;
  padding-left: 12px;
  border-left: 1px solid var(--point-line);
  font-size: var(--point-meta-size);
}
.point-child-fields > div {
  display: grid;
  align-items: center;
  grid-template-columns: 80px minmax(0, 1fr);
  gap: 10px;
}
.point-child-fields dt {
  color: var(--point-ink);
}
.point-child-fields dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}
.point-child-description {
  margin: 4px 0 14px;
  font-size: var(--point-meta-size);
}
.point-page .point-related-row:disabled {
  opacity: 1;
}
.point-child-selected {
  color: var(--point-accent) !important;
  background: color-mix(in srgb, var(--point-accent) 7%, transparent) !important;
}
.point-child-head { display: flex; align-items: center; gap: 4px; }
.point-child-head .point-related-row { flex: 1; min-width: 0; min-height: 42px; }
.point-page .point-child-toggle { display: grid; place-items: center; flex: none; width: 28px; padding: 0; opacity: .6; }
.point-child-toggle:hover { background: var(--atlas-soft); }
.point-child-toggle svg { transform: rotate(-90deg); transition: transform 180ms ease; }
.point-child-toggle[aria-expanded='true'] svg { transform: rotate(0); }
.point-child-record.is-selected { background: color-mix(in srgb, var(--point-accent) 6%, transparent); }
.point-child-details { padding: 0 8px 8px; }
.point-group-progress { height: 3px; margin: 0 0 10px; overflow: hidden; border-radius: 3px; background: var(--point-line); }
.point-group-progress > span { display: block; height: 100%; border-radius: inherit; background: var(--point-accent); transition: width 180ms ease; }
.point-group-note { margin: 0 0 7px; font-size: 11px; }
.atlas-panel-lead {
  font-size: var(--point-meta-size);
  color: var(--point-ink);
  line-height: 1.8;
  margin: 12px 0 23px;
}
.atlas-panel-lead span {
  color: var(--point-ink);
}
.atlas-search {
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid #ced2c2;
  color: var(--point-ink);
  padding: 10px 0;
}
.atlas-search input {
  width: 100%;
  padding: 0;
  min-width: 0;
  font-size: var(--point-body-size);
}
.atlas-search input::placeholder {
  color: var(--point-ink);
}
.point-virtual-list {
  position: relative;
}
.point-list-row {
  position: absolute;
  inset: 0 0 auto;
  height: 92px;
}
.point-list-row > span:first-child {
  min-width: 0;
}
.point-list-row strong {
  display: block;
  font-weight: 400;
  font-size: var(--point-body-size);
  color: var(--point-ink);
}
.point-list-row small {
  display: block;
  font-size: var(--point-meta-size);
  color: var(--point-ink);
  margin-top: 5px;
}
.point-list-row strong,
.point-list-row small {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.point-list-state {
  flex-shrink: 0;
  font-size: var(--point-meta-size);
  color: var(--point-ink);
}
.point-confirmation {
  padding: 16px 0 0;
}
.point-confirm-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.point-confirmation h4 {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0;
  font-size: 16px;
  font-weight: 500;
  line-height: 1.5;
}
.point-confirmation h4 small {
  opacity: .5;
  font-size: 12px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}
.point-page .select-all {
  flex: none;
  padding: 4px 6px;
  border-radius: 4px;
  color: var(--point-ink);
  font-size: 12px;
  font-weight: 400;
}
.point-page .select-all:hover { background: var(--atlas-soft); }
.point-choices {
  display: grid;
  overflow: hidden;
  border: 1px solid var(--point-line);
  border-radius: 8px;
}
.point-choice {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--point-line);
  font-size: 13px;
  font-weight: 400;
  line-height: 1.55;
  color: var(--point-ink);
  cursor: pointer;
  transition: background 140ms ease;
}
.point-choice:last-child { border-bottom: 0; }
.point-choice:not(.is-disabled):hover { background: var(--atlas-soft); }
.point-choice.chosen {
  background: color-mix(in srgb, var(--point-visited) 12%, var(--point-paper));
}
.point-choice.chosen:not(.is-disabled):hover { background: color-mix(in srgb, var(--point-visited) 18%, var(--point-paper)); }
.point-choice.is-disabled { opacity: .5; cursor: not-allowed; }
.point-choice > span { min-width: 0; overflow-wrap: anywhere; }
.point-choice input {
  flex: none;
  margin: 0;
  accent-color: var(--point-visited);
  width: 16px;
  height: 16px;
}
.point-choice small {
  display: block;
  margin-top: 3px;
  opacity: .55;
  font-size: 11px;
  line-height: 1.5;
}
.atlas-confirm-footer {
  flex: 0 0 auto;
  padding: 12px 22px;
  border-top: 1px solid var(--point-line);
  background: var(--point-paper);
}
.point-confirm-actions {
  display: grid;
  grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr);
  gap: 8px;
}
.point-confirm-actions .point-primary-action { justify-content: center; height: 38px; font-size: 13px; }
.point-page .atlas-skip {
  min-height: 38px;
  padding: 7px 10px;
  border: 1px solid var(--point-line);
  border-radius: 8px;
  font-size: 13px;
  font-weight: 400;
  color: var(--point-ink);
}
.point-page .atlas-skip:hover { background: var(--atlas-soft); }
.restore-details {
  position: absolute;
  right: 24px;
  top: 80px;
  max-width: 250px;
  padding: 14px 18px !important;
  display: flex;
  align-items: center;
  gap: 14px;
  border-radius: 12px !important;
  border: 1px solid #dedfd2 !important;
  background: #fffefaf2 !important;
  box-shadow: 0 4px 18px #424b3110 !important;
  font-size: var(--point-body-size) !important;
  color: var(--point-ink) !important;
  pointer-events: auto;
}
@media (max-width: 1050px) {
  .point-panel-head {
    padding: 14px 22px 16px;
  }
  .point-panel-body {
    padding: 0 18px 20px 22px;
  }
  .atlas-confirm-footer {
    padding: 12px 22px;
  }
}
@media (max-width: 740px) {
  .atlas-header {
    height: 56px;
    min-height: 56px;
    padding: 0 18px;
  }
  .atlas-brand {
    gap: 9px;
  }
  .atlas-brand > span {
    font-size: 19px;
  }
  .atlas-brand i {
    margin: 0 2px;
  }
  .atlas-header-actions {
    gap: 14px;
  }
  .atlas-header-actions button span {
    display: none;
  }
  .atlas-header-actions a {
    padding-left: 14px;
    font-size: var(--point-meta-size);
  }
  .atlas-brand h1 {
    font-size: var(--point-body-size);
  }
  .point-workspace {
    position: relative;
  }
  .point-panel {
    position: absolute;
    inset: 0 0 0 auto;
    width: min(350px, 90vw);
    box-shadow: -12px 0 50px #30392a10;
  }
  .point-panel-resize {
    display: none;
  }
  .point-page-caption {
    padding: 0 14px;
    font-size: var(--point-meta-size);
  }
  .point-page-caption-tools {
    gap: 8px;
  }
  .point-page-caption-tools :deep(.basemap-control span) {
    display: none;
  }
  .point-page-caption-tools :deep(.basemap-control select) {
    width: 126px;
  }
  .atlas-save-state {
    display: none;
  }
  .point-panel-head {
    padding: 14px 18px 16px;
  }
  .point-panel-tools {
    margin-bottom: 10px;
  }
  .point-panel h3 {
    font-size: var(--point-title-size);
  }
  .point-panel-body {
    padding: 0 14px 18px 18px;
  }
  .atlas-confirm-footer {
    padding: 12px 18px;
  }
  .restore-details {
    top: auto;
    bottom: 55px;
    right: 18px;
  }
}
</style>
