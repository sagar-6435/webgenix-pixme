import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { StorageUsageService } from './storage-usage.service';

@Global()
@Module({
  providers: [StorageService, StorageUsageService],
  exports: [StorageService, StorageUsageService],
})
export class StorageModule {}
