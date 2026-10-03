import { z } from 'zod';
import { SCOPE_IDS } from './scopes.js';

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
export const stadiumExperienceSchema = z.enum(['tour', 'match']);
export type StadiumExperience = z.infer<typeof stadiumExperienceSchema>;
const entryRecordSchema = z
  .object({
    visited: z.boolean(),
    subitemIds: z.array(id).max(1000),
    name: text.optional(),
    note: text.optional(),
    stadiumExperiences: z.array(stadiumExperienceSchema).max(2).optional(),
  })
  .strict();
export type EntryRecord = z.infer<typeof entryRecordSchema>;

export const customEntrySchema = z
  .object({
    id,
    recordId: id,
    scope: z.enum(SCOPE_IDS),
    regionIds: z.array(id).min(1).max(100),
    categoryId: z.string().max(100),
    name: z.string().trim().min(1).max(1000),
    aliases: z.array(text).max(100),
    subitems: z.array(z.object({ id, name: text }).strict()).max(1000),
  })
  .strict();

export const mapLayersSchema = z
  .object({
    visitedAirports: z.boolean().default(false),
    visitedWorldHeritage: z.boolean().default(false),
  })
  .strict();
export type MapLayers = z.infer<typeof mapLayersSchema>;

export const preferencesSchema = z
  .object({
    palette: z.enum(['jade', 'ink', 'autumn', 'ocean', 'contrast', 'custom']).default('jade'),
    customColors: z
      .record(z.enum([...VISIT_STATES, 'unmapped']), z.string().regex(/^#[a-f0-9]{6}$/i))
      .optional(),
    mapLevel: z.enum(['province', 'city', 'county']).default('county'),
    mapLayers: mapLayersSchema.optional(),
  })
  .strict();

export const snapshotSchema = z
  .object({
    format: z.literal('fangyu-records'),
    version: z.union([z.literal(1), z.literal(2)]),
    catalogVersion: z.string().max(100),
    revision: z.number().int().nonnegative(),
    updatedAt: z.string().datetime(),
    regions: z.record(id, visitStateSchema),
    entries: z.record(id, entryRecordSchema),
    customEntries: z.array(customEntrySchema).max(10000),
    preferences: preferencesSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.version === 1) {
      for (const [recordId, record] of Object.entries(snapshot.entries)) {
        if (record.stadiumExperiences !== undefined) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['entries', recordId, 'stadiumExperiences'],
            message: '球场体验记录需要存档格式版本 2。',
          });
        }
      }
    }
  });

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
