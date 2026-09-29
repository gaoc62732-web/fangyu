import Dexie, { type Table } from 'dexie';
import {
  archiveSchema,
  snapshotSchema,
  type ArchiveDocument,
  type RecordSnapshot,
} from '@fangyu/contracts';

export interface HandbookStorage {
  read(): Promise<RecordSnapshot | undefined>;
  write(snapshot: RecordSnapshot, expectedRevision: number): Promise<void>;
  archives(): Promise<ArchiveDocument[]>;
  saveArchive(archive: ArchiveDocument): Promise<void>;
  deleteArchive(id: string): Promise<void>;
}

export class StorageConflict extends Error {
  constructor() {
    super('记录已被另一个窗口修改。请先导出当前记录，再重新载入。');
  }
}

class HandbookDatabase extends Dexie {
  records!: Table<{ id: string; snapshot: RecordSnapshot }, string>;
  archiveRecords!: Table<ArchiveDocument, string>;

  constructor() {
    super('fangyu-structured-records');
    this.version(1).stores({ records: 'id', archiveRecords: 'id,createdAt' });
  }
}

export function browserStorage(): HandbookStorage {
  const database = new HandbookDatabase();
  return {
    read: async () => {
      const record = await database.records.get('current');
      return record ? snapshotSchema.parse(record.snapshot) : undefined;
    },
    write: async (snapshot, expectedRevision) => {
      await database.transaction('rw', database.records, async () => {
        const current = await database.records.get('current');
        if ((current?.snapshot.revision || 0) !== expectedRevision) throw new StorageConflict();
        await database.records.put({ id: 'current', snapshot: snapshotSchema.parse(snapshot) });
      });
    },
    archives: async () =>
      (await database.archiveRecords.orderBy('createdAt').reverse().toArray()).map((archive) =>
        archiveSchema.parse(archive),
      ),
    saveArchive: async (archive) => {
      await database.archiveRecords.put(archiveSchema.parse(archive));
    },
    deleteArchive: (id) => database.archiveRecords.delete(id),
  };
}

export function serverStorage(baseUrl: string): HandbookStorage {
  async function request<T>(path: string, method = 'GET', value?: unknown): Promise<T> {
    const response = await fetch(baseUrl + path, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });
    if (response.status === 409) throw new StorageConflict();
    if (response.status === 401) throw Error('请先登录。');
    if (!response.ok) throw Error('保存服务返回 ' + response.status);
    return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
  }
  return {
    read: async () => {
      const snapshot = await request<RecordSnapshot | null>('/me/records');
      return snapshot ? snapshotSchema.parse(snapshot) : undefined;
    },
    write: (snapshot, expectedRevision) =>
      request('/me/records', 'PUT', { snapshot, expectedRevision }),
    archives: async () =>
      (await request<ArchiveDocument[]>('/me/archives')).map((archive) =>
        archiveSchema.parse(archive),
      ),
    saveArchive: (archive) => request('/me/archives/' + archive.id, 'PUT', archive),
    deleteArchive: (id) => request('/me/archives/' + id, 'DELETE'),
  };
}
