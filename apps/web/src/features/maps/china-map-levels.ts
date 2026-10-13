import type { Region } from '@fangyu/contracts';

/** Provinces whose county map is made up of their districts, not a terminal city face. */
export const CHINA_MUNICIPAL_CODES = new Set(['110000', '120000', '310000', '500000']);

function activeChildren(region: Region, regions: ReadonlyMap<string, Region>): Region[] {
  return [...regions.values()].filter(
    (candidate) => candidate.parentId === region.id && !candidate.historical,
  );
}

/**
 * A county map needs a face for every terminal administrative unit. Directly
 * administered cities (and Taiwan's city-level units) have no county child,
 * so their city face is displayed in the county source as well.
 */
export function isChinaCountyMapRegion(
  region: Region,
  regions: ReadonlyMap<string, Region>,
): boolean {
  if (region.scope !== 'china' || region.historical) return false;
  if (region.level === 2 || ['810000', '820000'].includes(region.code)) return true;
  return region.level === 1 && activeChildren(region, regions).length === 0;
}

/** A provincial direct county unit must also be visible in the city source. */
function isChinaDirectProvinceCounty(
  region: Region,
  regions: ReadonlyMap<string, Region>,
): boolean {
  if (region.scope !== 'china' || region.historical || region.level !== 2) return false;
  const parent = region.parentId ? regions.get(region.parentId) : undefined;
  return Boolean(
    parent &&
    parent.level === 0 &&
    !CHINA_MUNICIPAL_CODES.has(parent.code) &&
    !['810000', '820000'].includes(parent.code),
  );
}

/**
 * Return every map source in which a catalogue region can have a rendered
 * face. A region may intentionally occur in more than one source: for example
 * a municipality occurs in both the province and city sources.
 */
export function chinaRegionSourceLevels(
  region: Region,
  regions: ReadonlyMap<string, Region>,
): ('province' | 'city' | 'county')[] {
  if (region.scope !== 'china' || region.historical) return [];
  if (region.level === 0)
    return [
      'province',
      ...(CHINA_MUNICIPAL_CODES.has(region.code) || ['810000', '820000'].includes(region.code)
        ? ['city' as const]
        : []),
      ...(['810000', '820000'].includes(region.code) ? (['county'] as const) : []),
    ];
  if (region.level === 1)
    return ['city', ...(isChinaCountyMapRegion(region, regions) ? (['county'] as const) : [])];
  if (region.level === 2)
    return ['county', ...(isChinaDirectProvinceCounty(region, regions) ? (['city'] as const) : [])];
  return [];
}
