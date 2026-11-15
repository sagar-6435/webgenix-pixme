import { Module } from '@nestjs/common';
import { BillingController, PublicPlansController } from './billing.controller';
import { BillingService } from './billing.service';

@Module({
  controllers: [PublicPlansController, BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
