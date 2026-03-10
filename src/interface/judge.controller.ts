/**
 * JudgeController — POST /v1/judge → 按 type 分发
 *
 * 接收评测任务，根据 type 字段分发给不同的 UseCase：
 * - botzone → RunMatchUseCase
 * - oj → RunOJUseCase
 */

import { Controller, Post, Body, HttpCode, BadRequestException } from '@nestjs/common';
import { RunMatchUseCase } from '../application/run-match.usecase';
import { RunOJUseCase } from '../application/run-oj.usecase';
import { MatchTask } from '../domain/match';
import { OJTask } from '../domain/oj/testcase';

/** 通用任务入口（根据 type 字段分发） */
interface JudgeRequest {
  type: 'botzone' | 'oj';
  [key: string]: unknown;
}

@Controller('v1/judge')
export class JudgeController {
  constructor(
    private readonly runMatchUseCase: RunMatchUseCase,
    private readonly runOJUseCase: RunOJUseCase,
  ) {}

  /** 提交评测任务（异步处理，立即返回 202） */
  @Post()
  @HttpCode(202)
  async submitTask(@Body() body: JudgeRequest) {
    switch (body.type) {
      case 'botzone':
        // 异步执行，不 await
        this.runMatchUseCase.execute(body as unknown as MatchTask).catch(() => {});
        return { message: 'Botzone 对局任务已接受' };

      case 'oj':
        // 异步执行，不 await
        this.runOJUseCase.execute(body as unknown as OJTask).catch(() => {});
        return { message: 'OJ 评测任务已接受' };

      default:
        throw new BadRequestException(`不支持的任务类型: ${body.type}`);
    }
  }
}
