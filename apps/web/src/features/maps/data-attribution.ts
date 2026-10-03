import type { Scope } from '@fangyu/contracts';

export interface MapAttribution {
  label: string;
  url: string;
}
const osm: MapAttribution = {
  label: '部分边界／点位 © OpenStreetMap contributors · ODbL 1.0',
  url: 'https://www.openstreetmap.org/copyright',
};
const boundaries: Partial<Record<Scope, MapAttribution>> = {
  indonesia: {
    label: '印尼陆地裁剪：Natural Earth 1:10m · Public Domain（小岛可能省略）',
    url: 'https://www.naturalearthdata.com/about/terms-of-use/',
  },
  france: {
    label: '法国边界：Contours administratifs / Ville de Paris · ODbL 1.0',
    url: 'https://opendatacommons.org/licenses/odbl/1-0/',
  },
  vietnam: {
    label: '越南边界：OCHA / HDX COD-AB · CC BY 3.0 IGO（显示裁剪）',
    url: 'https://data.humdata.org/dataset/cod-ab-vnm',
  },
  germany: {
    label: '德国边界：© GeoBasis-DE / BKG 2021 · dl-de/by-2-0',
    url: 'https://www.govdata.de/dl-de/by-2-0',
  },
  italy: {
    label: '意大利边界：ISTAT 2023 / geoBoundaries · CC BY 3.0',
    url: 'https://creativecommons.org/licenses/by/3.0/',
  },
  spain: {
    label: '西班牙边界：IGN 2017 / geoBoundaries · CC BY 4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/',
  },
  singapore: {
    label: '新加坡边界：URA / data.gov.sg · Singapore Open Data Licence 1.0',
    url: 'https://data.gov.sg/open-data-licence',
  },
  uk: {
    label: '英国历史郡：Historic Counties Trust · Definition A',
    url: 'https://county-borders.co.uk/',
  },
  usa: {
    label: '美国边界：U.S. Census Bureau 2018 · Public Domain',
    url: 'https://www.census.gov/geographies/mapping-files/time-series/geo/carto-boundary-file.html',
  },
  brunei: {
    label: '文莱边界：geoBoundaries / Tachymètre 2011 · Public Domain',
    url: 'https://www.geoboundaries.org/api/current/gbOpen/BRN/ADM1/',
  },
};

// Keep source attribution in the visible interface and exported image, including Canvas fallback.
export function mapAttributions(scope: Scope, includeHeritage = false): MapAttribution[] {
  const specific = boundaries[scope];
  const credits = specific ? [osm, specific] : [osm];
  if (includeHeritage)
    credits.push({
      label: '项目元数据：UNESCO DataHub · CC BY-SA 4.0（含中文整理与地区关联）',
      url: 'https://data.unesco.org/explore/dataset/whc001/',
    });
  return credits;
}
