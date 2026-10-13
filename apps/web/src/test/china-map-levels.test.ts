import { describe, expect, it } from 'vitest';
import type { Region } from '@fangyu/contracts';
import {
  chinaRegionSourceLevels,
  isChinaCountyMapRegion,
} from '../features/maps/china-map-levels.js';

function region(id: string, level: number, code: string, parentId: string | null): Region {
  return {
    id,
    parentId,
    scope: 'china',
    level,
    name: id,
    code,
    historical: false,
    aliases: [],
  };
}

describe('China map display levels', () => {
  it('keeps a municipality in both province and city sources', () => {
    const beijing = region('beijing', 0, '110000', null);
    const districts = new Map<string, Region>([[beijing.id, beijing]]);
    expect(chinaRegionSourceLevels(beijing, districts)).toEqual(['province', 'city']);
  });

  it('treats a childless city as a county-map region', () => {
    const dongguan = region('dongguan', 1, '441900', 'guangdong');
    const regions = new Map([[dongguan.id, dongguan]]);
    expect(isChinaCountyMapRegion(dongguan, regions)).toBe(true);
    expect(chinaRegionSourceLevels(dongguan, regions)).toEqual(['city', 'county']);
  });

  it('projects a provincial direct county unit into the city source', () => {
    const hubei = region('hubei', 0, '420000', null);
    const xiantao = region('xiantao', 2, '429004', hubei.id);
    const regions = new Map([
      [hubei.id, hubei],
      [xiantao.id, xiantao],
    ]);
    expect(chinaRegionSourceLevels(xiantao, regions)).toEqual(['county', 'city']);
  });

  it('does not promote an ordinary county into the city source', () => {
    const guangdong = region('guangdong', 0, '440000', null);
    const shenzhen = region('shenzhen', 1, '440300', guangdong.id);
    const nanshan = region('nanshan', 2, '440305', shenzhen.id);
    const regions = new Map([
      [guangdong.id, guangdong],
      [shenzhen.id, shenzhen],
      [nanshan.id, nanshan],
    ]);
    expect(chinaRegionSourceLevels(nanshan, regions)).toEqual(['county']);
  });
});
