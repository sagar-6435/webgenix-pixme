import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { EventCategory, EventStatus } from '../../db/schema';
import { PartialType } from '@nestjs/swagger';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class EventSettingsDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.3)
  @Max(0.7)
  matchThreshold?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.5)
  @Max(0.95)
  minFaceConfidence?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2000)
  maxPhotosPerMatch?: number;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(720)
  guestSessionMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  selfieRetentionMinutes?: number;

  @IsOptional()
  @IsBoolean()
  allowDownloads?: boolean;

  @IsOptional()
  @IsBoolean()
  allowFavorites?: boolean;

  @IsOptional()
  @IsBoolean()
  allowGuestSharing?: boolean;

  @IsOptional()
  @IsBoolean()
  watermarkDownloads?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  consentVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  consentText?: string;
}

export class CreateEventDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsEnum(EventCategory)
  category!: EventCategory;

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  description?: string;

  @IsISO8601()
  startAt!: string;

  @IsOptional()
  @IsISO8601()
  endAt?: string;

  @IsOptional()
  @IsISO8601()
  galleryExpiresAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  locationName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  locationAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'brandColor must be a hex colour like #FF5A36' })
  brandColor?: string;

  @IsOptional()
  @IsBoolean()
  isDiscoverable?: boolean;

  @IsOptional()
  @IsEnum(EventStatus)
  status?: EventStatus;

  @IsOptional()
  @ValidateNested()
  @Type(() => EventSettingsDto)
  settings?: EventSettingsDto;
}

export class UpdateEventDto extends PartialType(CreateEventDto) {
  @IsOptional()
  @ValidateNested()
  @Type(() => EventSettingsDto)
  settings?: EventSettingsDto;
}

export class EventListQueryDto extends PaginationDto {
  @IsOptional()
  @IsEnum(EventStatus)
  status?: EventStatus;

  @IsOptional()
  @IsEnum(EventCategory)
  category?: EventCategory;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsString()
  sort?: 'newest' | 'oldest' | 'upcoming';
}

export class GuestSessionListQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateEventStatusDto {
  @IsEnum(EventStatus)
  status!: EventStatus;
}
