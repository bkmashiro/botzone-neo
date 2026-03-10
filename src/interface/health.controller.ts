import { Controller, Get, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import * as fs from 'fs/promises';
import * as os from 'os';

import { JUDGE_QUEUE } from './judge-queue.service';

/**
 * Individual component health status with optional error message.
 */
interface ComponentStatus {
  status: 'ok' | 'error';
  message?: string;
}

/**
 * System health status response including version, uptime, and component statuses.
 */
interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  uptime: number;
  components: {
    redis: ComponentStatus;
    disk: ComponentStatus;
  };
}

@ApiTags('health')
@Controller('health')
/**
 * Health check controller for monitoring system and component status.
 */
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(@InjectQueue(JUDGE_QUEUE) private readonly judgeQueue: Queue) {}

  @Get()
  @ApiOperation({ summary: '健康检查（含组件状态）' })
  @ApiResponse({
    status: 200,
    description: '服务正常或降级',
    schema: {
      properties: {
        status: { type: 'string', enum: ['ok', 'degraded'] },
        version: { type: 'string' },
        uptime: { type: 'number', description: '进程运行秒数' },
        components: {
          type: 'object',
          properties: {
            redis: {
              type: 'object',
              properties: { status: { type: 'string' }, message: { type: 'string' } },
            },
            disk: {
              type: 'object',
              properties: { status: { type: 'string' }, message: { type: 'string' } },
            },
          },
        },
      },
    },
  })
  async check(): Promise<HealthResponse> {
    const [redis, disk] = await Promise.all([this.checkRedis(), this.checkDisk()]);

    const allOk = redis.status === 'ok' && disk.status === 'ok';

    return {
      status: allOk ? 'ok' : 'degraded',
      version: '1.0.0',
      uptime: Math.floor(process.uptime()),
      components: { redis, disk },
    };
  }

  private async checkRedis(): Promise<ComponentStatus> {
    try {
      const client = this.judgeQueue.client;
      await client.ping();
      return { status: 'ok' };
    } catch (err) {
      this.logger.warn(`Redis 健康检查失败: ${err}`);
      return { status: 'error', message: String(err) };
    }
  }

  private async checkDisk(): Promise<ComponentStatus> {
    try {
      await fs.access(os.tmpdir(), fs.constants.W_OK);
      return { status: 'ok' };
    } catch (err) {
      this.logger.warn(`磁盘写入权限检查失败: ${err}`);
      return { status: 'error', message: String(err) };
    }
  }
}
