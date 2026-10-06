import { Map as LibreMap, setWorkerUrl, addProtocol } from 'maplibre-gl';
import { PMTiles, Protocol } from 'pmtiles';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { mapAssetUrl } from './types.js';

setWorkerUrl(workerUrl);
const pmtiles = new Protocol();
addProtocol('pmtiles', pmtiles.tile);
export { LibreMap };

// Failed PMTiles header/directory promises are cached; a retry needs a fresh reader.
export function renewArchive(base: string, url: string, pageUrl: string) {
  pmtiles.add(new PMTiles(mapAssetUrl(base, url, pageUrl)));
}
