import {
  emptySnapshot,
  snapshotSchema,
  VISIT_LABELS,
  VISIT_RANK,
  type CatalogEntry,
  type RecordSnapshot,
  type Region,
  type Scope,
  type VisitState,
} from '@fangyu/contracts';
import { CatalogIndex } from '@fangyu/catalog';

export interface EntryView extends CatalogEntry {
  checked: boolean;
  partial: boolean;
  visited: boolean;
  note: string;
  path: string;
}

export class HandbookSession {
  private state: RecordSnapshot;
  private readonly history: RecordSnapshot[] = [];

  constructor(
    readonly index: CatalogIndex,
    snapshot?: RecordSnapshot,
  ) {
    this.state = emptySnapshot(index.catalog.version);
    if (snapshot) this.replace(snapshot);
  }

  get revision(): number {
    return this.state.revision;
  }

  get canUndo(): boolean {
    return this.history.length > 0;
  }

  get preferences() {
    return this.state.preferences;
  }

  snapshot(): RecordSnapshot {
    return structuredClone(this.state);
  }

  validate(input: unknown): RecordSnapshot {
    const snapshot = snapshotSchema.parse(input);
    if (snapshot.catalogVersion !== this.index.catalog.version) {
      throw Error('存档与当前目录版本不同。开发版不支持旧格式迁移。');
    }

    const entries = new Map(this.index.catalog.entries.map((entry) => [entry.id, entry]));
    for (const entry of snapshot.customEntries) {
      if (entries.has(entry.id) || entry.recordId !== entry.id) {
        throw Error('自定义项目 ID 重复或无效。');
      }
      if (!this.index.catalog.categories.some((category) => category.id === entry.categoryId)) {
        throw Error('自定义项目的类别不存在。');
      }
      if (entry.regionIds.some((id) => !this.index.regions.has(id))) {
        throw Error('自定义项目的所属地区不存在。');
      }
      entries.set(entry.id, entry);
    }
    const records = new Map(
      [...entries.values()].map((entry) => [entry.recordId, entries.get(entry.recordId) || entry]),
    );
    for (const id of Object.keys(snapshot.regions)) {
      if (!this.index.regions.has(id)) throw Error('存档中存在未知地区：' + id);
    }
    for (const [id, record] of Object.entries(snapshot.entries)) {
      const entry = records.get(id);
      if (!entry) throw Error('存档中存在未知项目：' + id);
      if (
        record.subitemIds.some((subitemId) => !entry.subitems.some((item) => item.id === subitemId))
      ) {
        throw Error('存档中存在未知组成项目。');
      }
    }
    return snapshot;
  }

  replace(input: unknown): void {
    this.state = this.validate(input);
  }

  transaction(update: () => void): void {
    const previous = this.snapshot();
    try {
      update();
      this.state.revision = previous.revision + 1;
      this.state.updatedAt = new Date().toISOString();
    } catch (error) {
      this.state = previous;
      throw error;
    }
    this.history.push(previous);
    if (this.history.length > 100) this.history.shift();
  }

  undo(): void {
    const previous = this.history.pop();
    if (!previous) return;
    previous.revision = this.state.revision + 1;
    previous.updatedAt = new Date().toISOString();
    this.state = previous;
  }

  visitState(regionId: string): VisitState {
    return this.state.regions[regionId] || 'unvisited';
  }

  hasExplicitState(regionId: string): boolean {
    return Object.hasOwn(this.state.regions, regionId);
  }

  arrived(regionId: string): boolean {
    return VISIT_RANK[this.visitState(regionId)] >= VISIT_RANK.arrived;
  }

  setRegionState(regionId: string, state: VisitState, propagate = true): void {
    if (!this.index.regions.has(regionId) || !(state in VISIT_RANK)) {
      throw Error('无效地区或旅行状态。');
    }
    this.state.regions[regionId] = state;
    if (propagate && this.arrived(regionId)) {
      this.markAncestors(regionId);
    }
  }

  upgradeRegion(regionId: string, state: VisitState): void {
    if (VISIT_RANK[state] > VISIT_RANK[this.visitState(regionId)]) {
      this.setRegionState(regionId, state);
    }
  }

  private markAncestors(regionId: string): void {
    for (const region of this.index.ancestors(regionId)) {
      if (!this.arrived(region.id)) this.state.regions[region.id] = 'arrived';
    }
  }

  allEntries(): CatalogEntry[] {
    return [...this.index.catalog.entries, ...this.state.customEntries];
  }

  entry(id: string): CatalogEntry {
    const entry =
      this.index.entries.get(id) || this.state.customEntries.find((item) => item.id === id);
    if (!entry) throw Error('项目不存在：' + id);
    return entry;
  }

  view(entry: CatalogEntry): EntryView {
    const record = this.state.entries[entry.recordId];
    const subitems = record?.subitemIds || [];
    return {
      ...entry,
      subitems: this.entry(entry.recordId).subitems,
      name: record?.name ?? entry.name,
      note: record?.note || '',
      checked: record?.visited || false,
      partial: !record?.visited && subitems.length > 0,
      visited: Boolean(record?.visited || subitems.length),
      path: entry.regionIds.map((id) => this.index.paths.get(id) || '').join(' / '),
    };
  }

  entries(scope?: Scope): EntryView[] {
    return this.allEntries()
      .filter((entry) => !scope || this.index.entryRegions(entry, scope).length > 0)
      .map((entry) => this.view(entry));
  }

  subitemVisited(entryId: string, subitemId: string): boolean {
    const entry = this.entry(entryId);
    return Boolean(this.state.entries[entry.recordId]?.subitemIds.includes(subitemId));
  }

  private record(entry: CatalogEntry) {
    return (this.state.entries[entry.recordId] ??= { visited: false, subitemIds: [] });
  }

  markEntry(entryId: string, visited: boolean, selectedRegionId?: string): void {
    const entry = this.entry(entryId);
    const record = this.record(entry);
    record.visited = visited;
    if (!visited) record.subitemIds = [];
    if (visited) this.markEntryRegions(entry, selectedRegionId);
  }

  markSubitem(
    entryId: string,
    subitemId: string,
    visited: boolean,
    selectedRegionId?: string,
  ): void {
    const entry = this.entry(entryId);
    const canonicalEntry = this.entry(entry.recordId);
    if (!canonicalEntry.subitems.some((item) => item.id === subitemId)) {
      throw Error('组成项目不存在。');
    }
    const record = this.record(entry);
    const selected = new Set(record.subitemIds);
    if (visited) selected.add(subitemId);
    else selected.delete(subitemId);
    record.subitemIds = [...selected];
    if (visited) this.markEntryRegions(entry, selectedRegionId);
  }

  private markEntryRegions(entry: CatalogEntry, selectedRegionId?: string): void {
    const primaryRegion =
      selectedRegionId && entry.regionIds.includes(selectedRegionId)
        ? selectedRegionId
        : entry.regionIds[0];
    if (primaryRegion) this.markAncestors(primaryRegion);
    for (const linked of this.index.byRecord.get(entry.recordId) || []) {
      if (linked.id === entry.id) continue;
      for (const regionId of linked.regionIds) this.markAncestors(regionId);
    }
    if (entry.linkedRegionId) this.markAncestors(entry.linkedRegionId);

    for (const ids of Object.values(entry.topicRegions || {})) {
      const regionId =
        selectedRegionId && ids.includes(selectedRegionId)
          ? selectedRegionId
          : ids.length === 1
            ? ids[0]
            : undefined;
      if (regionId) this.markAncestors(regionId);
    }
  }

  editEntry(entryId: string, name: string, note: string): void {
    if (!name.trim()) throw Error('名称不能为空。');
    const record = this.record(this.entry(entryId));
    record.name = name.trim();
    record.note = note;
  }

  addEntry(region: Region, categoryId: string, name: string): void {
    if (!name.trim()) throw Error('名称不能为空。');
    const id = crypto.randomUUID();
    this.state.customEntries.push({
      id,
      recordId: id,
      scope: region.scope,
      regionIds: [region.id],
      categoryId,
      name: name.trim(),
      aliases: [],
      subitems: [],
    });
  }

  removeCustomEntry(id: string): void {
    const entry = this.state.customEntries.find((item) => item.id === id);
    if (!entry) throw Error('公共目录项目不能从个人记录中删除。');
    this.state.customEntries = this.state.customEntries.filter((item) => item.id !== id);
    delete this.state.entries[id];
  }

  updatePreferences(preferences: Partial<RecordSnapshot['preferences']>): void {
    this.state.preferences = { ...this.state.preferences, ...preferences };
  }

  clearVisits(): void {
    this.state.regions = {};
    for (const record of Object.values(this.state.entries)) {
      record.visited = false;
      record.subitemIds = [];
    }
  }
}

export { VISIT_LABELS, VISIT_RANK };
