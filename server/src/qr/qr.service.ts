import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq } from 'drizzle-orm';
import * as QRCode from 'qrcode';
import sharp from 'sharp';
import { DrizzleService } from '../db/drizzle.service';
import { events, qrCodes } from '../db/schema';
import { StorageService } from '../storage/storage.service';
import { escapeHtml } from '../common/utils/crypto.util';

export type QrPosterTemplate = 'editorial' | 'midnight' | 'minimal';

interface PosterEvent {
  id: string;
  name: string;
  slug: string;
  startAt: Date;
  endAt: Date | null;
  locationName: string;
  city: string;
  country: string;
  brandColor: string;
  logoKey: string | null;
  studio: { name: string };
}

@Injectable()
export class QrService {
  constructor(
    private readonly database: DrizzleService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  async getEventForStudio(eventId: string, studioId: string): Promise<PosterEvent> {
    const event = await this.database.db.query.events.findFirst({
      where: and(eq(events.id, eventId), eq(events.studioId, studioId)),
      columns: {
        id: true,
        name: true,
        slug: true,
        startAt: true,
        endAt: true,
        locationName: true,
        city: true,
        country: true,
        brandColor: true,
        logoKey: true,
      },
      with: { studio: { columns: { name: true } } },
    });
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  targetUrl(slug: string): string {
    return `${this.config.getOrThrow<string>('appUrl')}/e/${slug}?src=qr`;
  }

  async qrPng(event: PosterEvent, size = 1024): Promise<Buffer> {
    const width = Math.max(256, Math.min(2048, size));
    return QRCode.toBuffer(this.targetUrl(event.slug), {
      type: 'png',
      width,
      margin: 2,
      errorCorrectionLevel: 'H',
      color: { dark: '#121014', light: '#FFFFFF' },
    });
  }

  async qrSvg(event: PosterEvent): Promise<string> {
    return QRCode.toString(this.targetUrl(event.slug), {
      type: 'svg',
      margin: 2,
      errorCorrectionLevel: 'H',
      width: 1024,
      color: { dark: '#121014', light: '#FFFFFF' },
    });
  }

  async posterSvg(event: PosterEvent, template: QrPosterTemplate): Promise<string> {
    const target = this.targetUrl(event.slug);
    const qrData = await QRCode.toDataURL(target, {
      width: 900,
      margin: 1,
      errorCorrectionLevel: 'H',
      color: { dark: '#121014', light: '#FFFFFF' },
    });
    const logoSrc = await this.logoDataUri(event.logoKey);
    const date = new Intl.DateTimeFormat('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(event.startAt);
    const place = [event.locationName, event.city, event.country].filter(Boolean).join(' · ');
    const titleLines = wrapText(event.name, 19, 3);
    const accent = /^#[0-9a-fA-F]{6}$/.test(event.brandColor) ? event.brandColor : '#FF5A36';
    const displayUrl = target.replace(/^https?:\/\//, '');
    const urlLines = wrapText(displayUrl, 38, 2);

    const palette =
      template === 'midnight'
        ? { bg: '#0E0D10', fg: '#F7F3EC', muted: '#9C958E', card: '#17151A', line: '#2A262D' }
        : template === 'minimal'
          ? { bg: '#FFFFFF', fg: '#121014', muted: '#77716B', card: '#F7F4EF', line: '#E8E1D8' }
          : { bg: '#F3EDE3', fg: '#17130F', muted: '#6E655C', card: '#FFFDF9', line: '#DCD1C3' };

    const title = titleLines
      .map(
        (line, index) =>
          `<tspan x="90" dy="${index === 0 ? 0 : 94}">${escapeHtml(line)}</tspan>`,
      )
      .join('');
    const titleBottom = 330 + (titleLines.length - 1) * 94;
    const qrTop = Math.max(titleBottom + 150, 720);
    const cardSize = template === 'minimal' ? 700 : 800;
    const cardX = (1200 - cardSize) / 2;
    const cardY = qrTop;
    const qrSize = cardSize - 100;
    const qrX = (1200 - cardSize) / 2 + 50;
    const qrY = cardY + 50;
    const cardRadius = template === 'minimal' ? 12 : 28;
    const logoSnippet = logoSrc
      ? `<image href="${logoSrc}" x="1030" y="72" width="80" height="80" preserveAspectRatio="xMidYMid meet" clip-path="url(#logoClip)"/>`
      : `<circle cx="1070" cy="112" r="36" fill="none" stroke="${accent}" stroke-width="2"/><text x="1070" y="122" text-anchor="middle" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="${palette.fg}">P</text>`;

    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="1600" viewBox="0 0 1200 1600">
  <defs>
    <clipPath id="logoClip"><rect x="1030" y="72" width="80" height="80" rx="18"/></clipPath>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${palette.bg}" stop-opacity="0"/>
      <stop offset="1" stop-color="${palette.bg}" stop-opacity="1"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="1600" fill="${palette.bg}"/>
  <rect x="36" y="36" width="1128" height="1528" rx="8" fill="none" stroke="${palette.line}" stroke-width="1.5"/>
  <rect x="36" y="36" width="12" height="1528" fill="${accent}"/>

  <text x="90" y="132" font-family="Arial, Helvetica, sans-serif" font-size="17" letter-spacing="4" font-weight="700" fill="${palette.muted}">PHOTOGRAPHS, FOUND BY FACE</text>
  <text x="90" y="172" font-family="Georgia, 'Times New Roman', serif" font-size="24" font-style="italic" fill="${palette.fg}">${escapeHtml(event.studio.name)}</text>
  ${logoSnippet}

  <line x1="90" y1="214" x2="300" y2="214" stroke="${accent}" stroke-width="3"/>
  <text x="90" y="288" font-family="Georgia, 'Times New Roman', serif" font-size="86" font-weight="400" fill="${palette.fg}">${title}</text>

  <text x="90" y="${titleBottom + 64}" font-family="Arial, Helvetica, sans-serif" font-size="21" letter-spacing="2.5" fill="${palette.muted}" text-transform="uppercase">${escapeHtml(date.toUpperCase())}</text>
  ${
    place
      ? `<text x="90" y="${titleBottom + 104}" font-family="Georgia, 'Times New Roman', serif" font-size="24" font-style="italic" fill="${palette.muted}">${escapeHtml(place)}</text>`
      : ''
  }

  <rect x="${cardX}" y="${cardY}" width="${cardSize}" height="${cardSize}" rx="${cardRadius}" fill="${palette.card}"/>
  <image href="${qrData}" x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}"/>
  <text x="600" y="${cardY + cardSize - 42}" font-family="Arial, Helvetica, sans-serif" font-size="18" letter-spacing="2" text-anchor="middle" fill="${palette.muted}">SCAN TO FIND YOUR PHOTOS</text>

  <text x="90" y="${cardY + cardSize + 82}" font-family="Arial, Helvetica, sans-serif" font-size="18" letter-spacing="0.5" fill="${palette.muted}">${urlLines.map((line) => escapeHtml(line)).join('<tspan x="90" dy="28">')}</text>
  <line x1="90" y1="${cardY + cardSize + 160}" x2="1110" y2="${cardY + cardSize + 160}" stroke="${palette.line}"/>
  <text x="90" y="${cardY + cardSize + 200}" font-family="Arial, Helvetica, sans-serif" font-size="15" fill="${palette.muted}">Your photos are matched privately using on-device consent and encrypted facial indexing.</text>
  <text x="1110" y="${cardY + cardSize + 200}" text-anchor="end" font-family="Georgia, 'Times New Roman', serif" font-size="16" font-style="italic" fill="${accent}">pixme.</text>
</svg>`;
  }

  async posterPng(event: PosterEvent, template: QrPosterTemplate): Promise<Buffer> {
    const svg = await this.posterSvg(event, template);
    return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  }

  async stats(eventId: string, studioId: string) {
    const [qr] = await this.database.db
      .select({ scans: qrCodes.scans, lastScanAt: qrCodes.lastScanAt, createdAt: qrCodes.createdAt })
      .from(qrCodes)
      .innerJoin(events, eq(qrCodes.eventId, events.id))
      .where(and(eq(qrCodes.eventId, eventId), eq(events.studioId, studioId)))
      .limit(1);
    if (!qr) throw new NotFoundException('QR code not found');
    const since = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
    const rows = await this.database.pool.query<{ day: string; count: string }>(
      `SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day, COUNT(*)::bigint AS count
       FROM "qr_scans"
       WHERE "eventId" = $1 AND "createdAt" >= $2
       GROUP BY 1 ORDER BY 1`,
      [eventId, since],
    );
    return {
      totalScans: qr.scans,
      lastScanAt: qr.lastScanAt,
      series: rows.rows.map((row) => ({ day: row.day, count: Number(row.count) })),
    };
  }

  private async logoDataUri(key: string | null): Promise<string | null> {
    if (!key) return null;
    try {
      const buffer = await this.storage.getBuffer(key);
      const contentType = key.endsWith('.png')
        ? 'image/png'
        : key.endsWith('.webp')
          ? 'image/webp'
          : 'image/jpeg';
      return `data:${contentType};base64,${buffer.toString('base64')}`;
    } catch {
      return null;
    }
  }
}

function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (`${current} ${word}`.length <= maxChars) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, maxChars - 1)}…`;
  }
  return lines.length ? lines : ['Your event'];
}
