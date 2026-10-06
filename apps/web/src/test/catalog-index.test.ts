import { describe, expect, it } from 'vitest';
import { CatalogIndex } from '@fangyu/catalog';
import { catalog, beijing, city, dongcheng, createSession } from './fixtures.js';

describe('region membership', () => {
  it('matches direct and indirect ancestors including the region itself', () => {
    const index = new CatalogIndex(catalog);
    expect(index.belongsTo(dongcheng, dongcheng)).toBe(true);
    expect(index.belongsTo(dongcheng, city)).toBe(true);
    expect(index.belongsTo(dongcheng, beijing)).toBe(true);
    expect(index.belongsTo(beijing, dongcheng)).toBe(false);
    expect(index.belongsTo('missing', beijing)).toBe(false);
  });

  it('keeps historical orphan regions queryable without inventing a parent', () => {
    const orphan = { ...catalog.regions[0]!, parentId: 'unknown', historical: true };
    const index = new CatalogIndex({ ...catalog, regions: [orphan] });
    expect(index.belongsTo(orphan.id, orphan.id)).toBe(true);
    expect(index.belongsTo(orphan.id, 'unknown')).toBe(false);
    expect(index.paths.get(orphan.id)).toBe(orphan.name);
  });

  it('terminates on a cyclic hierarchy', () => {
    const regions = catalog.regions.map((region) =>
      region.id === beijing ? { ...region, parentId: dongcheng } : region,
    );
    const index = new CatalogIndex({ ...catalog, regions });
    expect(index.ancestors(dongcheng)).toHaveLength(3);
    expect(index.belongsTo(dongcheng, beijing)).toBe(true);
  });

  it('normalizes compatible snapshot versions during validation', () => {
    const session = createSession();
    const previous = { ...session.snapshot(), catalogVersion: 'test-previous' };
    expect(session.validate(previous).catalogVersion).toBe(catalog.version);
    expect(previous.catalogVersion).toBe('test-previous');
    expect(() => session.validate({ ...previous, catalogVersion: 'unsupported' })).toThrow(
      '目录版本不同',
    );
  });
});
