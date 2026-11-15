import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FaceApiEngine } from './face-api.engine';
import { FaceEngine } from './face-engine';

@Module({
  providers: [
    FaceApiEngine,
    {
      provide: FaceEngine,
      inject: [ConfigService, FaceApiEngine],
      useFactory: (config: ConfigService, faceApi: FaceApiEngine): FaceEngine => {
        const engine = config.get<string>('ai.engine') ?? 'face-api';
        if (engine === 'face-api') return faceApi;
        throw new Error(
          `Unsupported FACE_ENGINE "${engine}". Implement the FaceEngine provider and register it here.`,
        );
      },
    },
  ],
  exports: [FaceEngine, FaceApiEngine],
})
export class FacesModule {}
