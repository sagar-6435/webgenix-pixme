import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PhotoStatus } from '../../db/schema';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class PhotoListQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  eventId?: string;

  @IsOptional()
  @IsEnum(PhotoStatus)
  status?: PhotoStatus;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;

  @IsOptional()
  @IsIn(['newest', 'oldest', 'filename'])
  sort?: 'newest' | 'oldest' | 'filename';
}

export class PhotoStatsQueryDto {
  @IsOptional()
  @IsString()
  eventId?: string;
}

export class ReprocessPhotoDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  @Type(() => Number)
  batchSize?: number;
}
