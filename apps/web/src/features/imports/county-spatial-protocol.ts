import type { ChinaBoundarySettings, GeographicFile, Region } from '@fangyu/contracts';
import type { GeographicFileMatches } from '@fangyu/import-export';

export type CountySpatialRequest =
  | {
      id: number;
      type: 'init';
      payload: {
        baseUrl: string;
        counties: Pick<Region, 'id' | 'level' | 'historical'>[];
        settings: ChinaBoundarySettings;
      };
    }
  | { id: number; type: 'geographic'; payload: GeographicFile[] }
  | { id: number; type: 'points'; payload: [number, number][] };

export type CountySpatialResponse =
  | { id: number; result: null | GeographicFileMatches[] | string[][] }
  | { id: number; error: string };
