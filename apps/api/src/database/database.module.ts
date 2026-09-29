import { Global, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { databasePool } from './connection.js';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  readonly pool = databasePool;

  async onApplicationShutdown() {
    await this.pool.end();
  }
}

@Global()
@Module({ providers: [DatabaseService], exports: [DatabaseService] })
export class DatabaseModule {}
