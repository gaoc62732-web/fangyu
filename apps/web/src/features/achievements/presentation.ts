import legacy from './legacy.json';
export const QUANTITY_NAMES = legacy.ACH_NAMES;
export const QUANTITY_STEPS = legacy.ACH_STEPS;
export const SERIES = [
  ['quantity', '数量', '县域行者'],
  ['region', '行遍', '省域足迹'],
  ['full', '满贯', '省域满贯'],
  ['conquer', '制霸', '县域制霸'],
  ['history', '历史人文', '循迹古今'],
  ['curiosity', '政区趣味', '方舆拾趣'],
  ['routes', '山河线路', '山河行旅'],
  ['elements', '要素数量', '见闻积累'],
  ['international', '国际成就', '行向世界'],
] as const;
export const WORLD_SERIES = legacy.WORLD_SECTIONS.map(
  ([id, label, , color]) =>
    ['world-' + id, label!, legacy.WORLD_COLOR[color as keyof typeof legacy.WORLD_COLOR]] as const,
);
export const REGION_COLORS: Record<string, string> = legacy.ACH_REGION_COLORS;
export const REGION_STYLES: Record<
  string,
  { name: string; edge: string; ink: string; outline: string }
> = legacy.ACH_REGION_STYLES;
export const REGION_SHORT: Record<string, string> = legacy.ACH_SHORT;
export function seriesOf(b: { section: string; title: string }) {
  return b.section === 'administrative'
    ? b.title.startsWith('行遍')
      ? 'region'
      : b.title.startsWith('满贯')
        ? 'full'
        : 'conquer'
    : b.section.startsWith('world-')
      ? 'international'
      : b.section;
}
export function badgeStatus(b: {
  pending: string[];
  catalogComplete?: boolean;
  count: number;
  lit: boolean;
  complete: boolean;
}) {
  return b.pending.length || b.catalogComplete === false
    ? '暂缓'
    : b.complete
      ? '已完成'
      : b.lit
        ? '已点亮'
        : b.count
          ? '进行中'
          : '未开始';
}
