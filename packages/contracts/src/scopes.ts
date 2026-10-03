/** Topic registration is independent of data availability; a topic may have no boundary assets yet. */
export const SCOPE_CONFIGS = [
  {
    id: 'china',
    name: '中国',
    title: '中国旅行地图',
    countryCode: 'CHN',
    defaultLevel: 'county',
    boundaryLabel: '行政区',
    note: '沿用现有行政区与历史区划口径；历史区划单独标记。',
  },
  {
    id: 'world',
    name: '世界',
    title: '世界旅行地图',
    countryCode: null,
    defaultLevel: 'country',
    boundaryLabel: '国家与地区',
    note: '世界目录与国家专题共享地点记录，国家专题的完整程度以实际来源为准。',
  },
  {
    id: 'japan',
    name: '日本',
    title: '日本专题 · Japan',
    countryCode: 'JPN',
    defaultLevel: 'province',
    boundaryLabel: '都道府县',
    note: '世界遗产项目与组成点分别记录；既有项目打卡不推断组成点全部完成。',
  },
  {
    id: 'korea',
    name: '韩国',
    title: '韩国专题 · South Korea',
    countryCode: 'KOR',
    defaultLevel: 'province',
    boundaryLabel: '一级区划',
    note: '沿用现有区划数据，来源年份与覆盖范围待核验；世界遗产组成点独立记录。',
  },
  {
    id: 'uzbekistan',
    name: '乌兹别克斯坦',
    title: '乌兹别克斯坦专题 · Uzbekistan',
    countryCode: 'UZB',
    defaultLevel: 'province',
    boundaryLabel: '一级区划',
    note: '文保层仅收全国重要性遗产；不以全部国家名录替代该等级。区划与点位按已核验数据发布。',
  },
  {
    id: 'vietnam',
    name: '越南',
    title: '越南专题 · Vietnam',
    countryCode: 'VNM',
    defaultLevel: 'province',
    boundaryLabel: '省与直辖市 · Provinces and cities',
    note: '仅收国家特别遗迹；行政区采用2025年调整后的34省市。 / Special national relics; 34 provinces and cities after the 2025 reform.',
  },
  {
    id: 'germany',
    name: '德国',
    title: '德国专题 · Germany',
    countryCode: 'DEU',
    defaultLevel: 'province',
    boundaryLabel: '联邦州',
    note: '以一级区划为主；足球层按已核验赛季德甲完整名单与实际主场发布。其他文保等级尚未指定。',
  },
  {
    id: 'france',
    name: '法国',
    title: '法国专题 · France',
    countryCode: 'FRA',
    defaultLevel: 'province',
    boundaryLabel: '一级区划（本土／海外分列）',
    note: '法国本土与海外分列，注明海外地区地位与覆盖范围；不将不同地位地区合称同一级行政区。',
  },
  {
    id: 'italy',
    name: '意大利',
    title: '意大利专题 · Italy',
    countryCode: 'ITA',
    defaultLevel: 'province',
    boundaryLabel: '大区',
    note: '以一级区划为主；足球层按已核验赛季意甲完整名单与实际主场发布。其他文保等级尚未指定。',
  },
  {
    id: 'uk',
    name: '英国',
    title: '英国专题 · United Kingdom',
    countryCode: 'GBR',
    defaultLevel: 'county',
    boundaryLabel: '历史郡（文化地图）',
    note: '历史郡文化地图，年代与口径待核验，不代表现行行政区。足球仅英格兰、苏格兰顶级联赛；威尔士单列加迪夫千年球场，不收北爱足球。',
  },
  {
    id: 'usa',
    name: '美国',
    title: '美国专题 · United States',
    countryCode: 'USA',
    defaultLevel: 'province',
    boundaryLabel: '州／哥伦比亚特区',
    note: '50州与哥伦比亚特区分列；特区不计为州，其他属地不自动并入州层。',
  },
  {
    id: 'spain',
    name: '西班牙',
    title: '西班牙专题 · Spain',
    countryCode: 'ESP',
    defaultLevel: 'province',
    boundaryLabel: '自治社区／自治市',
    note: '自治社区与自治市分列，具体区划及版本以已核验来源为准；足球层按已核验赛季西甲完整名单与实际主场发布。',
  },
  {
    id: 'indonesia',
    name: '印度尼西亚',
    title: '印度尼西亚专题 · Indonesia',
    countryCode: 'IDN',
    defaultLevel: 'province',
    boundaryLabel: '省级区划 · Provinces',
    note: '行政区划按已核实的数据快照展示；数据日期与覆盖范围见来源说明。 / Boundaries follow the verified source snapshot; see its date and coverage.',
  },
  {
    id: 'thailand',
    name: '泰国',
    title: '泰国专题 · Thailand',
    countryCode: 'THA',
    defaultLevel: 'province',
    boundaryLabel: '府级区划 · Provincial divisions',
    note: '府级区划与特殊行政区的类别以已核实来源为准，不将特殊行政区统称为府。 / Provincial and special administrative units retain their source classifications.',
  },
  {
    id: 'malaysia',
    name: '马来西亚',
    title: '马来西亚专题 · Malaysia',
    countryCode: 'MYS',
    defaultLevel: 'province',
    boundaryLabel: '州与联邦直辖区 · States and federal territories',
    note: '州与联邦直辖区分别标注，区划版本与地点覆盖以已核实来源为准。 / States and federal territories are distinguished; coverage follows verified sources.',
  },
  {
    id: 'singapore',
    name: '新加坡',
    title: '新加坡专题 · Singapore',
    countryCode: 'SGP',
    defaultLevel: 'province',
    boundaryLabel: '规划区域（URA 2025） · Planning regions',
    note: '采用URA总体规划2025的5个规划区域，不是55个规划分区或省级政府。 / Five URA Master Plan 2025 planning regions; not the 55 planning areas or provincial governments.',
  },
  {
    id: 'brunei',
    name: '文莱',
    title: '文莱专题 · Brunei',
    countryCode: 'BRN',
    defaultLevel: 'province',
    boundaryLabel: '县级区划 · Districts',
    note: '县级区划按已核实来源快照展示，名称、数据日期和覆盖范围见来源说明。 / Districts follow the verified source snapshot; see its names, date and coverage.',
  },
] as const;

export type Scope = (typeof SCOPE_CONFIGS)[number]['id'];
export type ScopeConfig = (typeof SCOPE_CONFIGS)[number];
// The literal registry is non-empty, so this tuple is safe for z.enum and preserves the Scope union.
export const SCOPE_IDS = SCOPE_CONFIGS.map((config) => config.id) as [Scope, ...Scope[]];

export function isScope(value: string): value is Scope {
  return SCOPE_IDS.some((id) => id === value);
}

export function getScopeConfig(scope: Scope): ScopeConfig {
  return SCOPE_CONFIGS.find((config) => config.id === scope)!;
}

/** A collection route is not a country scope: each member keeps its own records and map. */
export const MALAY_REGION_TOPIC = {
  id: 'malay-region',
  name: '马新文',
  title: '马新文 · Malaysia, Singapore & Brunei',
  scopeIds: ['malaysia', 'singapore', 'brunei'] as const satisfies readonly Scope[],
} as const;

/** Navigation groups are product groupings, not administrative or statistical regions. */
export const SCOPE_NAV_GROUPS = [
  { id: 'east-asia', name: '东亚', topicIds: ['china', 'japan', 'korea'] },
  {
    id: 'southeast-asia',
    name: '东南亚',
    topicIds: ['vietnam', 'indonesia', 'thailand', MALAY_REGION_TOPIC.id],
  },
  { id: 'western-europe', name: '西欧', topicIds: ['germany', 'france', 'uk', 'italy', 'spain'] },
  { id: 'other', name: '其他', topicIds: ['uzbekistan', 'usa'] },
] as const satisfies readonly {
  id: string;
  name: string;
  topicIds: readonly (Scope | typeof MALAY_REGION_TOPIC.id)[];
}[];
