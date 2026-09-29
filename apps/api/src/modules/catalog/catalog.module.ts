import { BadRequestException, Controller, Get, Inject, Module, Param } from '@nestjs/common';
import type { Scope } from '@fangyu/contracts';
import { CatalogService } from './catalog.service.js';

@Controller('catalog')
class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @Get()
  async current() {
    return (await this.catalog.index()).catalog;
  }

  @Get('geometry/:scope')
  async geometry(@Param('scope') scope: string) {
    if (!['china', 'world', 'japan', 'korea'].includes(scope))
      throw new BadRequestException('未知地图范围');
    return this.catalog.geometry(scope as Scope);
  }
}

@Module({
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
