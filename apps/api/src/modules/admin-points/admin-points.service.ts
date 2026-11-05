import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, rm, rename, stat } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { assembleCatalog } from '../../../../../scripts/lib/assemble-manual-china.mjs';

type JsonObject = Record<string, any>;
type Position = [number, number];
const CLEARED_LOCATION_NOTE = '管理页清除了位置。';

interface PointState {
  categories: JsonObject[];
  categoriesData: JsonObject;
  categoryById: Map<string, JsonObject>;
  regions: JsonObject[];
  regionById: Map<string, JsonObject>;
  itemsById: Map<string, { item: JsonObject; file: string; categoryId: string }>;
  itemFiles: Map<string, { path: string; data: JsonObject }>;
  places: JsonObject[];
  placesById: Map<string, JsonObject>;
  placesData: JsonObject;
  components: JsonObject[];
  componentsById: Map<string, JsonObject>;
  componentIdsByItemId: Map<string, string[]>;
  componentsData: JsonObject;
  pending: Map<string, { path: string; data: JsonObject }>;
  pendingByItemId: Map<string, JsonObject>;
  relations: JsonObject[];
  relationsData: JsonObject;
  manifest: JsonObject;
}

function projectRoot() {
  let directory = resolve(process.cwd());
  while (true) {
    if (existsSync(resolve(directory, 'data/manual/china/manifest.json'))) return directory;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw Error('无法定位中国人工维护目录。');
}

function validPosition(value: unknown): value is Position {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((part) => typeof part === 'number' && Number.isFinite(part)) &&
    Math.abs(value[0]) <= 180 &&
    Math.abs(value[1]) <= 90
  );
}

function positionOf(item: JsonObject, place?: JsonObject): Position | null {
  const attributePosition = item.attributes?.coordinates;
  if (validPosition(attributePosition)) return attributePosition;
  const position = place?.location?.position;
  if (position && validPosition([position.longitude, position.latitude]))
    return [position.longitude, position.latitude];
  return null;
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function displayableNote(value: unknown) {
  const note = text(value);
  return note === CLEARED_LOCATION_NOTE ? '' : note;
}

function uniqueStrings(values: unknown): string[] {
  return [
    ...new Set(
      Array.isArray(values)
        ? values.filter(
            (value): value is string => typeof value === 'string' && Boolean(value.trim()),
          )
        : [],
    ),
  ];
}

@Injectable()
export class AdminPointsService {
  private readonly root = projectRoot();
  private readonly manual = resolve(this.root, 'data/manual/china');
  private statePromise: Promise<PointState> | undefined;
  private stateVersion: string | undefined;
  private mutationQueue = Promise.resolve();
  private catalogRevision = -1;
  private catalogValue: JsonObject | undefined;

  private serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async json(path: string): Promise<JsonObject> {
    return JSON.parse(await readFile(path, 'utf8')) as JsonObject;
  }

  private async loadState(): Promise<PointState> {
    const lockPath = resolve(this.manual, '.admin-points-write-lock');
    for (let attempt = 0; existsSync(lockPath) && attempt < 100; attempt++) {
      try {
        const lock = await stat(lockPath);
        // A killed local process cannot run writeTransaction's finally block.
        // Treat its old lock as stale after a minute, while still allowing a
        // normal write to finish before exposing a conflict to the browser.
        if (Date.now() - lock.mtimeMs > 60_000) {
          await rm(lockPath, { recursive: true, force: true });
          break;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
        throw error;
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
    if (existsSync(lockPath)) throw new ConflictException('点位资料仍在保存，请稍后重新载入');
    const manifestPath = resolve(this.manual, 'manifest.json');
    const manifest = await this.json(manifestPath);
    const trackedPaths = [
      manifestPath,
      ...((manifest.files || []) as JsonObject[]).map((file) => resolve(this.manual, file.path)),
    ];
    const fileVersions = await Promise.all(
      trackedPaths.map(async (path) => {
        const fileStat = await stat(path, { bigint: true });
        return `${path}:${fileStat.mtimeNs}:${fileStat.size}`;
      }),
    );
    const version = fileVersions.join('|');
    if (this.statePromise && this.stateVersion === version) return this.statePromise;
    this.stateVersion = version;
    this.statePromise = (async () => {
      const categoriesData = await this.json(resolve(this.manual, 'categories.json'));
      const categoryById = new Map<string, JsonObject>(
        categoriesData.items.map((item: JsonObject) => [item.id, item]),
      );
      const regionIndex = await this.json(resolve(this.manual, 'regions.json'));
      const regionFiles = await Promise.all(
        (regionIndex.files || []).map((file: string) => this.json(resolve(this.manual, file))),
      );
      const regions = regionFiles.flatMap((file) => file.items || []);
      const regionById = new Map<string, JsonObject>(regions.map((region) => [region.id, region]));
      const itemFiles = new Map<string, { path: string; data: JsonObject }>();
      const itemsById = new Map<string, { item: JsonObject; file: string; categoryId: string }>();
      for (const category of categoriesData.items as JsonObject[]) {
        const file = `items/${category.id}.json`;
        const path = resolve(this.manual, file);
        const data = await this.json(path);
        itemFiles.set(category.id, { path, data });
        for (const item of data.items || [])
          itemsById.set(item.id, { item, file, categoryId: category.id });
      }
      const placesData = await this.json(resolve(this.manual, 'places.json'));
      const componentsData = await this.json(resolve(this.manual, 'components.json'));
      const relationsData = await this.json(resolve(this.manual, 'relations.json'));
      const pending = new Map<string, { path: string; data: JsonObject }>();
      for (const relative of ['pending/locations.json', 'pending/airport-locations.json']) {
        const path = resolve(this.manual, relative);
        pending.set(relative, { path, data: await this.json(path) });
      }
      const places = placesData.items || [];
      const placesById = new Map<string, JsonObject>(
        places.map((place: JsonObject) => [place.id, place]),
      );
      const components = componentsData.items || [];
      const componentsById = new Map<string, JsonObject>(
        components.map((component: JsonObject) => [component.id, component]),
      );
      const componentIdsByItemId = new Map<string, string[]>();
      for (const { item } of itemsById.values())
        componentIdsByItemId.set(item.id, uniqueStrings(item.componentIds));
      for (const relation of relationsData.items || []) {
        if (
          relation.type !== 'component-of' ||
          relation.from?.type !== 'component' ||
          relation.to?.type !== 'item'
        )
          continue;
        const ids = componentIdsByItemId.get(relation.to.id) || [];
        ids.push(relation.from.id);
        componentIdsByItemId.set(relation.to.id, ids);
      }
      for (const [id, ids] of componentIdsByItemId)
        componentIdsByItemId.set(id, uniqueStrings(ids));
      const pendingByItemId = new Map<string, JsonObject>();
      for (const { data } of pending.values())
        for (const row of data.items || []) pendingByItemId.set(row.itemId, row);
      return {
        categories: categoriesData.items,
        categoriesData,
        categoryById,
        regions,
        regionById,
        itemsById,
        itemFiles,
        places,
        placesById,
        placesData,
        components,
        componentsById,
        componentIdsByItemId,
        componentsData,
        pending,
        pendingByItemId,
        relations: relationsData.items || [],
        relationsData,
        manifest,
      };
    })().catch((error) => {
      this.statePromise = undefined;
      this.stateVersion = undefined;
      throw error;
    });
    return this.statePromise;
  }

  private invalidate() {
    this.statePromise = undefined;
    this.stateVersion = undefined;
  }

  private view(
    state: PointState,
    entry: { item: JsonObject; file: string; categoryId: string },
    includeComponents = false,
  ): JsonObject {
    const place = state.placesById.get(entry.item.placeId);
    const placeView = place
      ? { ...place, location: { ...place.location, note: displayableNote(place.location?.note) } }
      : null;
    const regionIds = uniqueStrings(entry.item.regionIds);
    const pending = state.pendingByItemId.get(entry.item.id);
    const coordinates = positionOf(entry.item, place);
    const invalidCoordinates =
      entry.item.attributes?.coordinates != null &&
      !validPosition(entry.item.attributes.coordinates);
    const componentIds = state.componentIdsByItemId.get(entry.item.id) || [];
    const locatedComponents = componentIds.filter((id) => {
      const component = state.componentsById.get(id);
      const position = state.placesById.get(component?.placeId)?.location?.position;
      return validPosition([position?.longitude, position?.latitude]);
    }).length;
    const coordinateStatus =
      componentIds.length > 1
        ? locatedComponents === componentIds.length
          ? 'available'
          : locatedComponents > 0
            ? 'incomplete'
            : 'missing'
        : invalidCoordinates
          ? 'invalid'
          : coordinates
            ? 'available'
            : 'missing';
    return {
      ...entry.item,
      categoryId: entry.categoryId,
      categoryName: state.categoryById.get(entry.categoryId)?.name || entry.categoryId,
      sourceFile: entry.file,
      regionIds,
      regions: regionIds.map((id) => {
        const region = state.regionById.get(id);
        return region
          ? { id, name: region.name, path: this.regionPath(state, id) }
          : { id, name: id, path: id };
      }),
      coordinates,
      coordinateStatus,
      place: placeView,
      componentCount: componentIds.length,
      components: includeComponents
        ? componentIds.map((id) => {
            const component = state.componentsById.get(id);
            const componentRegionIds = uniqueStrings(component?.regionIds);
            const componentPlace = state.placesById.get(component?.placeId);
            const position = componentPlace?.location?.position;
            const coordinates = validPosition([position?.longitude, position?.latitude])
              ? ([position.longitude, position.latitude] as Position)
              : null;
            return {
              id,
              name: component?.name || id,
              aliases: uniqueStrings(component?.aliases),
              attributes: component?.attributes || {},
              description: component?.details?.description || '',
              regionIds: componentRegionIds,
              coordinates,
              locationNote: displayableNote(componentPlace?.location?.note),
              regions: componentRegionIds.map((regionId) => {
                const region = state.regionById.get(regionId);
                return region
                  ? { id: regionId, name: region.name, path: this.regionPath(state, regionId) }
                  : { id: regionId, name: regionId, path: regionId };
              }),
            };
          })
        : undefined,
      pending: pending
        ? { status: pending.status || 'pending', reason: displayableNote(pending.reason) }
        : null,
      adminRevision: Number(state.manifest.adminRevision || 0),
    };
  }

  private regionPath(state: PointState, id: string) {
    const result: string[] = [];
    const seen = new Set<string>();
    let current = state.regionById.get(id);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      result.unshift(current.name);
      current = current.parentId ? state.regionById.get(current.parentId) : undefined;
    }
    return result.join(' / ');
  }

  async list(query: {
    q?: string;
    categoryId?: string;
    regionId?: string;
    locationStatus?: string;
    page?: number;
    pageSize?: number;
  }) {
    const state = await this.loadState();
    const q = text(query.q).toLocaleLowerCase();
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(10, Number(query.pageSize) || 50));
    const rows = [...state.itemsById.values()]
      .filter((entry) => !query.categoryId || entry.categoryId === query.categoryId)
      .filter((entry) => {
        if (!query.regionId) return true;
        return uniqueStrings(entry.item.regionIds).some(
          (id) => id === query.regionId || this.belongsTo(state, id, query.regionId!),
        );
      })
      .map((entry) => this.view(state, entry))
      .filter((entry) => {
        if (!query.locationStatus) return true;
        return entry.coordinateStatus === query.locationStatus;
      })
      .filter(
        (entry) =>
          !q ||
          `${entry.name} ${entry.aliases?.join(' ') || ''} ${entry.id} ${entry.code || ''} ${entry.regions.map((region: JsonObject) => region.path).join(' ')}`
            .toLocaleLowerCase()
            .includes(q),
      )
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN'));
    const start = (page - 1) * pageSize;
    return {
      items: rows.slice(start, start + pageSize),
      page,
      pageSize,
      total: rows.length,
      categories: state.categories,
      adminRevision: Number(state.manifest.adminRevision || 0),
      undoAvailable: existsSync(resolve(this.manual, '.admin-undo.json')),
    };
  }

  async get(id: string) {
    const state = await this.loadState();
    const entry = state.itemsById.get(id);
    if (!entry) throw new NotFoundException('点位不存在');
    return this.view(state, entry, true);
  }

  async getComponent(id: string, parentId: string) {
    const state = await this.loadState();
    const component = state.componentsById.get(id);
    if (!component) throw new NotFoundException('子项不存在');
    if (!(state.componentIdsByItemId.get(parentId) || []).includes(id))
      throw new NotFoundException('该子项不属于当前点位');
    const parent = state.itemsById.get(parentId);
    const componentPlace = state.placesById.get(component.placeId);
    const position = componentPlace?.location?.position;
    const coordinates = validPosition([position?.longitude, position?.latitude])
      ? ([position.longitude, position.latitude] as Position)
      : null;
    const regionIds = uniqueStrings(component.regionIds);
    return {
      ...component,
      categoryId: parent?.categoryId,
      categoryFields: state.categoryById.get(parent?.categoryId || '')?.fields || [],
      regionIds,
      regions: regionIds.map((regionId) => {
        const region = state.regionById.get(regionId);
        return region
          ? { id: regionId, name: region.name, path: this.regionPath(state, regionId) }
          : { id: regionId, name: regionId, path: regionId };
      }),
      coordinates,
      locationNote: displayableNote(componentPlace?.location?.note),
      adminRevision: Number(state.manifest.adminRevision || 0),
    };
  }

  async visitorCatalogRevision() {
    const manifest = await this.json(resolve(this.manual, 'manifest.json'));
    return Number(manifest.adminRevision || 0);
  }

  async visitorCatalog() {
    const revision = await this.visitorCatalogRevision();
    if (!this.catalogValue || revision !== this.catalogRevision) {
      this.catalogValue = (await assembleCatalog(this.root)) as JsonObject;
      this.catalogRevision = revision;
    }
    return { revision, catalog: this.catalogValue };
  }

  async regions(q?: string, ids?: string) {
    const state = await this.loadState();
    const requestedIds = uniqueStrings(ids?.split(','));
    if (requestedIds.length) {
      const expanded = new Set(requestedIds);
      for (const id of requestedIds) {
        let current = state.regionById.get(id);
        const seen = new Set<string>();
        while (current?.parentId && !seen.has(current.id)) {
          expanded.add(current.parentId);
          seen.add(current.id);
          current = state.regionById.get(current.parentId);
        }
      }
      return [...expanded]
        .map((id) => state.regionById.get(id))
        .filter((region): region is JsonObject => Boolean(region))
        .map((region) => ({
          id: region.id,
          name: region.name,
          level: region.level,
          code: region.code,
          parentId: region.parentId,
          path: this.regionPath(state, region.id),
        }));
    }
    const query = text(q).toLocaleLowerCase();
    return state.regions
      .filter(
        (region) =>
          !query ||
          `${region.name} ${region.code} ${(region.aliases || []).join(' ')}`
            .toLocaleLowerCase()
            .includes(query),
      )
      .slice(0, 30)
      .map((region) => ({
        id: region.id,
        name: region.name,
        level: region.level,
        code: region.code,
        path: this.regionPath(state, region.id),
      }));
  }

  private belongsTo(state: PointState, id: string, ancestorId: string) {
    let current = state.regionById.get(id);
    const seen = new Set<string>();
    while (current?.parentId && !seen.has(current.id)) {
      if (current.parentId === ancestorId) return true;
      seen.add(current.id);
      current = state.regionById.get(current.parentId);
    }
    return false;
  }

  private async writeJson(path: string, data: JsonObject) {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.admin-${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(data, null, 2) + '\n', 'utf8');
    await rename(temporary, path);
  }

  private async writeTransaction(
    files: { path: string; data: JsonObject }[],
    options: {
      action?: string;
      operation?: 'create' | 'update' | 'location' | 'delete';
      targetId?: string;
      recordUndo?: boolean;
    } = {},
  ) {
    const lockPath = resolve(this.manual, '.admin-points-write-lock');
    const undoPath = resolve(this.manual, '.admin-undo.json');
    const uniqueFiles = [...new Map(files.map((file) => [file.path, file])).values()];
    let locked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        await mkdir(lockPath);
        locked = true;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
      }
    }
    if (!locked) throw new ConflictException('另一项点位资料修改仍在保存，请稍后重试');
    let originals: { path: string; value: string }[] = [];
    let writeStarted = false;
    try {
      originals = await Promise.all([
        ...uniqueFiles.map(async ({ path }) => ({ path, value: await readFile(path, 'utf8') })),
        readFile(undoPath, 'utf8')
          .then((value) => ({ path: undoPath, value }))
          .catch((error) => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw error;
          }),
      ]).then((values) =>
        values.filter((value): value is { path: string; value: string } => value !== null),
      );
      const manifestFile = uniqueFiles.find(
        ({ path }) => path === resolve(this.manual, 'manifest.json'),
      );
      if (manifestFile) {
        const diskManifest = await this.json(manifestFile.path);
        const current = Number(diskManifest.adminRevision || 0);
        const next = Number(manifestFile.data.adminRevision || 0);
        if (next !== current + 1)
          throw new ConflictException('点位资料已被其他窗口修改，请重新载入后再保存');
      }
      let snapshot: JsonObject | undefined;
      const recordUndo = options.recordUndo !== false;
      if (recordUndo) {
        if (!manifestFile) throw new Error('管理事务缺少 manifest.json，无法记录撤销点');
        snapshot = {
          version: 1,
          action: options.action || '修改点位',
          operation: options.operation || 'update',
          targetId: options.targetId || null,
          revision: Number(manifestFile.data.adminRevision || 0),
          files: uniqueFiles.map(({ path, data }) => {
            const original = originals.find((file) => file.path === path);
            if (!original) throw new Error(`缺少事务文件快照：${path}`);
            const relativePath = relative(this.manual, path);
            if (relativePath.startsWith(`..${sep}`) || relativePath === '..')
              throw new Error('事务文件超出人工维护目录');
            const after = JSON.stringify(data, null, 2) + '\n';
            return {
              path: relativePath.replaceAll(sep, '/'),
              before: original.value,
              afterHash: createHash('sha256').update(after).digest('hex'),
            };
          }),
        };
      }
      writeStarted = true;
      for (const file of uniqueFiles) await this.writeJson(file.path, file.data);
      if (snapshot) await this.writeJson(undoPath, snapshot);
      else await rm(undoPath, { force: true });
    } catch (error) {
      if (writeStarted) {
        for (const original of originals)
          await this.writeJson(original.path, JSON.parse(original.value) as JsonObject);
        if (!originals.some((original) => original.path === undoPath))
          await rm(undoPath, { force: true });
      }
      this.invalidate();
      throw error;
    } finally {
      await rm(lockPath, { recursive: true, force: true });
    }
    this.invalidate();
  }

  private async updateManifest(state: PointState, touched: string[]) {
    const counts = state.manifest.counts || (state.manifest.counts = {});
    counts.items = [...state.itemFiles.values()].reduce(
      (sum, file) => sum + (file.data.items || []).length,
      0,
    );
    counts.places = state.placesData.items.length;
    counts.missingLocations = state.pending.get('pending/locations.json')?.data.items?.length || 0;
    counts.categories = state.categories.length;
    counts.components = state.componentsData.items.length;
    counts.relations = state.relations.length;
    const fileEntries = Array.isArray(state.manifest.files) ? state.manifest.files : [];
    for (const relative of touched) {
      const current = fileEntries.find((file: JsonObject) => file.path === relative);
      const source = relative.startsWith('items/')
        ? state.itemFiles.get(relative.slice(6))?.data
        : relative === 'categories.json'
          ? state.categoriesData
          : relative === 'places.json'
            ? state.placesData
            : relative === 'components.json'
              ? state.componentsData
              : relative === 'relations.json'
                ? state.relationsData
                : state.pending.get(relative)?.data;
      if (current && source && Array.isArray(source.items)) current.count = source.items.length;
    }
    state.manifest.adminRevision = Number(state.manifest.adminRevision || 0) + 1;
  }

  private assertRevision(state: PointState, input: JsonObject) {
    const current = Number(state.manifest.adminRevision || 0);
    if (input.expectedRevision !== undefined && Number(input.expectedRevision) !== current)
      throw new ConflictException('点位资料已被其他窗口修改，请重新载入后再保存');
  }

  private assertRegions(state: PointState, regionIds: string[]) {
    const invalid = regionIds.filter((id) => !state.regionById.has(id));
    if (invalid.length) throw new BadRequestException(`未知政区：${invalid.join('、')}`);
  }

  create(input: JsonObject) {
    return this.serializeMutation(() => this.createLocked(input));
  }

  private async createLocked(input: JsonObject) {
    const state = await this.loadState();
    this.assertRevision(state, input);
    const categoryId = text(input.categoryId);
    if (!state.categoryById.has(categoryId)) throw new BadRequestException('未知点位类别');
    const name = text(input.name);
    if (!name) throw new BadRequestException('点位名称不能为空');
    const id = randomUUID();
    const regionIds = uniqueStrings(input.regionIds);
    this.assertRegions(state, regionIds);
    const item: JsonObject = {
      id,
      recordId: id,
      order: 0,
      kind: 'item',
      name,
      aliases: uniqueStrings(input.aliases),
      categoryIds: [categoryId],
      regionIds,
      placeId: null,
      componentIds: [],
      identifiers: [],
      sourceRefs: [],
      display: {},
      details: { description: text(input.description) || null },
      group: {},
      attributes: Object.fromEntries(
        ((state.categoryById.get(categoryId)?.fields || []) as JsonObject[])
          .filter((field) => typeof field.key === 'string')
          .map((field) => [field.key, '']),
      ),
    };
    const file = state.itemFiles.get(categoryId);
    if (!file) throw new BadRequestException('点位类别源文件不存在');
    file.data.items.push(item);
    await this.updateManifest(state, [`items/${categoryId}.json`]);
    await this.writeTransaction(
      [
        { path: file.path, data: file.data },
        { path: resolve(this.manual, 'manifest.json'), data: state.manifest },
      ],
      { action: '新建点位', operation: 'create', targetId: id },
    );
    return this.get(id);
  }

  update(id: string, input: JsonObject) {
    return this.serializeMutation(() => this.updateLocked(id, input));
  }

  private async updateLocked(id: string, input: JsonObject) {
    const state = await this.loadState();
    this.assertRevision(state, input);
    const entry = state.itemsById.get(id);
    if (!entry) throw new NotFoundException('点位不存在');
    const item = entry.item;
    if (input.name !== undefined) {
      const name = text(input.name);
      if (!name) throw new BadRequestException('点位名称不能为空');
      item.name = name;
    }
    if (input.aliases !== undefined) item.aliases = uniqueStrings(input.aliases);
    if (input.regionIds !== undefined) {
      const nextRegionIds = uniqueStrings(input.regionIds);
      this.assertRegions(state, nextRegionIds);
      item.regionIds = nextRegionIds;
    }
    if (input.details !== undefined) item.details = { ...(item.details || {}), ...input.details };
    if (input.description !== undefined)
      item.details = { ...(item.details || {}), description: text(input.description) || null };
    for (const key of ['identifiers', 'sourceRefs', 'display', 'group'])
      if (input[key] !== undefined) item[key] = input[key];
    if (input.attributes !== undefined)
      item.attributes = { ...(item.attributes || {}), ...input.attributes };
    const files = new Map<string, { path: string; data: JsonObject }>();
    const itemFile = state.itemFiles.get(entry.categoryId)!;
    files.set(itemFile.path, itemFile);
    let place = state.placesById.get(item.placeId);
    if (input.coordinates !== undefined || input.note !== undefined) {
      const coordinates = input.coordinates === undefined
        ? positionOf(item, place)
        : input.coordinates === null ? null : input.coordinates;
      if (coordinates !== null && !validPosition(coordinates))
        throw new BadRequestException('经纬度格式无效');
      if (!item.attributes || typeof item.attributes !== 'object') item.attributes = {};
      if (coordinates) item.attributes.coordinates = coordinates;
      else delete item.attributes.coordinates;
      if (!place && (coordinates || text(input.note))) {
        const placeId = `place-${id}`;
        place = {
          id: placeId,
          name: item.name,
          aliases: item.aliases || [],
          regionIds: item.regionIds || [],
          identifiers: item.identifiers || [],
          sourceRefs: item.sourceRefs || [],
          location: {
            status: coordinates ? 'available' : 'missing',
            kind: 'site-point',
            position: coordinates ? { longitude: coordinates[0], latitude: coordinates[1] } : undefined,
            method: text(input.method) || 'manual-map',
            note: text(input.note),
            visitorEntranceVerified: input.visitorEntranceVerified === true,
          },
        };
        state.placesData.items.push(place);
        state.places.push(place);
        state.placesById.set(placeId, place);
        item.placeId = placeId;
      } else if (place) {
        place.regionIds = item.regionIds || place.regionIds || [];
        place.location = coordinates
          ? {
              ...(place.location || {}),
              status: 'available',
              position: { longitude: coordinates[0], latitude: coordinates[1] },
              method: text(input.method) || place.location?.method || 'manual-map',
              note: input.note === undefined ? displayableNote(place.location?.note) : text(input.note),
              visitorEntranceVerified:
                input.visitorEntranceVerified ?? place.location?.visitorEntranceVerified ?? false,
            }
          : {
              ...(place.location || {}),
              status: 'missing',
              position: undefined,
              method: text(input.method) || place.location?.method || 'manual-map',
              note: input.note === undefined ? displayableNote(place.location?.note) : text(input.note),
            };
      }
      const pendingLocations = state.pending.get('pending/locations.json');
      if (pendingLocations) {
        const before = pendingLocations.data.items || [];
        pendingLocations.data.items = coordinates
          ? before.filter((row: JsonObject) => row.itemId !== id)
          : before.some((row: JsonObject) => row.itemId === id)
            ? before
            : [...before, { itemId: id, status: 'missing' }];
        files.set(pendingLocations.path, pendingLocations);
      }
      const airportPending = state.pending.get('pending/airport-locations.json');
      if (airportPending) {
        airportPending.data.items = (airportPending.data.items || []).filter(
          (row: JsonObject) => row.itemId !== id,
        );
        files.set(airportPending.path, airportPending);
      }
    }
    if (place) {
      place.name = item.name;
      place.aliases = item.aliases || [];
      place.regionIds = item.regionIds || [];
      place.identifiers = item.identifiers || [];
      place.sourceRefs = item.sourceRefs || [];
      files.set(resolve(this.manual, 'places.json'), {
        path: resolve(this.manual, 'places.json'),
        data: state.placesData,
      });
    }
    await this.updateManifest(state, [
      entry.file,
      'places.json',
      'pending/locations.json',
      'pending/airport-locations.json',
    ]);
    files.set(resolve(this.manual, 'manifest.json'), {
      path: resolve(this.manual, 'manifest.json'),
      data: state.manifest,
    });
    await this.writeTransaction([...files.values()], {
      action: '修改点位',
      operation: 'update',
      targetId: id,
    });
    return this.get(id);
  }

  updateComponent(parentId: string, id: string, input: JsonObject) {
    return this.serializeMutation(() => this.updateComponentLocked(parentId, id, input));
  }

  createComponent(parentId: string, input: JsonObject) {
    return this.serializeMutation(() => this.createComponentLocked(parentId, input));
  }

  private async createComponentLocked(parentId: string, input: JsonObject) {
    const state = await this.loadState();
    this.assertRevision(state, input);
    const parent = state.itemsById.get(parentId);
    if (!parent) throw new NotFoundException('点位不存在');
    const name = text(input.name);
    if (!name) throw new BadRequestException('子项名称不能为空');
    const regionIds =
      input.regionIds === undefined
        ? uniqueStrings(parent.item.regionIds)
        : uniqueStrings(input.regionIds);
    this.assertRegions(state, regionIds);
    const id = randomUUID();
    const component: JsonObject = {
      id,
      name,
      aliases: [],
      regionIds,
      placeId: null,
      sourceRefs: [],
      details: { description: null },
      attributes: Object.fromEntries(
        ((state.categoryById.get(parent.categoryId)?.fields || []) as JsonObject[])
          .filter((field) => typeof field.key === 'string')
          .map((field) => [field.key, '']),
      ),
    };
    state.componentsData.items.push(component);
    state.components.push(component);
    state.componentsById.set(id, component);
    const componentIds = uniqueStrings(parent.item.componentIds);
    parent.item.componentIds = [...componentIds, id];
    const parentRegions = uniqueStrings([...(parent.item.regionIds || []), ...regionIds]);
    parent.item.regionIds = parentRegions;
    const relationIds = new Set(state.relations.map((relation) => relation.id));
    let relationId = `component-of-${id}`;
    if (relationIds.has(relationId)) relationId = `component-of-${randomUUID()}`;
    const relation = {
      id: relationId,
      type: 'component-of',
      from: { type: 'component', id },
      to: { type: 'item', id: parentId },
      order: componentIds.length,
    };
    state.relations.push(relation);
    state.relationsData.items = state.relations;
    const parentPlace = state.placesById.get(parent.item.placeId);
    if (parentPlace)
      parentPlace.regionIds = uniqueStrings([...(parentPlace.regionIds || []), ...regionIds]);
    await this.updateManifest(state, [
      parent.file,
      'components.json',
      'relations.json',
      'places.json',
    ]);
    await this.writeTransaction(
      [
        {
          path: state.itemFiles.get(parent.categoryId)!.path,
          data: state.itemFiles.get(parent.categoryId)!.data,
        },
        { path: resolve(this.manual, 'components.json'), data: state.componentsData },
        { path: resolve(this.manual, 'relations.json'), data: state.relationsData },
        { path: resolve(this.manual, 'places.json'), data: state.placesData },
        { path: resolve(this.manual, 'manifest.json'), data: state.manifest },
      ],
      { action: '添加组成地点', operation: 'update', targetId: parentId },
    );
    return this.getComponent(id, parentId);
  }

  removeComponent(parentId: string, id: string, input: JsonObject = {}) {
    return this.serializeMutation(() => this.removeComponentLocked(parentId, id, input));
  }

  private async removeComponentLocked(parentId: string, id: string, input: JsonObject) {
    const state = await this.loadState();
    this.assertRevision(state, input);
    const parent = state.itemsById.get(parentId);
    const component = state.componentsById.get(id);
    if (!parent) throw new NotFoundException('点位不存在');
    if (!component || !(state.componentIdsByItemId.get(parentId) || []).includes(id))
      throw new NotFoundException('该子项不属于当前点位');
    parent.item.componentIds = uniqueStrings(parent.item.componentIds).filter(
      (value) => value !== id,
    );
    state.relations = state.relations.filter(
      (relation) =>
        !(
          relation.type === 'component-of' &&
          relation.from?.type === 'component' &&
          relation.from.id === id &&
          relation.to?.type === 'item' &&
          relation.to.id === parentId
        ),
    );
    state.relationsData.items = state.relations;
    const stillReferenced =
      [...state.itemsById.values()].some(
        ({ item }) => item.id !== parentId && uniqueStrings(item.componentIds).includes(id),
      ) ||
      state.relations.some(
        (relation) =>
          (relation.from?.type === 'component' && relation.from.id === id) ||
          (relation.to?.type === 'component' && relation.to.id === id),
      );
    const files: { path: string; data: JsonObject }[] = [
      {
        path: state.itemFiles.get(parent.categoryId)!.path,
        data: state.itemFiles.get(parent.categoryId)!.data,
      },
      { path: resolve(this.manual, 'relations.json'), data: state.relationsData },
    ];
    const touched = [parent.file, 'relations.json'];
    if (!stillReferenced) {
      state.componentsData.items = state.componentsData.items.filter(
        (value: JsonObject) => value.id !== id,
      );
      state.components = state.components.filter((value) => value.id !== id);
      state.componentsById.delete(id);
      files.push({ path: resolve(this.manual, 'components.json'), data: state.componentsData });
      touched.push('components.json');
      const placeId = component.placeId;
      const referencedPlace =
        typeof placeId === 'string' &&
        ([...state.itemsById.values()].some(
          ({ item }) => item.id !== parentId && item.placeId === placeId,
        ) ||
          state.componentsData.items.some((value: JsonObject) => value.placeId === placeId));
      if (placeId && !referencedPlace) {
        state.placesData.items = state.placesData.items.filter(
          (value: JsonObject) => value.id !== placeId,
        );
        state.places = state.places.filter((value) => value.id !== placeId);
        state.placesById.delete(placeId);
        files.push({ path: resolve(this.manual, 'places.json'), data: state.placesData });
        touched.push('places.json');
      }
    }
    await this.updateManifest(state, touched);
    files.push({ path: resolve(this.manual, 'manifest.json'), data: state.manifest });
    await this.writeTransaction(files, {
      action: '删除组成地点',
      operation: 'update',
      targetId: parentId,
    });
    return {
      id,
      parentId,
      deleted: !stillReferenced,
      componentCount: parent.item.componentIds.length,
      adminRevision: state.manifest.adminRevision,
    };
  }

  private async updateComponentLocked(parentId: string, id: string, input: JsonObject) {
    const state = await this.loadState();
    this.assertRevision(state, input);
    const component = state.componentsById.get(id);
    if (!component) throw new NotFoundException('子项不存在');
    if (!(state.componentIdsByItemId.get(parentId) || []).includes(id))
      throw new NotFoundException('该子项不属于当前点位');
    const parent = state.itemsById.get(parentId);
    if (!parent) throw new NotFoundException('点位不存在');
    const name = input.name === undefined ? component.name : text(input.name);
    if (!name) throw new BadRequestException('子项名称不能为空');
    const regionIds =
      input.regionIds === undefined
        ? uniqueStrings(component.regionIds)
        : uniqueStrings(input.regionIds);
    this.assertRegions(state, regionIds);
    const aliases =
      input.aliases === undefined ? uniqueStrings(component.aliases) : uniqueStrings(input.aliases);
    const currentPlace = state.placesById.get(component.placeId);
    const currentPosition = currentPlace?.location?.position;
    const coordinates =
      input.coordinates === undefined
        ? validPosition([currentPosition?.longitude, currentPosition?.latitude])
          ? ([currentPosition.longitude, currentPosition.latitude] as Position)
          : null
        : input.coordinates === null
          ? null
          : input.coordinates;
    if (coordinates !== null && !validPosition(coordinates))
      throw new BadRequestException('经纬度格式无效');
    component.name = name;
    component.aliases = aliases;
    component.regionIds = regionIds;
    parent.item.regionIds = uniqueStrings([...(parent.item.regionIds || []), ...regionIds]);
    if (input.description !== undefined)
      component.details = {
        ...(component.details || {}),
        description: text(input.description) || null,
      };
    if (input.attributes !== undefined)
      component.attributes = { ...(component.attributes || {}), ...input.attributes };
    let place = currentPlace;
    if (!place && (coordinates || text(input.note))) {
      const placeId = `component-place-${id}`;
      place = {
        id: placeId,
        name,
        aliases,
        regionIds,
        identifiers: [],
        sourceRefs: component.sourceRefs || [],
        location: {
          status: coordinates ? 'available' : 'missing',
          kind: 'site-point',
          position: coordinates ? { longitude: coordinates[0], latitude: coordinates[1] } : undefined,
          method: 'admin-map',
          note: text(input.note),
        },
      };
      component.placeId = placeId;
      state.placesData.items.push(place);
      state.places.push(place);
      state.placesById.set(placeId, place);
    } else if (place) {
      place.name = name;
      place.aliases = aliases;
      place.regionIds = regionIds;
      place.sourceRefs = component.sourceRefs || place.sourceRefs || [];
      place.location = coordinates
        ? {
            ...(place.location || {}),
            status: 'available',
            position: { longitude: coordinates[0], latitude: coordinates[1] },
            method: 'admin-map',
            note: input.note === undefined ? displayableNote(place.location?.note) : text(input.note),
          }
        : {
            ...(place.location || {}),
            status: 'missing',
            position: undefined,
            method: 'admin-map',
            note: input.note === undefined ? displayableNote(place.location?.note) : text(input.note),
          };
    }
    const parentPlace = state.placesById.get(parent.item.placeId);
    if (parentPlace)
      parentPlace.regionIds = uniqueStrings([...(parentPlace.regionIds || []), ...regionIds]);
    await this.updateManifest(state, [parent.file, 'components.json', 'places.json']);
    await this.writeTransaction(
      [
        {
          path: state.itemFiles.get(parent.categoryId)!.path,
          data: state.itemFiles.get(parent.categoryId)!.data,
        },
        { path: resolve(this.manual, 'components.json'), data: state.componentsData },
        { path: resolve(this.manual, 'places.json'), data: state.placesData },
        { path: resolve(this.manual, 'manifest.json'), data: state.manifest },
      ],
      { action: '修改子项', operation: 'update', targetId: parentId },
    );
    return this.getComponent(id, parentId);
  }

  updateCategoryField(id: string, input: JsonObject) {
    return this.serializeMutation(() => this.updateCategoryFieldLocked(id, input));
  }

  private async updateCategoryFieldLocked(id: string, input: JsonObject) {
    const state = await this.loadState();
    this.assertRevision(state, input);
    const category = state.categoryById.get(id);
    const itemFile = state.itemFiles.get(id);
    if (!category || !itemFile) throw new NotFoundException('点位类别不存在');
    const fields = Array.isArray(category.fields)
      ? (category.fields as JsonObject[])
      : (category.fields = []);
    const action = text(input.action);
    const key = text(input.key);
    let actionName: string;
    if (action === 'add') {
      const label = text(input.label);
      if (!/^[a-z][A-Za-z0-9_]*$/.test(key))
        throw new BadRequestException(
          '保存字段名称须以英文字母开头，只能包含英文字母、数字和下划线',
        );
      if (!label) throw new BadRequestException('字段名称不能为空');
      if (
        [
          'id',
          'recordId',
          'name',
          'categoryIds',
          'regionIds',
          'coordinates',
          'description',
        ].includes(key)
      )
        throw new BadRequestException('该字段名称为系统保留名称');
      if (fields.some((field) => field.key === key))
        throw new ConflictException('该保存字段已存在');
      fields.push({ key, label });
      for (const item of itemFile.data.items || []) {
        if (!item.attributes || typeof item.attributes !== 'object') item.attributes = {};
        if (!Object.hasOwn(item.attributes, key)) item.attributes[key] = '';
      }
      const relatedComponents = new Set(
        (itemFile.data.items || []).flatMap(
          (item: JsonObject) => state.componentIdsByItemId.get(item.id) || [],
        ),
      );
      for (const component of state.componentsData.items || []) {
        if (!relatedComponents.has(component.id)) continue;
        if (!component.attributes || typeof component.attributes !== 'object')
          component.attributes = {};
        if (!Object.hasOwn(component.attributes, key)) component.attributes[key] = '';
      }
      actionName = '添加保存字段';
    } else if (action === 'remove') {
      if (!fields.some((field) => field.key === key)) throw new NotFoundException('保存字段不存在');
      category.fields = fields.filter((field) => field.key !== key);
      for (const item of itemFile.data.items || [])
        if (item.attributes) delete item.attributes[key];
      const relatedComponents = new Set(
        (itemFile.data.items || []).flatMap(
          (item: JsonObject) => state.componentIdsByItemId.get(item.id) || [],
        ),
      );
      for (const component of state.componentsData.items || [])
        if (relatedComponents.has(component.id) && component.attributes)
          delete component.attributes[key];
      actionName = '删除保存字段';
    } else {
      throw new BadRequestException('未知字段操作');
    }
    await this.updateManifest(state, ['categories.json', `items/${id}.json`, 'components.json']);
    await this.writeTransaction(
      [
        { path: resolve(this.manual, 'categories.json'), data: state.categoriesData },
        { path: itemFile.path, data: itemFile.data },
        { path: resolve(this.manual, 'components.json'), data: state.componentsData },
        { path: resolve(this.manual, 'manifest.json'), data: state.manifest },
      ],
      { action: actionName, operation: 'update', targetId: text(input.targetId) },
    );
    return { fields: category.fields, adminRevision: Number(state.manifest.adminRevision || 0) };
  }

  updateLocation(id: string, input: JsonObject) {
    return this.serializeMutation(() => this.updateLocationLocked(id, input));
  }

  private async updateLocationLocked(id: string, input: JsonObject) {
    const state = await this.loadState();
    this.assertRevision(state, input);
    const entry = state.itemsById.get(id);
    if (!entry) throw new NotFoundException('点位不存在');
    const coordinates = input.coordinates === null ? null : input.coordinates;
    if (coordinates !== null && !validPosition(coordinates))
      throw new BadRequestException('经纬度格式无效');
    if (input.regionIds !== undefined) {
      const nextRegionIds = uniqueStrings(input.regionIds);
      this.assertRegions(state, nextRegionIds);
      entry.item.regionIds = nextRegionIds;
    }
    const files = new Map<string, { path: string; data: JsonObject }>();
    const itemFile = state.itemFiles.get(entry.categoryId)!;
    if (!entry.item.attributes || typeof entry.item.attributes !== 'object')
      entry.item.attributes = {};
    if (coordinates) entry.item.attributes.coordinates = coordinates;
    else delete entry.item.attributes.coordinates;
    let place = state.placesById.get(entry.item.placeId);
    if (!place && (coordinates || text(input.note))) {
      const placeId = `place-${id}`;
      place = {
        id: placeId,
        name: entry.item.name,
        aliases: entry.item.aliases || [],
        regionIds: entry.item.regionIds || [],
        identifiers: entry.item.identifiers || [],
        sourceRefs: entry.item.sourceRefs || [],
        location: {
          status: coordinates ? 'available' : 'missing',
          kind: 'site-point',
          position: coordinates ? { longitude: coordinates[0], latitude: coordinates[1] } : undefined,
          method: input.method || 'manual-map',
          note: text(input.note),
          visitorEntranceVerified: input.visitorEntranceVerified === true,
        },
      };
      state.placesData.items.push(place);
      state.places.push(place);
      state.placesById.set(placeId, place);
      entry.item.placeId = placeId;
    } else if (place) {
      place.regionIds = entry.item.regionIds || place.regionIds || [];
      place.location = coordinates
        ? {
            ...(place.location || {}),
            status: 'available',
            position: { longitude: coordinates[0], latitude: coordinates[1] },
            method: text(input.method) || place.location?.method || 'manual-map',
            note: input.note === undefined ? displayableNote(place.location?.note) : text(input.note),
            visitorEntranceVerified:
              input.visitorEntranceVerified ?? place.location?.visitorEntranceVerified ?? false,
          }
        : {
            ...(place.location || {}),
            status: 'missing',
            position: undefined,
            method: text(input.method) || place.location?.method || 'manual-map',
            note: input.note === undefined ? displayableNote(place.location?.note) : text(input.note),
          };
    }
    files.set(itemFile.path, itemFile);
    files.set(resolve(this.manual, 'places.json'), {
      path: resolve(this.manual, 'places.json'),
      data: state.placesData,
    });
    const pendingLocations = state.pending.get('pending/locations.json');
    if (pendingLocations) {
      const before = pendingLocations.data.items || [];
      pendingLocations.data.items = coordinates
        ? before.filter((row: JsonObject) => row.itemId !== id)
        : before.some((row: JsonObject) => row.itemId === id)
          ? before
          : [...before, { itemId: id, status: 'missing' }];
      files.set(pendingLocations.path, pendingLocations);
    }
    const airportPending = state.pending.get('pending/airport-locations.json');
    if (airportPending) {
      airportPending.data.items = (airportPending.data.items || []).filter(
        (row: JsonObject) => row.itemId !== id,
      );
      files.set(airportPending.path, airportPending);
    }
    await this.updateManifest(state, [
      entry.file,
      'places.json',
      'pending/locations.json',
      'pending/airport-locations.json',
    ]);
    files.set(resolve(this.manual, 'manifest.json'), {
      path: resolve(this.manual, 'manifest.json'),
      data: state.manifest,
    });
    await this.writeTransaction([...files.values()], {
      action: '修改位置',
      operation: 'location',
      targetId: id,
    });
    return this.get(id);
  }

  remove(id: string, input: JsonObject = {}) {
    return this.serializeMutation(() => this.removeLocked(id, input));
  }

  private async removeLocked(id: string, input: JsonObject) {
    const state = await this.loadState();
    this.assertRevision(state, input);
    const entry = state.itemsById.get(id);
    if (!entry) throw new NotFoundException('点位不存在');
    const componentIds = uniqueStrings([
      ...(Array.isArray(entry.item.componentIds) ? entry.item.componentIds : []),
      ...state.relations
        .filter(
          (relation) =>
            relation.type === 'component-of' &&
            relation.to?.type === 'item' &&
            relation.to.id === id,
        )
        .map((relation) => (relation.from?.type === 'component' ? relation.from.id : '')),
    ]);
    const file = state.itemFiles.get(entry.categoryId)!;
    file.data.items = file.data.items.filter((item: JsonObject) => item.id !== id);
    const removedRelations = state.relations.filter(
      (relation) =>
        (relation.from?.type === 'item' && relation.from.id === id) ||
        (relation.to?.type === 'item' && relation.to.id === id),
    );
    state.relations = state.relations.filter((relation) => !removedRelations.includes(relation));
    state.relationsData.items = state.relations;
    const deletedComponents: JsonObject[] = [];
    for (const componentId of componentIds) {
      const referencedByItem = [...state.itemsById.values()].some(
        ({ item }) =>
          item.id !== id &&
          Array.isArray(item.componentIds) &&
          item.componentIds.includes(componentId),
      );
      const referencedByRelation = state.relations.some(
        (relation) =>
          (relation.from?.type === 'component' && relation.from.id === componentId) ||
          (relation.to?.type === 'component' && relation.to.id === componentId),
      );
      if (!referencedByItem && !referencedByRelation) {
        const component = state.componentsById.get(componentId);
        if (component) deletedComponents.push(component);
      }
    }
    if (deletedComponents.length) {
      const deletedIds = new Set(deletedComponents.map((component) => component.id));
      state.componentsData.items = state.componentsData.items.filter(
        (component: JsonObject) => !deletedIds.has(component.id),
      );
      state.components = state.components.filter((component) => !deletedIds.has(component.id));
      state.relations = state.relations.filter(
        (relation) =>
          !(relation.from?.type === 'component' && deletedIds.has(relation.from.id)) &&
          !(relation.to?.type === 'component' && deletedIds.has(relation.to.id)),
      );
      state.relationsData.items = state.relations;
    }
    const candidatePlaceIds = new Set(
      [entry.item.placeId, ...deletedComponents.map((component) => component.placeId)].filter(
        (placeId): placeId is string => typeof placeId === 'string' && Boolean(placeId),
      ),
    );
    const deletedPlaceIds = [...candidatePlaceIds].filter(
      (placeId) =>
        ![...state.itemsById.values()].some(
          ({ item }) => item.id !== id && item.placeId === placeId,
        ) &&
        !state.componentsData.items.some((component: JsonObject) => component.placeId === placeId),
    );
    if (deletedPlaceIds.length) {
      const deletedPlaces = new Set(deletedPlaceIds);
      state.placesData.items = state.placesData.items.filter(
        (place: JsonObject) => !deletedPlaces.has(place.id),
      );
      state.places = state.places.filter((place) => !deletedPlaces.has(place.id));
      for (const placeId of deletedPlaces) state.placesById.delete(placeId);
    }
    const files = [{ path: file.path, data: file.data }];
    if (removedRelations.length || deletedComponents.length)
      files.push({ path: resolve(this.manual, 'relations.json'), data: state.relationsData });
    if (deletedComponents.length)
      files.push({ path: resolve(this.manual, 'components.json'), data: state.componentsData });
    if (deletedPlaceIds.length)
      files.push({ path: resolve(this.manual, 'places.json'), data: state.placesData });
    for (const pending of state.pending.values()) {
      pending.data.items = (pending.data.items || []).filter(
        (row: JsonObject) => row.itemId !== id,
      );
      files.push({ path: pending.path, data: pending.data });
    }
    await this.updateManifest(state, [
      entry.file,
      'components.json',
      'relations.json',
      'places.json',
      'pending/locations.json',
      'pending/airport-locations.json',
    ]);
    files.push({ path: resolve(this.manual, 'manifest.json'), data: state.manifest });
    await this.writeTransaction(files, { action: '删除点位', operation: 'delete', targetId: id });
    return { id, deleted: true, deletedComponentCount: deletedComponents.length };
  }

  undo() {
    return this.serializeMutation(() => this.undoLocked());
  }

  private async undoLocked() {
    const undoPath = resolve(this.manual, '.admin-undo.json');
    if (!existsSync(undoPath)) throw new ConflictException('没有可撤销的管理操作');
    const snapshot = await this.json(undoPath);
    const state = await this.loadState();
    const revision = Number(state.manifest.adminRevision || 0);
    if (
      snapshot.version !== 1 ||
      Number(snapshot.revision) !== revision ||
      !Array.isArray(snapshot.files)
    )
      throw new ConflictException('点位 JSON 已发生其它修改，撤销记录已失效');
    const tracked = new Set<string>([
      'manifest.json',
      ...(state.manifest.files || []).map((file: JsonObject) => file.path),
    ]);
    const restoreFiles: { path: string; data: JsonObject }[] = [];
    let previousManifest: JsonObject | undefined;
    for (const entry of snapshot.files as JsonObject[]) {
      if (typeof entry.path !== 'string' || !tracked.has(entry.path) || entry.path.includes('..'))
        throw new ConflictException('撤销记录包含无效文件路径');
      const path = resolve(this.manual, entry.path);
      const currentRaw = await readFile(path, 'utf8');
      const currentHash = createHash('sha256').update(currentRaw).digest('hex');
      if (currentHash !== entry.afterHash)
        throw new ConflictException('相关 JSON 已被修改，撤销记录已失效');
      let data: JsonObject;
      try {
        data = JSON.parse(entry.before) as JsonObject;
      } catch {
        throw new ConflictException('撤销记录已损坏');
      }
      if (entry.path === 'manifest.json') previousManifest = data;
      restoreFiles.push({ path, data });
    }
    if (!previousManifest) throw new ConflictException('撤销记录缺少 manifest.json');
    previousManifest.adminRevision = revision + 1;
    restoreFiles.find((file) => file.path === resolve(this.manual, 'manifest.json'))!.data =
      previousManifest;
    const result = {
      id: typeof snapshot.targetId === 'string' ? snapshot.targetId : null,
      action: typeof snapshot.action === 'string' ? snapshot.action : '管理操作',
      operation: snapshot.operation,
      revision: revision + 1,
    };
    await this.writeTransaction(restoreFiles, { recordUndo: false });
    return result;
  }
}
