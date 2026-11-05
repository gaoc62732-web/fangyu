import { Controller, Get, Inject, Module, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseModule, DatabaseService } from '../../database/database.module.js';

@Controller('health')
class HealthController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get()
  async status(): Promise<{ status: 'ok'; service: string }> {
    try {
      await this.database.pool.query('SELECT 1');
      return { status: 'ok', service: 'fangyu-api' };
    } catch {
      throw new ServiceUnavailableException('database unavailable');
    }
  }
}

@Module({ imports: [DatabaseModule], controllers: [HealthController] })
export class HealthModule {}
