/**
 * 评测接口控制器
 *
 * POST /v1/judge — 统一入口，按 task.type 分发到 Botzone 或 OJ 用例
 */

import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpCode,
  BadRequestException,
  NotFoundException,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
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

@ApiTags('judge')
@UseGuards(ThrottlerGuard)
@Controller('v1/judge')
/**
 * Main judge controller for submitting and querying evaluation tasks.
 */
export class JudgeController {
  private readonly logger = new Logger(JudgeController.name);

  constructor(private readonly judgeQueue: JudgeQueueService) {}

  @Get(':jobId/status')
  @ApiOperation({ summary: '查询任务状态' })
  @ApiResponse({
    status: 200,
    description: '任务状态',
    schema: {
      properties: {
        jobId: { type: 'string' },
        state: { type: 'string', enum: ['waiting', 'active', 'completed', 'failed', 'delayed'] },
        type: { type: 'string', enum: ['botzone', 'oj'] },
        finishedOn: { type: 'string', format: 'date-time' },
        failedReason: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 404, description: '任务不存在' })
  async getJobStatus(@Param('jobId') jobId: string): Promise<{
    jobId: string;
    state: string;
    type?: string;
    finishedOn?: string;
    failedReason?: string;
  }> {
    const status = await this.judgeQueue.getJobStatus(jobId);
    if (!status) {
      throw new NotFoundException(`任务 ${jobId} 不存在`);
    }
    return status;
  }

  @Post()
  @HttpCode(202)
  @ApiOperation({
    summary: '提交评测任务',
    description: '按 type 字段分发到 Botzone 对局或 OJ 评测',
  })
  @ApiResponse({
    status: 202,
    description: '任务已入队',
    schema: { properties: { message: { type: 'string' }, jobId: { type: 'string' } } },
  })
  @ApiResponse({ status: 400, description: '参数校验失败' })
  async submitTask(
    @Body() body: Record<string, unknown>,
  ): Promise<{ message: string; jobId: string }> {
    const type = body['type'] as string;

    if (type === 'botzone') {
      this.validateBotzoneTask(body);
      const task = this.toMatchTask(body);
      const jobId = await this.judgeQueue.enqueue({ type: 'botzone', task });
      this.logger.log(
        `Botzone 任务已入队: jobId=${jobId}, bots=${task.bots.map((b) => b.id).join(',')}`,
      );
      return { message: '对局任务已接受', jobId };
    }

    if (type === 'oj') {
      this.validateOJTask(body);
      const task = body as unknown as OJTask;
      const jobId = await this.judgeQueue.enqueue({ type: 'oj', task });
      this.logger.log(`OJ 任务已入队: jobId=${jobId}, language=${task.language}`);
      return { message: 'OJ 评测任务已接受', jobId };
    }

    throw new BadRequestException(`未知任务类型: ${type ?? '(未指定)'}`);
  }

  /** 验证 Botzone 任务参数 */
  private validateBotzoneTask(body: Record<string, unknown>): void {
    const game = body['game'];
    if (!game || typeof game !== 'object' || Array.isArray(game)) {
      throw new BadRequestException('缺少 game 字段');
    }
    const gameEntries = Object.entries(game as Record<string, unknown>);
    if (gameEntries.length === 0) {
      throw new BadRequestException('game 对象不能为空');
    }
    const callback = body['callback'] as Record<string, unknown> | undefined;
    if (!callback || typeof callback !== 'object' || !callback['finish']) {
      throw new BadRequestException('缺少 callback 字段');
    }
    this.validateUrl(String(callback['finish']), 'callback.finish');
    if (callback['update']) {
      this.validateUrl(String(callback['update']), 'callback.update');
    }
    for (const [id, rawCode] of gameEntries) {
      if (!rawCode || typeof rawCode !== 'object' || Array.isArray(rawCode)) {
        throw new BadRequestException(`${id}: 必须是对象`);
      }
      const code = rawCode as Record<string, unknown>;
      if (!code['language'] || typeof code['language'] !== 'string') {
        throw new BadRequestException(`${id}: 缺少 language`);
      }
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
    if (body['testcases'].length > 1000) {
      throw new BadRequestException('testcases 数量不能超过 1000');
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
    this.validateUrl(String(callback['finish']), 'callback.finish');

    // 验证 judgeMode
    const judgeMode = body['judgeMode'];
    if (!judgeMode || (judgeMode !== 'standard' && judgeMode !== 'checker')) {
      throw new BadRequestException('judgeMode 必须为 standard 或 checker');
    }
    if (judgeMode === 'checker') {
      if (!body['checkerSource'] || typeof body['checkerSource'] !== 'string') {
        throw new BadRequestException('checker 模式要求提供 checkerSource');
      }
      if (!body['checkerLanguage'] || typeof body['checkerLanguage'] !== 'string') {
        throw new BadRequestException('checker 模式要求提供 checkerLanguage');
      }
      if ((body['checkerSource'] as string).length > MAX_SOURCE_LENGTH) {
        throw new BadRequestException('checkerSource 超过 64KB 限制');
      }
    }
  }

  /** 验证 URL 格式（仅允许 http/https，拒绝内网地址） */
  private validateUrl(url: string, field: string): void {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new BadRequestException(`${field}: 仅支持 http/https 协议`);
      }
      if (this.isPrivateHost(parsed.hostname)) {
        throw new BadRequestException(`${field}: 不允许使用内网地址`);
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(`${field}: 无效的 URL 格式`);
    }
  }

  /** 检测是否为内网/回环地址（防止 SSRF） */
  private isPrivateHost(hostname: string): boolean {
    if (hostname === 'localhost' || hostname === '[::1]') return true;

    // IPv6 检测（去除方括号）
    const ipv6 = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
    if (ipv6.includes(':')) {
      return this.isPrivateIPv6(ipv6);
    }

    // IPv4 private ranges
    const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4Match) {
      const [, a, b, c, d] = ipv4Match.map(Number);
      return this.isPrivateIPv4(a, b, c, d);
    }
    return false;
  }

  /** 检测 IPv6 是否为私有/保留地址 */
  private isPrivateIPv6(addr: string): boolean {
    const normalized = addr.toLowerCase();
    // ::1 loopback
    if (normalized === '::1') return true;
    // :: unspecified
    if (normalized === '::') return true;
    // fe80::/10 link-local
    if (normalized.startsWith('fe80:') || normalized.startsWith('fe80')) return true;
    // fc00::/7 unique local (fc00::/8 + fd00::/8)
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    // ff00::/8 multicast
    if (normalized.startsWith('ff')) return true;
    // ::ffff:0:0/96 IPv4-mapped — dotted form (e.g. ::ffff:192.168.1.1)
    const v4MappedMatch = normalized.match(/^::ffff:(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (v4MappedMatch) {
      const [, a, b, c, d] = v4MappedMatch.map(Number);
      return this.isPrivateIPv4(a, b, c, d);
    }
    // ::ffff:0:0/96 IPv4-mapped — hex form (e.g. ::ffff:c0a8:101, normalized by Node URL)
    const v4HexMatch = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (v4HexMatch) {
      const hi = parseInt(v4HexMatch[1], 16);
      const lo = parseInt(v4HexMatch[2], 16);
      return this.isPrivateIPv4((hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff);
    }
    return false;
  }

  /** 检测 IPv4 四元组是否为私有地址 */
  private isPrivateIPv4(a: number, b: number, c: number, d: number): boolean {
    if (a > 255 || b > 255 || c > 255 || d > 255) return true;
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
    return false;
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
