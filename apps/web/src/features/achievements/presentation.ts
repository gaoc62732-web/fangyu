import manual from '../../../../../data/manual/china/achievements/presentation.json';
type AchievementSeries = readonly [string, string, string];
export const QUANTITY_NAMES: string[] = manual.quantityNames;
export const QUANTITY_STEPS: number[] = manual.quantitySteps;
export const SERIES = manual.series as unknown as readonly AchievementSeries[];
export const WORLD_SERIES = manual.worldSeries as unknown as readonly AchievementSeries[];
export const REGION_COLORS: Record<string, string> = manual.regionColors;
export const REGION_STYLES: Record<
  string,
  { name: string; edge: string; ink: string; outline: string }
> = manual.regionStyles;
export const REGION_SHORT: Record<string, string> = Object.fromEntries(
  manual.provinceShortNames.map(({ provinceId, name }) => [provinceId.slice(2, 4), name]),
);
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
