import { readFile } from 'node:fs/promises';
import path from 'node:path';

const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const levelNumber = { province: 0, city: 1, county: 2 };

export async function assembleCatalog(root) {
  const catalogPath = path.join(root, 'data/catalog/catalog.json');
  const manual = path.join(root, 'data/manual/china');
  const base = await json(catalogPath);
  await json(path.join(manual, 'manifest.json'));
  const regionIndex = await json(path.join(manual, 'regions.json'));
  const regionFiles = await Promise.all(
    regionIndex.files.map((file) => json(path.join(manual, file))),
  );
  const regions = regionFiles.flatMap((file) => file.items).map((region) => ({
    ...region,
    level: levelNumber[region.level] ?? region.level,
    scope: 'china',
  }));
  const regionIds = new Set(regions.map((region) => region.id));
  const baseEntries = base.entries.filter((entry) => entry.scope !== 'china');
  const usedBaseCategories = new Set(baseEntries.map((entry) => entry.categoryId));

  const componentData = await json(path.join(manual, 'components.json'));
  const components = new Map(componentData.items.map((component) => [component.id, component]));
  const placeData = await json(path.join(manual, 'places.json'));
  const places = new Map(placeData.items.map((place) => [place.id, place]));
  const sourceData = await json(path.join(manual, 'sources.json'));
  const manualSources = new Map(sourceData.items.map((source) => [source.id, source]));
  const categoryData = await json(path.join(manual, 'categories.json'));
  const manualCategoryIds = new Set(categoryData.items.map((category) => category.id));
  const itemFiles = await Promise.all(
    [...manualCategoryIds].map((id) => json(path.join(manual, 'items', id + '.json'))),
  );
  const entries = itemFiles.flatMap((file) => file.items).map((item) => {
    const attributes = item.attributes || {};
    const place = item.placeId ? places.get(item.placeId) : undefined;
    const subitems = (item.componentIds || [])
      .map((id) => components.get(id))
      .filter(Boolean)
      .map((component) => ({ id: component.id, name: component.name }));
    const coordinates = attributes.coordinates || place?.location?.position
      ? attributes.coordinates || [place.location.position.longitude, place.location.position.latitude]
      : null;
    const source = item.sourceRefs?.map((id) => manualSources.get(id)).find((value) => value?.url)?.url || '';
    const coordinateSource = place?.location?.sourceRef
      ? manualSources.get(place.location.sourceRef)
      : undefined;
    return {
      ...attributes,
      id: item.id,
      recordId: item.recordId || item.id,
      scope: 'china',
      regionIds: item.regionIds,
      categoryId: item.categoryIds[0],
      name: item.name,
      aliases: item.aliases || [],
      subitems,
      coordinates,
      source,
      description: item.details?.description || attributes.description || '',
      ...(place
        ? {
            coordinateMethod: attributes.coordinateMethod || place.location.method,
            coordinateStatus: attributes.coordinateStatus || place.location.method,
            coordinateSourceUrl: attributes.coordinateSourceUrl || coordinateSource?.url,
            coordinateLicense: attributes.coordinateLicense || coordinateSource?.license,
            coordinateLicenseUrl: attributes.coordinateLicenseUrl || coordinateSource?.licenseUrl,
            coordinateAttribution: attributes.coordinateAttribution || coordinateSource?.attribution,
            coordinatePrecisionNote: attributes.coordinatePrecisionNote || place.location.note,
            visitorEntranceVerified:
              attributes.visitorEntranceVerified ?? place.location.visitorEntranceVerified,
          }
        : {}),
    };
  });

  const manualAchievements = await json(path.join(manual, 'achievements/definitions.json'));
  const sourceById = (id) => {
    const source = manualSources.get(id);
    return source?.url ? { title: source.name, url: source.url } : source?.name || id;
  };
  const condition = (value) => ({
    mode: value.mode,
    regionIds: value.regionIds || [],
    entryIds: value.itemIds || [],
    conditions: (value.conditions || []).map(condition),
    minimum: value.minimum ?? undefined,
    inferAncestors: value.inferAncestors ?? undefined,
    fullMark: value.fullMark ?? undefined,
  });
  const definitions = manualAchievements.items.map((definition) => ({
    id: definition.id,
    title: definition.title,
    section: definition.section,
    note: definition.note,
    pending: definition.pending || [],
    sources: (definition.sourceRefs || []).map(sourceById),
    steps: definition.steps || undefined,
    need: definition.need ?? undefined,
    catalogComplete: definition.catalogComplete,
    targets: definition.targets.map((target) => ({
      label: target.label,
      regionIds: target.regionIds,
      condition: condition(target.condition),
    })),
  }));
  const worldDefinitions = base.achievements.definitions.filter((definition) => definition.section.startsWith('world-'));
  const quantity = await json(path.join(manual, 'achievements/quantity-region-ids.json'));
  const allSources = [...base.sources];
  const knownUrls = new Set(allSources.map((source) => typeof source === 'string' ? source : source?.url).filter(Boolean));
  for (const source of manualSources.values()) {
    if (source.url && knownUrls.has(source.url)) continue;
    allSources.push(source.url ? { name: source.name, url: source.url } : source.name);
    if (source.url) knownUrls.add(source.url);
  }

  return {
    ...base,
    version: `${base.version}+manual-china`,
    regions: [...base.regions.filter((region) => !regionIds.has(region.id) && region.scope !== 'china'), ...regions],
    entries: [...baseEntries, ...entries],
    categories: [...new Map([
      ...base.categories.filter((category) => usedBaseCategories.has(category.id)),
      ...categoryData.items.map(({ id, name }) => ({ id, name })),
    ].map((category) => [category.id, category])).values()],
    sources: allSources,
    achievements: {
      ...base.achievements,
      definitions: [...definitions, ...worldDefinitions],
      quantityRegionIds: quantity.items,
    },
  };
}

