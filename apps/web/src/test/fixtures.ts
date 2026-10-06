import { CatalogIndex } from '@fangyu/catalog';
import { HandbookSession } from '@fangyu/domain';
import type { Catalog } from '@fangyu/contracts';
export const beijing = '00000000-0000-4000-8000-000000000001';
export const city = '00000000-0000-4000-8000-000000000002';
export const dongcheng = '00000000-0000-4000-8000-000000000003';
export const airport = '00000000-0000-4000-8000-000000000004';
export const station = '00000000-0000-4000-8000-000000000005';
export const catalog: Catalog = {
  version: 'test-current',
  compatibleCatalogVersions: ['test-previous'],
  categories: [
    { id: 'airport', name: '机场' },
    { id: 'railway-station', name: '铁路车站' },
  ],
  regions: [
    {
      id: beijing,
      parentId: null,
      scope: 'china',
      level: 0,
      name: '北京市',
      code: '110000',
      historical: false,
      aliases: [],
    },
    {
      id: city,
      parentId: beijing,
      scope: 'china',
      level: 1,
      name: '北京市辖区',
      code: '110100',
      historical: false,
      aliases: [],
    },
    {
      id: dongcheng,
      parentId: city,
      scope: 'china',
      level: 2,
      name: '东城区',
      code: '110101',
      historical: false,
      aliases: [],
    },
  ],
  entries: [
    {
      id: airport,
      recordId: airport,
      scope: 'china',
      regionIds: [dongcheng],
      categoryId: 'airport',
      name: '测试机场',
      aliases: ['Test Airport'],
      subitems: [],
      coordinates: [116.4, 39.9],
    },
    {
      id: station,
      recordId: station,
      scope: 'china',
      regionIds: [dongcheng],
      categoryId: 'railway-station',
      name: '测试车站',
      aliases: [],
      subitems: [],
      coordinates: [116.5, 39.9],
    },
  ],
  achievements: { definitions: [], quantityRegionIds: [dongcheng] },
  sources: [],
};
export const index = new CatalogIndex(catalog);
export const createSession = () => new HandbookSession(index);
