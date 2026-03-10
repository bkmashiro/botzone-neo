import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { JudgeController } from './judge.controller';
import { JudgeService, JUDGE_QUEUE } from './judge.service';
import { MatchRunner } from './match-runner';
import { CompileModule } from '../compile/compile.module';
import { SandboxModule } from '../sandbox/sandbox.module';
import { DataStoreModule } from '../data-store/data-store.module';
import { CallbackService } from '../callback/callback.service';

/**
 * 评测模块：注册队列、控制器、服务
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: JUDGE_QUEUE }),
    CompileModule,
    SandboxModule,
    DataStoreModule,
  ],
  controllers: [JudgeController],
  providers: [JudgeService, MatchRunner, CallbackService],
})
export class JudgeModule {}
