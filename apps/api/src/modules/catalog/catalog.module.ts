import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Module,
  NotFoundException,
  Param,
} from '@nestjs/common';
import { isScope } from '@fangyu/contracts';
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
    if (!isScope(scope)) throw new BadRequestException('未知地图范围');
    try {
      return await this.catalog.geometry(scope);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        throw new NotFoundException('该专题暂无已发布的边界数据');
      }
      throw error;
    }
  }
}

@Module({
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
