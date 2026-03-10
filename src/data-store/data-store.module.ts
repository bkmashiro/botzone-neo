import { Module } from '@nestjs/common';
import { DataStoreService } from './data-store.service';

/**
 * 数据存储模块：管理 Bot 的 data 和 globaldata 持久化
 */
@Module({
  providers: [DataStoreService],
  exports: [DataStoreService],
})
export class DataStoreModule {}
