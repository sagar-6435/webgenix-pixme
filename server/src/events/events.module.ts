import { Module } from '@nestjs/common';
import { ProcessingModule } from '../processing/processing.module';
import { EventsController, PublicEventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [ProcessingModule],
  controllers: [EventsController, PublicEventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
