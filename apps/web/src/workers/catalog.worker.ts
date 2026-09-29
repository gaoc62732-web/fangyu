/// <reference lib="webworker" />
import { CatalogIndex } from '@fangyu/catalog';
import {
  HandbookSession,
  achievementProgress,
  quantityProgress,
  maofenProgress,
} from '@fangyu/domain';
import { CatalogSearch } from '../features/catalog/query.js';
let session: HandbookSession;
let search: CatalogSearch;
let progress: ReturnType<typeof achievementProgress> | undefined;
self.onmessage = (event) => {
  const { id, type, payload } = event.data;
  try {
    if (type === 'init') {
      session = new HandbookSession(new CatalogIndex(payload.catalog), payload.snapshot);
      search = new CatalogSearch(session);
    }
    if (type === 'sync') {
      session = new HandbookSession(session.index, payload);
      search = search.update(session);
      progress = undefined;
    }
    let result: unknown = null;
    if (type === 'query') result = search.query(payload);
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
