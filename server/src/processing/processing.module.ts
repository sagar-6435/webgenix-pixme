import { Module } from '@nestjs/common';
import { FacesModule } from '../faces/faces.module';
import { PhotoProcessor } from './photo.processor';
import { GuestMatchProcessor } from './guest-match.processor';
import { MaintenanceProcessor } from './maintenance.processor';
import { ProcessingService } from './processing.service';

@Module({
  imports: [FacesModule],
  providers: [PhotoProcessor, GuestMatchProcessor, MaintenanceProcessor, ProcessingService],
  exports: [ProcessingService, MaintenanceProcessor],
})
export class ProcessingModule {}
