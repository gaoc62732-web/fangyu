import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Module,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminAuthGuard } from './admin-auth.guard.js';
import { AdminPointsService } from './admin-points.service.js';

@Controller('admin/china')
@UseGuards(AdminAuthGuard)
class AdminPointsController {
  constructor(@Inject(AdminPointsService) private readonly points: AdminPointsService) {}

  @Get('points') list(@Query() query: Record<string, string>) {
    return this.points.list(query);
  }

  @Get('points/:id') get(@Param('id') id: string) {
    return this.points.get(id);
  }

  @Post('points') create(@Body() input: Record<string, any>) {
    return this.points.create(input);
  }

  @Patch('points/:id') update(@Param('id') id: string, @Body() input: Record<string, any>) {
    return this.points.update(id, input);
  }

  @Patch('points/:id/components/:componentId') updateComponent(
    @Param('id') parentId: string,
    @Param('componentId') componentId: string,
    @Body() input: Record<string, any>,
  ) {
    return this.points.updateComponent(parentId, componentId, input);
  }

  @Post('points/:id/components') createComponent(
    @Param('id') parentId: string,
    @Body() input: Record<string, any>,
  ) {
    return this.points.createComponent(parentId, input);
  }

  @Delete('points/:id/components/:componentId') removeComponent(
    @Param('id') parentId: string,
    @Param('componentId') componentId: string,
    @Body() input: Record<string, any>,
  ) {
    return this.points.removeComponent(parentId, componentId, input);
  }

  @Patch('categories/:id/fields') updateCategoryField(
    @Param('id') id: string,
    @Body() input: Record<string, any>,
  ) {
    return this.points.updateCategoryField(id, input);
  }

  @Patch('points/:id/location') updateLocation(@Param('id') id: string, @Body() input: Record<string, any>) {
    return this.points.updateLocation(id, input);
  }

  @Delete('points/:id') remove(@Param('id') id: string, @Body() input: Record<string, any>) {
    return this.points.remove(id, input);
  }

  @Post('undo') undo() {
    return this.points.undo();
  }

  @Get('regions') regions(@Query('q') q?: string, @Query('ids') ids?: string) {
    return this.points.regions(q, ids);
  }

}

@Controller('admin/china/visitor-catalog')
@UseGuards(AdminAuthGuard)
class VisitorCatalogController {
  constructor(@Inject(AdminPointsService) private readonly points: AdminPointsService) {}

  @Get() catalog() {
    return this.points.visitorCatalog();
  }

  @Get('revision') async revision() {
    return { revision: await this.points.visitorCatalogRevision() };
  }
}

@Module({ controllers: [AdminPointsController, VisitorCatalogController], providers: [AdminAuthGuard, AdminPointsService] })
export class AdminPointsModule {}
