/**
 * 评测接口控制器
 *
 * POST /v1/judge — 统一入口，按 task.type 分发到 Botzone 或 OJ 用例
 */

import { Controller, Post, Body, HttpCode, Logger, BadRequestException } from '@nestjs/common';
import { RunMatchUseCase } from '../application/run-match.usecase';
import { RunOJUseCase } from '../application/run-oj.usecase';
import { MatchTask } from '../domain/match';
import { BotSpec } from '../domain/bot';
import { OJTask } from '../domain/oj/testcase';

@Controller('v1/judge')
export class JudgeController {
  private readonly logger = new Logger(JudgeController.name);

  constructor(
    private readonly runMatchUseCase: RunMatchUseCase,
    private readonly runOJUseCase: RunOJUseCase,
  ) {}

  @Post()
  @HttpCode(202)
  async submitTask(@Body() body: Record<string, unknown>) {
    const type = body['type'] as string;

    if (type === 'botzone') {
      const task = this.toMatchTask(body);
      // 异步执行，不阻塞 HTTP 响应
      this.runMatchUseCase.execute(task).catch(err => {
        this.logger.error(`Botzone 对局失败: ${err}`);
      });
      return { message: '对局任务已接受' };
    }

    if (type === 'oj') {
      const task = body as unknown as OJTask;
      this.runOJUseCase.execute(task).catch(err => {
        this.logger.error(`OJ 评测失败: ${err}`);
      });
      return { message: 'OJ 评测任务已接受' };
    }

    throw new BadRequestException(`未知任务类型: ${type}`);
  }

  /** 将旧格式 game Record 转为 BotSpec[] */
  private toMatchTask(body: Record<string, unknown>): MatchTask {
    const game = body['game'] as Record<string, {
      language: string;
      source: string;
      limit: { time: number; memory: number };
    }>;
    const callback = body['callback'] as { update: string; finish: string };
    const initdata = body['initdata'] as string | object | undefined;
    const runMode = (body['runMode'] as string) ?? 'restart';

    const bots: BotSpec[] = Object.entries(game).map(([id, code]) => ({
      id,
      language: code.language,
      source: code.source,
      limit: {
        timeMs: code.limit.time,
        memoryMb: code.limit.memory,
      },
    }));

    return {
      type: 'botzone',
      bots,
      callback,
      initdata: typeof initdata === 'object' ? JSON.stringify(initdata) : initdata,
      runMode: runMode as 'restart' | 'longrun',
    };
  }
}
