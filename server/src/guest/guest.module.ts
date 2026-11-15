import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ProcessingModule } from '../processing/processing.module';
import { GuestAuthGuard } from './guest-auth.guard';
import {
  GuestController,
  PublicGuestController,
  PublicShareController,
} from './guest.controller';
import { GuestService } from './guest.service';

@Module({
  imports: [JwtModule.register({}), ProcessingModule],
  controllers: [PublicGuestController, GuestController, PublicShareController],
  providers: [GuestService, GuestAuthGuard],
  exports: [GuestService],
})
export class GuestModule {}
