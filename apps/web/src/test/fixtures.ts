import fs from 'node:fs';
import { CatalogIndex } from '@fangyu/catalog';
import { HandbookSession } from '@fangyu/domain';
import type { Catalog } from '@fangyu/contracts';
export const catalog: Catalog = JSON.parse(fs.readFileSync('data/catalog/catalog.json', 'utf8'));
export const index = new CatalogIndex(catalog);
export const createSession = () => new HandbookSession(index);
export const beijing = catalog.regions.find((r) => r.scope === 'china' && r.name === '北京市')!.id;
export const dongcheng = catalog.regions.find(
  (r) => r.scope === 'china' && r.name === '东城区',
)!.id;
