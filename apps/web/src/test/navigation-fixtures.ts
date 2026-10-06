import type { Catalog, Region } from '@fangyu/contracts';
import { catalog } from './fixtures.js';

export const franceCountry = '00000000-0000-4000-8000-000000000101';
export const ileDeFrance = '00000000-0000-4000-8000-000000000102';
export const paris = '00000000-0000-4000-8000-000000000103';
export const arrondissement = '00000000-0000-4000-8000-000000000104';
export const reunion = '00000000-0000-4000-8000-000000000105';
export const franceEntry = '00000000-0000-4000-8000-000000000106';

const regions: Region[] = [
  {
    id: franceCountry,
    parentId: null,
    scope: 'world',
    level: 0,
    code: 'FRA',
    name: '法国',
    aliases: [],
    historical: false,
  },
  {
    id: ileDeFrance,
    parentId: franceCountry,
    scope: 'france',
    level: 1,
    code: 'FR-IDF',
    kind: 'metropolitan-region',
    name: '法兰西岛',
    aliases: [],
    historical: false,
  },
  {
    id: paris,
    parentId: ileDeFrance,
    scope: 'france',
    level: 2,
    code: 'FR-75',
    sourceCode: '75',
    name: '巴黎',
    aliases: [],
    historical: false,
  },
  {
    id: arrondissement,
    parentId: paris,
    scope: 'france',
    level: 3,
    code: 'FR-75101',
    name: '巴黎一区',
    aliases: [],
    historical: false,
  },
  {
    id: reunion,
    parentId: franceCountry,
    scope: 'france',
    level: 1,
    code: 'FR-RE',
    kind: 'overseas-region',
    name: '留尼汪',
    aliases: [],
    historical: false,
  },
];
export const navigationCatalog: Catalog = {
  ...catalog,
  regions: [...catalog.regions, ...regions],
  entries: [
    ...catalog.entries,
    {
      id: franceEntry,
      recordId: franceEntry,
      scope: 'france',
      regionIds: [arrondissement],
      categoryId: 'airport',
      name: '法国测试地点',
      aliases: [],
      subitems: [],
      coordinates: [2.34, 48.86],
    },
  ],
};
