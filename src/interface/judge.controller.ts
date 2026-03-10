/**
 * 评测接口控制器
 *
 * POST /v1/judge — 统一入口，按 task.type 分发到 Botzone 或 OJ 用例
 */

import { Controller, Post, Body, HttpCode, BadRequestException } from '@nestjs/common';
import { JudgeQueueService } from './judge-queue.service';
import { MatchTask } from '../domain/match';
import { BotSpec } from '../domain/bot';
import { OJTask } from '../domain/oj/testcase';
import {
  MAX_SOURCE_LENGTH,
  MIN_TIME_LIMIT_MS,
  MAX_TIME_LIMIT_MS,
  MIN_MEMORY_LIMIT_MB,
  MAX_MEMORY_LIMIT_MB,
  MAX_TESTCASE_LENGTH,
} from './dto/task.dto';

@Controller('v1/judge')
export class JudgeController {
  constructor(private readonly judgeQueue: JudgeQueueService) {}

  @Post()
  @HttpCode(202)
  async submitTask(
    @Body() body: Record<string, unknown>,
  ): Promise<{ message: string; jobId: string }> {
    const type = body['type'] as string;

    if (type === 'botzone') {
      this.validateBotzoneTask(body);
      const task = this.toMatchTask(body);
      const jobId = await this.judgeQueue.enqueue({ type: 'botzone', task });
      return { message: '对局任务已接受', jobId };
    }

    if (type === 'oj') {
      this.validateOJTask(body);
      const task = body as unknown as OJTask;
      const jobId = await this.judgeQueue.enqueue({ type: 'oj', task });
      return { message: 'OJ 评测任务已接受', jobId };
    }

    throw new BadRequestException(`未知任务类型: ${type ?? '(未指定)'}`);
  }

  /** 验证 Botzone 任务参数 */
  private validateBotzoneTask(body: Record<string, unknown>): void {
    const game = body['game'];
    if (!game || typeof game !== 'object') {
      throw new BadRequestException('缺少 game 字段');
    }
    const callback = body['callback'] as Record<string, unknown> | undefined;
    if (!callback || typeof callback !== 'object' || !callback['finish']) {
      throw new BadRequestException('缺少 callback 字段');
    }
    for (const [id, code] of Object.entries(game as Record<string, Record<string, unknown>>)) {
      if (!code['source'] || typeof code['source'] !== 'string') {
        throw new BadRequestException(`${id}: 缺少 source`);
      }
      if ((code['source'] as string).length > MAX_SOURCE_LENGTH) {
        throw new BadRequestException(`${id}: source 超过 64KB 限制`);
      }
      const limit = code['limit'] as Record<string, unknown> | undefined;
      if (!limit || typeof limit !== 'object') {
        throw new BadRequestException(`${id}: 缺少 limit`);
      }
      if (
        typeof limit['time'] !== 'number' ||
        limit['time'] < MIN_TIME_LIMIT_MS ||
        limit['time'] > MAX_TIME_LIMIT_MS
      ) {
        throw new BadRequestException(
          `${id}: time_limit 必须在 ${MIN_TIME_LIMIT_MS}~${MAX_TIME_LIMIT_MS}ms`,
        );
      }
      if (
        typeof limit['memory'] !== 'number' ||
        limit['memory'] < MIN_MEMORY_LIMIT_MB ||
        limit['memory'] > MAX_MEMORY_LIMIT_MB
      ) {
        throw new BadRequestException(
          `${id}: memory_limit 必须在 ${MIN_MEMORY_LIMIT_MB}~${MAX_MEMORY_LIMIT_MB}MB`,
        );
      }
    }
  }

  /** 验证 OJ 任务参数 */
  private validateOJTask(body: Record<string, unknown>): void {
    if (!body['source'] || typeof body['source'] !== 'string') {
      throw new BadRequestException('缺少 source');
    }
    if ((body['source'] as string).length > MAX_SOURCE_LENGTH) {
      throw new BadRequestException('source 超过 64KB 限制');
    }
    if (!body['language'] || typeof body['language'] !== 'string') {
      throw new BadRequestException('缺少 language');
    }
    const timeLimitMs = body['timeLimitMs'];
    if (
      typeof timeLimitMs !== 'number' ||
      timeLimitMs < MIN_TIME_LIMIT_MS ||
      timeLimitMs > MAX_TIME_LIMIT_MS
    ) {
      throw new BadRequestException(
        `timeLimitMs 必须在 ${MIN_TIME_LIMIT_MS}~${MAX_TIME_LIMIT_MS}ms`,
      );
    }
    const memoryLimitMb = body['memoryLimitMb'];
    if (
      typeof memoryLimitMb !== 'number' ||
      memoryLimitMb < MIN_MEMORY_LIMIT_MB ||
      memoryLimitMb > MAX_MEMORY_LIMIT_MB
    ) {
      throw new BadRequestException(
        `memoryLimitMb 必须在 ${MIN_MEMORY_LIMIT_MB}~${MAX_MEMORY_LIMIT_MB}MB`,
      );
    }
    if (!Array.isArray(body['testcases']) || body['testcases'].length === 0) {
      throw new BadRequestException('缺少 testcases');
    }
    for (const tc of body['testcases'] as Array<Record<string, unknown>>) {
      if (typeof tc['input'] === 'string' && tc['input'].length > MAX_TESTCASE_LENGTH) {
        throw new BadRequestException(`testcase ${tc['id']}: input 超过 10MB 限制`);
      }
      if (
        typeof tc['expectedOutput'] === 'string' &&
        tc['expectedOutput'].length > MAX_TESTCASE_LENGTH
      ) {
        throw new BadRequestException(`testcase ${tc['id']}: expectedOutput 超过 10MB 限制`);
      }
    }
    const callback = body['callback'] as Record<string, unknown> | undefined;
    if (!callback || !callback['finish']) {
      throw new BadRequestException('缺少 callback.finish');
    }
  }

  /** 将旧格式 game Record 转为 BotSpec[] */
  private toMatchTask(body: Record<string, unknown>): MatchTask {
    const game = body['game'] as Record<
      string,
      {
        language: string;
        source: string;
        limit: { time: number; memory: number };
      }
    >;
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
