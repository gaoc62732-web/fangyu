/// <reference lib="webworker" />
import { CatalogIndex } from '@fangyu/catalog';
import {
  HandbookSession,
  achievementProgress,
  quantityProgress,
  maofenProgress,
} from '@fangyu/domain';
let session: HandbookSession;
let progress: ReturnType<typeof achievementProgress> | undefined;
self.onmessage = (event) => {
  const { id, type, payload } = event.data;
  try {
    if (type === 'init') {
      session = new HandbookSession(new CatalogIndex(payload.catalog), payload.snapshot);
    }
    if (type === 'sync') {
      session = new HandbookSession(session.index, payload);
      progress = undefined;
    }
    let result: unknown = null;
    if (type === 'achievements') {
      progress ||= achievementProgress(session);
      result = {
        badges: progress.map(({ targets, ...badge }) => ({
          ...badge,
          regionIds: [...new Set(targets.flatMap((t) => t.regionIds))],
        })),
        quantity: quantityProgress(session),
        score: maofenProgress(session),
      };
    }
    if (type === 'achievement') {
      progress ||= achievementProgress(session);
      result = progress.find((p) => p.id === payload);
    }
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
