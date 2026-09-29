import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { saveRecordsSchema, type RecordSnapshot } from '@fangyu/contracts';
import { HandbookSession } from '@fangyu/domain';
import { DatabaseService } from '../../database/database.module.js';
import { CatalogService } from '../catalog/catalog.service.js';

@Injectable()
export class RecordsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  async read(userId: string): Promise<RecordSnapshot | null> {
    const result = await this.database.pool.query<{ payload: RecordSnapshot }>(
      'SELECT payload FROM record_snapshots WHERE user_id = $1',
      [userId],
    );
    return result.rows[0]?.payload || null;
  }

  async save(userId: string, input: unknown): Promise<void> {
    const parsed = saveRecordsSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const { expectedRevision, snapshot } = parsed.data;
    try {
      new HandbookSession(await this.catalog.index()).validate(snapshot);
    } catch (error) {
      throw new BadRequestException(String(error));
    }
    if (snapshot.revision <= expectedRevision)
      throw new BadRequestException('新记录修订号必须增加');

    const connection = await this.database.pool.connect();
    try {
      await connection.query('BEGIN');
      // The user-row lock serializes the first write before a snapshot exists.
      await connection.query('SELECT id FROM "user" WHERE id = $1 FOR UPDATE', [userId]);
      const current = await connection.query<{ revision: string }>(
        'SELECT revision FROM record_snapshots WHERE user_id = $1',
        [userId],
      );
      if (Number(current.rows[0]?.revision || 0) !== expectedRevision)
        throw new ConflictException('记录已被其他窗口修改');
      await connection.query(
        'INSERT INTO record_snapshots (user_id, revision, catalog_version, payload) VALUES ($1, $2, $3, $4) ' +
          'ON CONFLICT (user_id) DO UPDATE SET revision = EXCLUDED.revision, catalog_version = EXCLUDED.catalog_version, payload = EXCLUDED.payload, updated_at = now()',
        [userId, snapshot.revision, snapshot.catalogVersion, JSON.stringify(snapshot)],
      );
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
  }
}
