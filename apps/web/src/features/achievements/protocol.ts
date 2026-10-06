import type { Catalog, RecordSnapshot } from '@fangyu/contracts';
import type { AchievementProgress, maofenProgress, quantityProgress } from '@fangyu/domain';

export type AchievementBadgeSummary = Omit<AchievementProgress, 'targets'> & {
  regionIds: string[];
};
export interface AchievementSummary {
  badges: AchievementBadgeSummary[];
  quantity: ReturnType<typeof quantityProgress>;
  score: ReturnType<typeof maofenProgress>;
}
export interface AchievementPayloads {
  init: { catalog: Catalog; snapshot: RecordSnapshot };
  sync: RecordSnapshot;
  achievements: undefined;
  achievement: string;
}
export interface AchievementResults {
  init: null;
  sync: null;
  achievements: AchievementSummary;
  achievement: AchievementProgress | undefined;
}
export type AchievementRequest = {
  [K in keyof AchievementPayloads]: { id: number; type: K; payload: AchievementPayloads[K] };
}[keyof AchievementPayloads];
export type AchievementResponse =
  | { id: number; result: AchievementResults[keyof AchievementResults] }
  | { id: number; error: string };
