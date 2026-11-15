import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  Equals,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CreateGuestSessionDto {
  @IsBoolean()
  @Equals(true, { message: 'You must accept the face-matching consent to continue' })
  accepted!: boolean;

  @IsString()
  @MaxLength(40)
  consentVersion!: string;
}

export class GuestMatchListQueryDto extends PaginationDto {
  @IsOptional()
  @IsIn(['best', 'newest'])
  sort?: 'best' | 'newest';

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  favorites?: boolean;
}

export class BulkDownloadDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  photoIds?: string[];
}
