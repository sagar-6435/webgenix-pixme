import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RealtimeBus } from './realtime.bus';
import { RealtimeGateway } from './realtime.gateway';

@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [RealtimeGateway, RealtimeBus],
  exports: [RealtimeGateway, RealtimeBus],
})
export class RealtimeModule {}
