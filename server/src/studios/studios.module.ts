import { Module } from '@nestjs/common';
import { StudiosController, StudioInvitesController } from './studios.controller';
import { StudiosService } from './studios.service';

@Module({
  controllers: [StudiosController, StudioInvitesController],
  providers: [StudiosService],
  exports: [StudiosService],
})
export class StudiosModule {}
