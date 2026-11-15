import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { StudioRole } from '../db/schema';
import type { Request } from 'express';
import { CurrentStudio, CurrentUser } from '../common/decorators/current-user.decorator';
import { StudioRoles } from '../common/decorators/studio-roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { StudioAccessGuard } from '../common/guards/studio-access.guard';
import type { AuthUser, StudioContext } from '../common/types/auth.types';
import { PhotoListQueryDto, PhotoStatsQueryDto, ReprocessPhotoDto } from './dto/photos.dto';
import { PhotosService } from './photos.service';

const MAX_FILE_SIZE = 40 * 1024 * 1024;
const MAX_FILES = 20;

@ApiTags('Photos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, StudioAccessGuard)
@Controller()
export class PhotosController {
  constructor(private readonly photos: PhotosService) {}

  private meta(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  @Post('events/:eventId/photos')
  @ApiOperation({ summary: 'Upload photographs to an event gallery' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files'],
      properties: {
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
      },
    },
  })
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'files', maxCount: MAX_FILES }], {
      limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
    }),
  )
  async upload(
    @CurrentStudio() studio: StudioContext,
    @CurrentUser() user: AuthUser,
    @Param('eventId') eventId: string,
    @UploadedFiles() files: { files?: Express.Multer.File[] } | undefined,
    @Req() req: Request,
  ) {
    if (!files?.files?.length) {
      throw new BadRequestException('Choose at least one photograph to upload');
    }
    return this.photos.upload(studio, eventId, files.files, user, this.meta(req));
  }

  @Get('photos')
  @ApiOperation({ summary: 'List photographs across the studio or a single event' })
  async list(@CurrentStudio() studio: StudioContext, @Query() query: PhotoListQueryDto) {
    return this.photos.list(studio.id, query);
  }

  @Get('photos/stats')
  @ApiOperation({ summary: 'Photograph processing and storage statistics' })
  async stats(@CurrentStudio() studio: StudioContext, @Query() query: PhotoStatsQueryDto) {
    return this.photos.stats(studio.id, query.eventId);
  }

  @Get('photos/:id')
  @ApiOperation({ summary: 'Get a single photograph with signed preview URLs' })
  async get(@CurrentStudio() studio: StudioContext, @Param('id') id: string) {
    return this.photos.get(studio.id, id);
  }

  @Get('photos/:id/download')
  @ApiOperation({ summary: 'Create a short-lived original-quality download URL' })
  async download(@CurrentStudio() studio: StudioContext, @Param('id') id: string) {
    return this.photos.downloadUrl(studio.id, id);
  }

  @Post('photos/:id/reprocess')
  @HttpCode(HttpStatus.OK)
  @StudioRoles(StudioRole.OWNER, StudioRole.ADMIN)
  @ApiOperation({ summary: 'Re-run thumbnailing and AI face indexing for a photograph' })
  async reprocess(
    @CurrentStudio() studio: StudioContext,
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() _dto: ReprocessPhotoDto,
    @Req() req: Request,
  ) {
    return this.photos.reprocess(studio.id, id, user, this.meta(req));
  }

  @Delete('photos/:id')
  @StudioRoles(StudioRole.OWNER, StudioRole.ADMIN)
  @ApiOperation({ summary: 'Delete a photograph, its derivatives, and its face embeddings' })
  async remove(
    @CurrentStudio() studio: StudioContext,
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.photos.remove(studio.id, id, user, this.meta(req));
  }
}
