/**
 * JudgeModule — 评测模块
 *
 * 注册控制器、用例、基础设施服务。
 * 沙箱实现通过 SANDBOX_TOKEN 注入，默认 DirectSandbox（开发环境）。
 * 生产环境切换为 NsjailSandbox。
 */

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';

// Interface
import { JudgeController } from './judge.controller';
import { JudgeQueueService, JUDGE_QUEUE } from './judge-queue.service';

// Application
import { RunMatchUseCase } from '../application/run-match.usecase';
import { RunOJUseCase } from '../application/run-oj.usecase';

// Infrastructure
import { CompileService } from '../infrastructure/compile/compile.service';
import { CallbackService } from '../infrastructure/callback/callback.service';
import { DataStoreService } from '../infrastructure/data-store/data-store.service';
import { SANDBOX_TOKEN } from '../infrastructure/sandbox/sandbox.interface';
import { DirectSandbox } from '../infrastructure/sandbox/direct.sandbox';
import { NsjailSandbox } from '../infrastructure/sandbox/nsjail.sandbox';

@Module({
  imports: [ConfigModule, BullModule.registerQueue({ name: JUDGE_QUEUE })],
  controllers: [JudgeController],
  providers: [
    // 队列服务
    JudgeQueueService,

    // 用例层
    RunMatchUseCase,
    RunOJUseCase,

    // 基础设施层
    CompileService,
    CallbackService,
    DataStoreService,

    // 沙箱：根据环境变量选择实现
    {
      provide: SANDBOX_TOKEN,
      useFactory: (config: ConfigService) => {
        const sandboxType = config.get<string>('SANDBOX_TYPE', 'direct');
        if (sandboxType === 'nsjail') {
          return new NsjailSandbox();
        }
        return new DirectSandbox();
      },
      inject: [ConfigService],
    },
  ],
})
export class JudgeModule {}
