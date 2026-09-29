import { Controller, Get, Module } from '@nestjs/common';

@Controller('health')
class HealthController {
  @Get()
  status(): { status: 'ok'; service: string } {
    return { status: 'ok', service: 'fangyu-api' };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
