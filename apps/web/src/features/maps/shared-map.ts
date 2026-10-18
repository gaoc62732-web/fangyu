import { inject, shallowReactive, type InjectionKey, type ShallowReactive } from 'vue';
import type { EntryView } from '@fangyu/domain';
import type { MapLevel, Scope } from '@fangyu/contracts';

export interface SharedMapView {
  mode: 'regions' | 'points';
  scope: Scope;
  selected: string;
  level: MapLevel;
  category: string;
  points: EntryView[];
  focus: [number, number] | null;
  initialCamera?: { center: [number, number]; zoom: number } | undefined;
  previewRegions?: string[] | undefined;
  rightInset: string;
  onSelect: (id: string) => void;
  onPoint: (id: string) => void;
  onLevel: (level: Exclude<MapLevel, 'country'>) => void;
  onOverview: () => void;
  onCluster: (ids: string[]) => void;
};

export interface SharedMapContext {
  view: ShallowReactive<SharedMapView>;
  provided: boolean;
}

export const sharedMapKey: InjectionKey<SharedMapContext> = Symbol('shared-map');

export function useSharedMap(): SharedMapContext {
  return (
    inject(sharedMapKey) || {
      provided: false,
      view: shallowReactive({
        mode: 'regions',
        scope: 'china',
        selected: '',
        level: 'county',
        category: '',
        points: [],
        focus: null,
        rightInset: '0px',
        onSelect: () => {},
        onPoint: () => {},
        onLevel: () => {},
        onOverview: () => {},
        onCluster: () => {},
      }),
    }
  );
}
