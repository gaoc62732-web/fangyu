import type { RecordSnapshot, VisitState } from './records.js';

export interface ImportCandidate {
  id: string;
  name: string;
  path: string;
  entryIds?: string[];
}
export interface ImportRow {
  id: string;
  source: string;
  input: string;
  kind: 'region' | 'entry';
  candidates: ImportCandidate[];
  choice: number;
  include: boolean;
  state: VisitState;
  result: string;
  entryUpdate?: { visited: boolean; subitemIds: string[]; name: string; note: string };
}
export interface ImportPlan {
  title: string;
  baseRevision: number;
  rows: ImportRow[];
  notes: string[];
  applied: boolean;
  snapshot?: RecordSnapshot;
}
export interface GeographicItem {
  id?: string;
  name: string;
  points: [number, number][];
  lines: [number, number][][];
  kind?: string;
  tagSummary?: string;
  vertices?: number;
}
export interface GeographicFile {
  fileName: string;
  items: GeographicItem[];
  unsupported: number;
  vertices: number;
}
