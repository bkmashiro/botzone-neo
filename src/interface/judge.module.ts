/**
 * JudgeModule — 评测模块（新架构）
 *
 * 注册控制器、用例、基础设施服务。
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JudgeController } from './judge.controller';
import { RunMatchUseCase } from '../application/run-match.usecase';
import { RunOJUseCase } from '../application/run-oj.usecase';
import { CompileUseCase } from '../application/compile.usecase';
import { CompileService } from '../infrastructure/compile/compile.service';
import { CallbackService } from '../infrastructure/callback/callback.service';
import { DataStoreService } from '../infrastructure/data-store/data-store.service';
import { DirectSandboxFactory, ISandboxFactory } from '../infrastructure/process/sandbox-factory';

/** ISandboxFactory 的注入 token */
export const SANDBOX_FACTORY = 'SANDBOX_FACTORY';

@Module({
  imports: [ConfigModule],
  controllers: [JudgeController],
  providers: [
    // 用例层
    RunMatchUseCase,
    RunOJUseCase,
    CompileUseCase,

    // 基础设施层
    CompileService,
    CallbackService,
    DataStoreService,

    // 沙箱工厂：开发环境用 DirectSandboxFactory
    {
      provide: 'ISandboxFactory',
      useFactory: () => new DirectSandboxFactory(),
    },

    // 注入 ISandboxFactory 到用例层
    {
      provide: RunMatchUseCase,
      useFactory: (
        compileUseCase: CompileUseCase,
        callbackService: CallbackService,
        dataStoreService: DataStoreService,
        sandboxFactory: ISandboxFactory,
      ) => new RunMatchUseCase(compileUseCase, callbackService, dataStoreService, sandboxFactory),
      inject: [CompileUseCase, CallbackService, DataStoreService, 'ISandboxFactory'],
    },
    {
      provide: RunOJUseCase,
      useFactory: (
        compileUseCase: CompileUseCase,
        callbackService: CallbackService,
        sandboxFactory: ISandboxFactory,
      ) => new RunOJUseCase(compileUseCase, callbackService, sandboxFactory),
      inject: [CompileUseCase, CallbackService, 'ISandboxFactory'],
    },
  ],
})
export class JudgeModule {}
