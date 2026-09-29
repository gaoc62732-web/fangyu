import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Module,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { RecordsService } from './records.service.js';

@Controller('me/records')
@UseGuards(AuthGuard)
class RecordsController {
  constructor(@Inject(RecordsService) private readonly records: RecordsService) {}

  @Get()
  read(@Req() request: AuthenticatedRequest) {
    return this.records.read(request.user.id);
  }

  @Put()
  @HttpCode(204)
  async save(@Req() request: AuthenticatedRequest, @Body() input: unknown) {
    await this.records.save(request.user.id, input);
  }
}

@Module({
  imports: [AuthModule, CatalogModule],
  controllers: [RecordsController],
  providers: [RecordsService],
})
export class RecordsModule {}
