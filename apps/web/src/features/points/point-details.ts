import type { CatalogEntry } from '@fangyu/contracts';

function hasValue(value: unknown) {
  return value !== undefined && value !== null &&
    (typeof value !== 'string' || value.trim() !== '') &&
    (!Array.isArray(value) || value.length > 0);
}

export function pointDetails<T extends CatalogEntry>(entry: T, parent?: CatalogEntry): T {
  if (!parent) return entry;
  const fields = [
    'description', 'designation', 'code', 'year', 'heritageType', 'source',
    'locationNote', 'coordinatePrecisionNote', 'coordinateSourceUrl',
    'accessibilityStatus', 'accessibilityNote', 'accessibilitySourceUrl',
  ] as const;
  const attributes = { ...parent.attributes };
  for (const [key, value] of Object.entries(entry.attributes || {}))
    if (hasValue(value) || !hasValue(attributes[key])) attributes[key] = value;
  return {
    ...entry,
    ...Object.fromEntries(fields.map((key) => [key, hasValue(entry[key]) ? entry[key] : parent[key]])),
    attributes,
  };
}
