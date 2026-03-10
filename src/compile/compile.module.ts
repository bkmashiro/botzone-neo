import { Module } from '@nestjs/common';
import { CompileService } from './compile.service';

/**
 * 编译模块：提供多语言编译能力
 */
@Module({
  providers: [CompileService],
  exports: [CompileService],
})
export class CompileModule {}
