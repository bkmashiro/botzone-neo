import { Module } from '@nestjs/common';
import { NsjailService } from './nsjail.service';

/**
 * 沙箱模块：提供 nsjail 沙箱执行能力
 */
@Module({
  providers: [NsjailService],
  exports: [NsjailService],
})
export class SandboxModule {}
