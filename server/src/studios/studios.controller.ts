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
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StudioRole } from '../db/schema';
import type { Request } from 'express';
import { CurrentStudio, CurrentUser } from '../common/decorators/current-user.decorator';
import { StudioRoles } from '../common/decorators/studio-roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { StudioAccessGuard } from '../common/guards/studio-access.guard';
import type { AuthUser, StudioContext } from '../common/types/auth.types';
import {
  AcceptStudioInviteDto,
  CreateStudioInviteDto,
  UpdateStudioDto,
  UpdateStudioMemberDto,
} from './dto/studios.dto';
import { StudiosService } from './studios.service';

function meta(req: Request) {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

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

@ApiTags('Studios')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, StudioAccessGuard)
@Controller('studios')
export class StudiosController {
  constructor(private readonly studios: StudiosService) {}

  @Get('current')
  @ApiOperation({ summary: 'Current studio, plan, limits, and usage' })
  async current(@CurrentStudio() studio: StudioContext) {
    return this.studios.current(studio);
  }

  @Patch('current')
  @StudioRoles(StudioRole.OWNER, StudioRole.ADMIN)
  @ApiOperation({ summary: 'Update studio profile and branding' })
  async update(
    @CurrentStudio() studio: StudioContext,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateStudioDto,
    @Req() req: Request,
  ) {
    return this.studios.update(studio, dto, user, meta(req));
  }

  @Post('current/logo')
  @StudioRoles(StudioRole.OWNER, StudioRole.ADMIN)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a studio logo' })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 }, fileFilter: imageFilter }),
  )
  async logo(
    @CurrentStudio() studio: StudioContext,
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    return this.studios.uploadLogo(studio, file, user, meta(req));
  }

  @Get('current/team')
  @ApiOperation({ summary: 'Team members, pending invitations, and seat usage' })
  async team(@CurrentStudio() studio: StudioContext) {
    return this.studios.team(studio);
  }

  @Post('current/team/invites')
  @StudioRoles(StudioRole.OWNER, StudioRole.ADMIN)
  @ApiOperation({ summary: 'Invite a teammate by email' })
  async invite(
    @CurrentStudio() studio: StudioContext,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateStudioInviteDto,
    @Req() req: Request,
  ) {
    return this.studios.invite(studio, dto, user, meta(req));
  }

  @Delete('current/team/invites/:inviteId')
  @StudioRoles(StudioRole.OWNER, StudioRole.ADMIN)
  @ApiOperation({ summary: 'Revoke a pending invitation' })
  async revokeInvite(
    @CurrentStudio() studio: StudioContext,
    @Param('inviteId') inviteId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.studios.revokeInvite(studio, inviteId, user, meta(req));
  }

  @Patch('current/team/:memberId')
  @StudioRoles(StudioRole.OWNER, StudioRole.ADMIN)
  @ApiOperation({ summary: 'Change a teammate role' })
  async updateMember(
    @CurrentStudio() studio: StudioContext,
    @Param('memberId') memberId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateStudioMemberDto,
    @Req() req: Request,
  ) {
    return this.studios.updateMember(studio, memberId, dto, user, meta(req));
  }

  @Delete('current/team/:memberId')
  @StudioRoles(StudioRole.OWNER, StudioRole.ADMIN)
  @ApiOperation({ summary: 'Remove a teammate from the studio' })
  async removeMember(
    @CurrentStudio() studio: StudioContext,
    @Param('memberId') memberId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.studios.removeMember(studio, memberId, user, meta(req));
  }

  @Get('current/usage')
  @ApiOperation({ summary: 'Storage and plan usage breakdown' })
  async usage(@CurrentStudio() studio: StudioContext) {
    return this.studios.usage(studio);
  }
}

@ApiTags('Studios')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('studio-invites')
export class StudioInvitesController {
  constructor(private readonly studios: StudiosService) {}

  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept a studio invitation for the signed-in account' })
  async accept(
    @CurrentUser() user: AuthUser,
    @Body() dto: AcceptStudioInviteDto,
    @Req() req: Request,
  ) {
    return this.studios.acceptInvite(user, dto.token, meta(req));
  }
}
