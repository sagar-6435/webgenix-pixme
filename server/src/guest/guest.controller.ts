import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import archiver from 'archiver';
import type { Request, Response } from 'express';
import { CurrentGuest } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { StorageService } from '../storage/storage.service';
import { GuestAuthGuard } from './guest-auth.guard';
import { GuestService } from './guest.service';
import type { GuestRequestContext } from './guest.types';
import { BulkDownloadDto, CreateGuestSessionDto, GuestMatchListQueryDto } from './dto/guest.dto';

function guestMeta(req: Request) {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

@ApiTags('Guest Experience')
@Public()
@Controller('public/events')
export class PublicGuestController {
  constructor(private readonly guests: GuestService) {}

  @Post(':slug/guest-sessions')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Accept biometric consent and start a private guest session' })
  async create(
    @Param('slug') slug: string,
    @Body() dto: CreateGuestSessionDto,
    @Req() req: Request,
  ) {
    return this.guests.createSession(slug, dto, guestMeta(req));
  }
}

@ApiTags('Guest Experience')
@ApiBearerAuth()
@Public()
@UseGuards(GuestAuthGuard)
@Throttle({ default: { limit: 180, ttl: 60_000 } })
@Controller('guest')
export class GuestController {
  private readonly logger = new Logger(GuestController.name);

  constructor(
    private readonly guests: GuestService,
    private readonly storage: StorageService,
  ) {}

  @Get('session')
  @ApiOperation({ summary: 'Current guest session status, privacy state, and limits' })
  async session(@CurrentGuest() guest: GuestRequestContext) {
    return this.guests.getSession(guest);
  }

  @Post('selfie')
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @ApiOperation({ summary: 'Upload an ephemeral selfie and start face matching' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('selfie', {
      limits: { fileSize: 15 * 1024 * 1024, files: 1 },
    }),
  )
  async selfie(
    @CurrentGuest() guest: GuestRequestContext,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    return this.guests.uploadSelfie(guest, file, guestMeta(req));
  }

  @Get('matches')
  @ApiOperation({ summary: 'Private gallery of photographs matched to this guest' })
  async matches(
    @CurrentGuest() guest: GuestRequestContext,
    @Query() query: GuestMatchListQueryDto,
  ) {
    return this.guests.listMatches(guest, query);
  }

  @Post('photos/:id/favorite')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save a matched photograph to favourites' })
  async favorite(@CurrentGuest() guest: GuestRequestContext, @Param('id') id: string) {
    return this.guests.setFavorite(guest, id, true);
  }

  @Delete('photos/:id/favorite')
  @ApiOperation({ summary: 'Remove a photograph from favourites' })
  async unfavorite(@CurrentGuest() guest: GuestRequestContext, @Param('id') id: string) {
    return this.guests.setFavorite(guest, id, false);
  }

  @Get('photos/:id/download')
  @ApiOperation({ summary: 'Get a short-lived original-resolution download URL' })
  async download(
    @CurrentGuest() guest: GuestRequestContext,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.guests.downloadOne(guest, id, guestMeta(req));
  }

  @Post('downloads/bulk')
  @ApiOperation({ summary: 'Download selected matches as a ZIP archive' })
  async bulk(
    @CurrentGuest() guest: GuestRequestContext,
    @Body() dto: BulkDownloadDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { files } = await this.guests.prepareBulkDownload(
      guest,
      dto.photoIds,
      guestMeta(req),
    );

    const stamp = new Date().toISOString().slice(0, 10);
    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="pixme-${guest.event.slug || 'gallery'}-${stamp}.zip"`,
    );
    res.setHeader('Cache-Control', 'no-store');

    const archive = archiver('zip', { zlib: { level: 0 } });
    archive.on('warning', (error) => {
      this.logger.warn(`ZIP warning: ${error.message}`);
    });
    archive.on('error', (error) => {
      this.logger.error(`ZIP failed: ${error.message}`);
      if (!res.headersSent) {
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'Download failed' });
      } else {
        res.destroy(error);
      }
    });
    res.on('close', () => {
      if (!archive.readableEnded) archive.destroy();
    });
    archive.pipe(res);

    try {
      for (const file of files) {
        const object = await this.storage.getStream(file.key);
        archive.append(object.body, { name: file.name });
        await new Promise<void>((resolve, reject) => {
          const onEntry = () => {
            cleanup();
            resolve();
          };
          const onError = (error: Error) => {
            cleanup();
            reject(error);
          };
          const cleanup = () => {
            archive.off('entry', onEntry);
            archive.off('error', onError);
          };
          archive.once('entry', onEntry);
          archive.once('error', onError);
        });
      }
      await archive.finalize();
    } catch (error) {
      this.logger.error(`Bulk download failed: ${(error as Error).message}`);
      archive.destroy();
      if (!res.headersSent) {
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'Download failed' });
      } else {
        res.destroy(error as Error);
      }
    }
  }

  @Post('photos/:id/share')
  @ApiOperation({ summary: 'Create an expiring public share link for a matched photograph' })
  async share(@CurrentGuest() guest: GuestRequestContext, @Param('id') id: string) {
    return this.guests.createShareLink(guest, id);
  }

  @Delete('session')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw consent and immediately erase all guest matching data' })
  async revoke(@CurrentGuest() guest: GuestRequestContext, @Req() req: Request) {
    return this.guests.revoke(guest, guestMeta(req));
  }
}

@ApiTags('Guest Experience')
@Public()
@Throttle({ default: { limit: 120, ttl: 60_000 } })
@Controller('public/shares')
export class PublicShareController {
  constructor(private readonly guests: GuestService) {}

  @Get(':token')
  @ApiOperation({ summary: 'Resolve an expiring guest share link into a download URL' })
  async resolve(@Param('token') token: string, @Req() req: Request) {
    if (!token) throw new BadRequestException('Invalid share link');
    return this.guests.resolveShare(token, guestMeta(req));
  }
}
