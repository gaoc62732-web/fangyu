import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { RecordsModule } from './modules/records/records.module.js';
import { ArchivesModule } from './modules/archives/archives.module.js';
import { AuthModule } from './modules/auth/auth.module.js';

@Module({
  imports: [DatabaseModule, HealthModule, AuthModule, CatalogModule, RecordsModule, ArchivesModule],
})
export class AppModule {}
