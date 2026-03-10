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
import {
  makeCounterProvider,
  makeHistogramProvider,
  makeGaugeProvider,
} from '@willsoto/nestjs-prometheus';

// Interface
import { JudgeController } from './judge.controller';
import { HealthController } from './health.controller';
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
  controllers: [JudgeController, HealthController],
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

    // Prometheus 指标
    makeCounterProvider({
      name: 'botzone_judge_requests_total',
      help: 'Total judge requests',
      labelNames: ['type', 'verdict'],
    }),
    makeHistogramProvider({
      name: 'botzone_judge_duration_ms',
      help: 'Judge request duration in milliseconds',
      labelNames: ['type'],
      buckets: [500, 1000, 3000, 10000, 30000],
    }),
    makeGaugeProvider({
      name: 'botzone_active_matches',
      help: 'Number of currently active matches',
    }),
    makeCounterProvider({
      name: 'botzone_compile_cache_hits_total',
      help: 'Compile cache hits',
    }),
    makeCounterProvider({
      name: 'botzone_compile_cache_misses_total',
      help: 'Compile cache misses',
    }),

    // 沙箱：根据环境变量选择实现
    {
      provide: SANDBOX_TOKEN,
      useFactory: (config: ConfigService) => {
        const sandboxType = config.get<string>('SANDBOX_BACKEND', 'direct');
        if (sandboxType === 'nsjail') {
          return new NsjailSandbox(config);
        }
        return new DirectSandbox();
      },
      inject: [ConfigService],
    },
  ],
})
export class JudgeModule {}
