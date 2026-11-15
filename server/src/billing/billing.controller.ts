import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { StudioRole } from '../db/schema';
import type { Request } from 'express';
import { CurrentStudio, CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { StudioRoles } from '../common/decorators/studio-roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { StudioAccessGuard } from '../common/guards/studio-access.guard';
import type { AuthUser, StudioContext } from '../common/types/auth.types';
import { BillingService } from './billing.service';
import { ChangePlanDto, InvoiceListQueryDto } from './dto/billing.dto';

function meta(req: Request) {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

@ApiTags('Billing')
@Public()
@Throttle({ default: { limit: 120, ttl: 60_000 } })
@Controller('plans')
export class PublicPlansController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  @ApiOperation({ summary: 'Available subscription plans' })
  async plans() {
    return this.billing.plans();
  }
}

@ApiTags('Billing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, StudioAccessGuard)
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('overview')
  @StudioRoles(StudioRole.OWNER, StudioRole.ADMIN)
  @ApiOperation({ summary: 'Subscription, renewal, invoice, and plan-limit overview' })
  async overview(@CurrentStudio() studio: StudioContext) {
    return this.billing.overview(studio);
  }

  @Get('subscription')
  @StudioRoles(StudioRole.OWNER, StudioRole.ADMIN)
  @ApiOperation({ summary: 'Current subscription and plan' })
  async subscription(@CurrentStudio() studio: StudioContext) {
    return this.billing.subscription(studio);
  }

  @Post('subscription/change')
  @HttpCode(HttpStatus.OK)
  @StudioRoles(StudioRole.OWNER)
  @ApiOperation({ summary: 'Change plan or billing interval' })
  async changePlan(
    @CurrentStudio() studio: StudioContext,
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePlanDto,
    @Req() req: Request,
  ) {
    return this.billing.changePlan(studio, user, dto, meta(req));
  }

  @Post('subscription/cancel')
  @HttpCode(HttpStatus.OK)
  @StudioRoles(StudioRole.OWNER)
  @ApiOperation({ summary: 'Cancel at the end of the billing period' })
  async cancel(
    @CurrentStudio() studio: StudioContext,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.billing.cancel(studio, user, meta(req));
  }

  @Post('subscription/resume')
  @HttpCode(HttpStatus.OK)
  @StudioRoles(StudioRole.OWNER)
  @ApiOperation({ summary: 'Resume a subscription scheduled to end' })
  async resume(
    @CurrentStudio() studio: StudioContext,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.billing.resume(studio, user, meta(req));
  }

  @Get('invoices')
  @StudioRoles(StudioRole.OWNER, StudioRole.ADMIN)
  @ApiOperation({ summary: 'Invoice history' })
  async invoices(
    @CurrentStudio() studio: StudioContext,
    @Query() query: InvoiceListQueryDto,
  ) {
    return this.billing.invoices(studio, query);
  }

  @Get('invoices/:id')
  @StudioRoles(StudioRole.OWNER, StudioRole.ADMIN)
  @ApiOperation({ summary: 'Invoice detail' })
  async invoice(@CurrentStudio() studio: StudioContext, @Param('id') id: string) {
    return this.billing.invoice(studio, id);
  }
}
