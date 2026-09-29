import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Module,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { archiveSchema, type ArchiveDocument } from '@fangyu/contracts';
import { HandbookSession } from '@fangyu/domain';
import { DatabaseService } from '../../database/database.module.js';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { AuthModule } from '../auth/auth.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { CatalogService } from '../catalog/catalog.service.js';

@Controller('me/archives')
@UseGuards(AuthGuard)
class ArchivesController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  @Get()
  async list(@Req() request: AuthenticatedRequest): Promise<ArchiveDocument[]> {
    const result = await this.database.pool.query<{ payload: ArchiveDocument }>(
      'SELECT payload FROM archives WHERE user_id = $1 ORDER BY created_at DESC',
      [request.user.id],
    );
    return result.rows.map((row) => row.payload);
  }

  @Put(':id')
  @HttpCode(204)
  async save(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() input: unknown,
  ) {
    const parsed = archiveSchema.safeParse(input);
    if (!parsed.success || parsed.data.id !== id)
      throw new BadRequestException('存档格式或 ID 无效');
    const archive = parsed.data;
    try {
      new HandbookSession(await this.catalog.index()).validate(archive.snapshot);
    } catch (error) {
      throw new BadRequestException(String(error));
    }
    await this.database.pool.query(
      'INSERT INTO archives (user_id, id, name, created_at, payload) VALUES ($1, $2, $3, $4, $5) ' +
        'ON CONFLICT (user_id, id) DO UPDATE SET name = EXCLUDED.name, payload = EXCLUDED.payload',
      [request.user.id, archive.id, archive.name, archive.createdAt, JSON.stringify(archive)],
    );
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new BadRequestException('无效存档 ID');
    await this.database.pool.query('DELETE FROM archives WHERE user_id = $1 AND id = $2', [
      request.user.id,
      id,
    ]);
  }
}

@Module({ imports: [AuthModule, CatalogModule], controllers: [ArchivesController] })
export class ArchivesModule {}
