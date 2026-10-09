import { SCOPE_IDS } from '@fangyu/contracts';
import type { MapDataManifest, Bounds } from '../features/maps/types.js';
import { beijing } from './fixtures.js';

const bounds: Bounds = [110, 30, 120, 40];
const scopes = {} as MapDataManifest['scopes'];
for (const scope of SCOPE_IDS) {
  const layers = scope === 'china' ? ['province', 'city', 'county', 'border'] : ['province'];
  scopes[scope] = {
    bounds,
    regionBounds: { [beijing]: bounds },
    simplified: `maps/${scope}.json`,
    layers: layers.map((level) => ({
      level,
      maxzoom: 12,
      bounds,
      url: `maps/${scope}-${level}.pmtiles`,
      archive: true,
    })),
  };
}
export const manifest: MapDataManifest = {
  version: 'test-current',
  scopes,
};
