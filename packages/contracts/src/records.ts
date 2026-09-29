import { z } from 'zod';

export const VISIT_STATES = [
  'unvisited',
  'flyover',
  'transit',
  'arrived',
  'shortstay',
  'resident',
] as const;
export const visitStateSchema = z.enum(VISIT_STATES);
export type VisitState = z.infer<typeof visitStateSchema>;

export const VISIT_RANK: Record<VisitState, number> = {
  unvisited: 0,
  flyover: 1,
  transit: 2,
  arrived: 3,
  shortstay: 4,
  resident: 5,
};
export const VISIT_LABELS: Record<VisitState, string> = {
  unvisited: '未到达',
  flyover: '飞跃',
  transit: '途经',
  arrived: '到达',
  shortstay: '短居',
  resident: '居住',
};

const id = z.string().uuid();
const text = z.string().max(20000);
const entryRecordSchema = z
  .object({
    visited: z.boolean(),
    subitemIds: z.array(id).max(1000),
    name: text.optional(),
    note: text.optional(),
  })
  .strict();
export type EntryRecord = z.infer<typeof entryRecordSchema>;

export const customEntrySchema = z
  .object({
    id,
    recordId: id,
    scope: z.enum(['china', 'world', 'japan', 'korea']),
    regionIds: z.array(id).min(1).max(100),
    categoryId: z.string().max(100),
    name: z.string().trim().min(1).max(1000),
    aliases: z.array(text).max(100),
    subitems: z.array(z.object({ id, name: text }).strict()).max(1000),
  })
  .strict();

export const preferencesSchema = z
  .object({
    palette: z.enum(['jade', 'ink', 'autumn', 'ocean', 'contrast', 'custom']).default('jade'),
    customColors: z
      .record(z.enum([...VISIT_STATES, 'unmapped']), z.string().regex(/^#[a-f0-9]{6}$/i))
      .optional(),
    mapLevel: z.enum(['province', 'city', 'county']).default('county'),
  })
  .strict();

export const snapshotSchema = z
  .object({
    format: z.literal('fangyu-records'),
    version: z.literal(1),
    catalogVersion: z.string().max(100),
    revision: z.number().int().nonnegative(),
    updatedAt: z.string().datetime(),
    regions: z.record(id, visitStateSchema),
    entries: z.record(id, entryRecordSchema),
    customEntries: z.array(customEntrySchema).max(10000),
    preferences: preferencesSchema,
  })
  .strict();

export type RecordSnapshot = z.infer<typeof snapshotSchema>;
export type RecordPreferences = RecordSnapshot['preferences'];
export const archiveSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(200),
    createdAt: z.string().datetime(),
    snapshot: snapshotSchema,
  })
  .strict();
export type ArchiveDocument = z.infer<typeof archiveSchema>;
export const saveRecordsSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    snapshot: snapshotSchema,
  })
  .strict();

export function emptySnapshot(catalogVersion: string): RecordSnapshot {
  return {
    format: 'fangyu-records',
    version: 1,
    catalogVersion,
    revision: 0,
    updatedAt: new Date().toISOString(),
    regions: {},
    entries: {},
    customEntries: [],
    preferences: { palette: 'jade', mapLevel: 'county' },
  };
}
