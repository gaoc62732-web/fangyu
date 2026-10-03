import {
  ACHIEVEMENT_CHRONOLOGY,
  type AchievementChronology,
} from './achievement-chronology-data.js';
export {
  ACHIEVEMENT_CHRONOLOGY,
  type AchievementChronology,
} from './achievement-chronology-data.js';
const unknown: AchievementChronology = {
  kind: 'undated',
  label: '年代待核',
  basis: '尚无核实的主题年代；保留目录顺序并置于已定年主题之后。',
  sources: [],
};
export function achievementChronology(item: {
  id: string;
  section: string;
}): AchievementChronology | undefined {
  return item.section === 'history' ? ACHIEVEMENT_CHRONOLOGY[item.id] || unknown : undefined;
}
export function compareAchievementChronology(
  a: AchievementChronology,
  b: AchievementChronology,
): number {
  const rank = { legendary: 0, dated: 1, undated: 2 };
  const order = rank[a.kind] - rank[b.kind];
  if (order || a.kind !== 'dated' || b.kind !== 'dated') return order;
  return a.startYear! - b.startYear! || (a.endYear ?? a.startYear!) - (b.endYear ?? b.startYear!);
}
/** Sort history slots only. Equal dates/unknowns preserve input catalog order.
 * Object identity, targets, progress and non-history positions stay intact. */
export function sortHistoricalAchievements<T extends { id: string; section: string }>(
  items: readonly T[],
): T[] {
  const history = items
    .filter((item) => item.section === 'history')
    .map((item, index) => ({ item, index }));
  history.sort(
    (a, b) =>
      compareAchievementChronology(
        achievementChronology(a.item)!,
        achievementChronology(b.item)!,
      ) || a.index - b.index,
  );
  let next = 0;
  return items.map((item) => (item.section === 'history' ? history[next++]!.item : item));
}
