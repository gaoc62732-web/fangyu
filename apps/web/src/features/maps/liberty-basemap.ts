import type { StyleSpecification } from 'maplibre-gl';
import type { BasemapProvider } from './types.js';
import liberty from './styles/osm-liberty.json';

// Keep the user's Maputnik file editable; composition/prefixes belong in style.ts.
export function libertyBasemap(): BasemapProvider {
  return {
    id: 'openfreemap',
    kind: 'vector',
    name: '方舆简洁底图',
    attribution:
      '<a href="https://openfreemap.org/">OpenFreeMap</a> · <a href="https://openmaptiles.org/">OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
    tiles: [],
    labels: [],
    style: liberty as unknown as StyleSpecification,
  };
}
