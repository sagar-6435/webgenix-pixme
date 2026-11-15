import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentStudio } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { StudioAccessGuard } from '../common/guards/studio-access.guard';
import type { StudioContext } from '../common/types/auth.types';
import { QrService, type QrPosterTemplate } from './qr.service';

const TEMPLATES: QrPosterTemplate[] = ['editorial', 'midnight', 'minimal'];

@ApiTags('QR Codes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, StudioAccessGuard)
@Controller('events')
export class QrController {
  constructor(private readonly qr: QrService) {}

  @Get(':id/qr/stats')
  async stats(@CurrentStudio() studio: StudioContext, @Param('id') id: string) {
    return this.qr.stats(id, studio.id);
  }

  @Get(':id/qr/poster')
  async poster(
    @CurrentStudio() studio: StudioContext,
    @Param('id') id: string,
    @Res() res: Response,
    @Query('template') templateRaw?: string,
    @Query('format') formatRaw?: string,
  ) {
    const event = await this.qr.getEventForStudio(id, studio.id);
    const template = TEMPLATES.includes(templateRaw as QrPosterTemplate)
      ? (templateRaw as QrPosterTemplate)
      : 'editorial';
    const format = formatRaw === 'svg' ? 'svg' : 'png';
    const filename = `${event.slug}-qr-poster.${format}`;

    if (format === 'svg') {
      const svg = await this.qr.posterSvg(event, template);
      res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(svg);
      return;
    }
    const png = await this.qr.posterPng(event, template);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(png);
  }

  @Get(':id/qr')
  async qrCode(
    @CurrentStudio() studio: StudioContext,
    @Param('id') id: string,
    @Res() res: Response,
    @Query('format') formatRaw?: string,
    @Query('size') sizeRaw?: string,
  ) {
    const event = await this.qr.getEventForStudio(id, studio.id);
    const format = formatRaw === 'svg' ? 'svg' : 'png';
    const filename = `${event.slug}-qr.${format}`;

    if (format === 'svg') {
      const svg = await this.qr.qrSvg(event);
      res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(svg);
      return;
    }
    const png = await this.qr.qrPng(event, sizeRaw ? Number(sizeRaw) : 1024);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(png);
  }
}
