import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { StudioRole } from '../../db/schema';

export class UpdateStudioDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'brandColor must be a hex colour like #FF5A36' })
  brandColor?: string;
}

export class CreateStudioInviteDto {
  @IsEmail()
  email!: string;

  @IsEnum(StudioRole)
  role!: StudioRole;
}

export class UpdateStudioMemberDto {
  @IsEnum(StudioRole)
  role!: StudioRole;
}

export class AcceptStudioInviteDto {
  @IsString()
  @Length(10, 300)
  token!: string;
}
