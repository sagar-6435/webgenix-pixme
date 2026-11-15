import { Controller, Get, HttpCode, HttpStatus, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentStudio } from '../common/decorators/current-user.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { StudioAccessGuard } from '../common/guards/studio-access.guard';
import { StudioContext } from '../common/types/auth.types';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, StudioAccessGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async list(
    @CurrentStudio() studio: StudioContext,
    @Query() query: PaginationDto,
    @Query('unread') unread?: string,
  ) {
    return this.notifications.list(studio.id, query.page, query.limit, unread === 'true');
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  async markRead(@CurrentStudio() studio: StudioContext, @Param('id') id: string) {
    return this.notifications.markRead(studio.id, id);
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  async markAllRead(@CurrentStudio() studio: StudioContext) {
    return this.notifications.markAllRead(studio.id);
  }
}
