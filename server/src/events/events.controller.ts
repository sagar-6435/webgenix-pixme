import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { StudioRole } from '../db/schema';
import type { Request } from 'express';
import { CurrentStudio, CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { StudioRoles } from '../common/decorators/studio-roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { StudioAccessGuard } from '../common/guards/studio-access.guard';
import type { AuthUser, StudioContext } from '../common/types/auth.types';
import { EventsService } from './events.service';
import {
  CreateEventDto,
  EventListQueryDto,
  GuestSessionListQueryDto,
  UpdateEventDto,
  UpdateEventStatusDto,
} from './dto/events.dto';
import { Throttle } from '@nestjs/throttler';

const imageFilter = (
  _request: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
) => {
  if (!file.mimetype?.startsWith('image/')) {
    return callback(new BadRequestException('Only image files are supported'), false);
  }
  return callback(null, true);
};

@ApiTags('Events')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, StudioAccessGuard)
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  private meta(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  @Get()
  async list(@CurrentStudio() studio: StudioContext, @Query() query: EventListQueryDto) {
    return this.events.list(studio.id, query);
  }

  @Post()
  @StudioRoles(StudioRole.OWNER, StudioRole.ADMIN)
  async create(
    @CurrentStudio() studio: StudioContext,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateEventDto,
    @Req() req: Request,
  ) {
    return this.events.create(studio, user, dto, this.meta(req));
  }

  @Get(':id/analytics')
  @StudioRoles(StudioRole.OWNER, StudioRole.ADMIN)
  async analytics(
    @CurrentStudio() studio: StudioContext,
    @Param('id') id: string,
    @Query('days') days?: string,
  ) {
    return this.events.analytics(studio.id, id, days ? Number(days) : 30);
  }

  @Get(':id/guests')
  @StudioRoles(StudioRole.OWNER, StudioRole.ADMIN)
  async guests(
    @CurrentStudio() studio: StudioContext,
    @Param('id') id: string,
    @Query() query: GuestSessionListQueryDto,
  ) {
    return this.events.listGuestSessions(studio.id, id, query);
  }

  @Delete(':id/guests/:sessionId')
  @StudioRoles(StudioRole.OWNER, StudioRole.ADMIN)
  async deleteGuest(
    @CurrentStudio() studio: StudioContext,
    @Param('id') id: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.events.deleteGuestSession(studio.id, id, sessionId, user, this.meta(req));
  }

  @Get(':id')
  async get(@CurrentStudio() studio: StudioContext, @Param('id') id: string) {
    return this.events.get(studio.id, id);
  }

  @Patch(':id')
  @StudioRoles(StudioRole.OWNER, StudioRole.ADMIN)
  async update(
    @CurrentStudio() studio: StudioContext,
    @Param('id') id: string,
    @Body() dto: UpdateEventDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.events.update(studio.id, id, dto, user, this.meta(req));
  }

  @Delete(':id')
  @StudioRoles(StudioRole.OWNER, StudioRole.ADMIN)
  async remove(
    @CurrentStudio() studio: StudioContext,
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.events.remove(studio.id, id, user, this.meta(req));
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @StudioRoles(StudioRole.OWNER, StudioRole.ADMIN)
  async setStatus(
    @CurrentStudio() studio: StudioContext,
    @Param('id') id: string,
    @Body() dto: UpdateEventStatusDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.events.setStatus(studio.id, id, dto.status, user, this.meta(req));
  }

  @Post(':id/cover')
  @StudioRoles(StudioRole.OWNER, StudioRole.ADMIN)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 }, fileFilter: imageFilter }))
  async cover(
    @CurrentStudio() studio: StudioContext,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.events.uploadCover(studio.id, id, file, 'cover', user, this.meta(req));
  }

  @Post(':id/logo')
  @StudioRoles(StudioRole.OWNER, StudioRole.ADMIN)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 }, fileFilter: imageFilter }))
  async logo(
    @CurrentStudio() studio: StudioContext,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.events.uploadCover(studio.id, id, file, 'logo', user, this.meta(req));
  }
}

@ApiTags('Public Events')
@Public()
@Throttle({ default: { limit: 120, ttl: 60_000 } })
@Controller('public/events')
export class PublicEventsController {
  constructor(private readonly events: EventsService) {}

  @Get(':slug')
  async get(@Param('slug') slug: string, @Req() req: Request, @Query('src') src?: string) {
    return this.events.publicBySlug(slug, {
      src,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      referrer: req.headers.referer,
    });
  }
}
