/**
 * Judge API E2E 测试
 *
 * 使用 @nestjs/testing 创建 NestJS app，mock JudgeQueueService（避免 Redis 依赖）。
 * 测试 HTTP 层：状态码、响应体、参数校验。
 */

import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as request from 'supertest';
import { JudgeController } from '../../src/interface/judge.controller';
import { HealthController } from '../../src/interface/health.controller';
import { JudgeQueueService } from '../../src/interface/judge-queue.service';

describe('Judge API E2E', () => {
  let app: INestApplication;
  let mockEnqueue: jest.Mock;

  const mockQueue = {
    client: { ping: jest.fn().mockResolvedValue('PONG') },
    add: jest.fn(),
  };

  beforeEach(async () => {
    mockEnqueue = jest.fn().mockResolvedValue('test-job-1');

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true })],
      controllers: [JudgeController, HealthController],
      providers: [
        { provide: JudgeQueueService, useValue: { enqueue: mockEnqueue } },
        { provide: 'BullQueue_judge', useValue: mockQueue },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // ── 健康检查 ──

  it('GET /health → 200 + 组件状态 + 版本 + uptime', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.version).toBe('1.0.0');
    expect(typeof res.body.uptime).toBe('number');
    expect(res.body.components.redis.status).toBe('ok');
    expect(res.body.components.disk.status).toBe('ok');
  });

  it('GET /health → Redis 异常时 status=degraded', async () => {
    mockQueue.client.ping.mockRejectedValueOnce(new Error('Connection refused'));
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.components.redis.status).toBe('error');
  });

  // ── Botzone 合法任务 ──

  it('POST /v1/judge botzone 合法任务 → 202 + jobId', async () => {
    const body = {
      type: 'botzone',
      game: {
        judger: { language: 'cpp', source: '// judge', limit: { time: 3000, memory: 256 } },
        '0': { language: 'cpp', source: '// bot', limit: { time: 1000, memory: 128 } },
      },
      callback: { update: 'http://test/u', finish: 'http://test/f' },
    };

    const res = await request(app.getHttpServer()).post('/v1/judge').send(body).expect(202);

    expect(res.body.jobId).toBe('test-job-1');
    expect(res.body.message).toBe('对局任务已接受');
    expect(mockEnqueue).toHaveBeenCalledWith({
      type: 'botzone',
      task: expect.objectContaining({ type: 'botzone', bots: expect.any(Array) }),
    });
  });

  // ── OJ 合法任务 ──

  it('POST /v1/judge OJ 合法任务 → 202 + jobId', async () => {
    const body = {
      type: 'oj',
      language: 'cpp',
      source: '#include <cstdio>\nint main() { printf("3\\n"); }',
      testcases: [{ id: 1, input: '1 2\n', expectedOutput: '3\n' }],
      timeLimitMs: 1000,
      memoryLimitMb: 256,
      callback: { finish: 'http://test/oj-finish' },
      judgeMode: 'standard',
    };

    const res = await request(app.getHttpServer()).post('/v1/judge').send(body).expect(202);

    expect(res.body.jobId).toBe('test-job-1');
    expect(res.body.message).toBe('OJ 评测任务已接受');
    expect(mockEnqueue).toHaveBeenCalledWith({
      type: 'oj',
      task: expect.objectContaining({ type: 'oj', language: 'cpp' }),
    });
  });

  // ── 参数校验 ──

  it('POST /v1/judge 缺少 type → 400', async () => {
    await request(app.getHttpServer())
      .post('/v1/judge')
      .send({ game: {}, callback: { finish: 'x' } })
      .expect(400);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('POST /v1/judge botzone 缺少 game 字段 → 400', async () => {
    await request(app.getHttpServer())
      .post('/v1/judge')
      .send({
        type: 'botzone',
        callback: { update: 'http://u', finish: 'http://f' },
      })
      .expect(400);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('POST /v1/judge 超长 source（>64KB）→ 400', async () => {
    const longSource = 'x'.repeat(65537);

    await request(app.getHttpServer())
      .post('/v1/judge')
      .send({
        type: 'botzone',
        game: {
          judger: { language: 'cpp', source: longSource, limit: { time: 3000, memory: 256 } },
        },
        callback: { update: 'http://u', finish: 'http://f' },
      })
      .expect(400);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('POST /v1/judge time_limit < 1 → 400', async () => {
    await request(app.getHttpServer())
      .post('/v1/judge')
      .send({
        type: 'botzone',
        game: {
          judger: { language: 'cpp', source: '// ok', limit: { time: 0, memory: 256 } },
        },
        callback: { update: 'http://u', finish: 'http://f' },
      })
      .expect(400);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('POST /v1/judge memory_limit > 2048 → 400', async () => {
    await request(app.getHttpServer())
      .post('/v1/judge')
      .send({
        type: 'botzone',
        game: {
          judger: { language: 'cpp', source: '// ok', limit: { time: 1000, memory: 4096 } },
        },
        callback: { update: 'http://u', finish: 'http://f' },
      })
      .expect(400);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('POST /v1/judge OJ 缺少 testcases → 400', async () => {
    await request(app.getHttpServer())
      .post('/v1/judge')
      .send({
        type: 'oj',
        language: 'cpp',
        source: '// code',
        testcases: [],
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        callback: { finish: 'http://f' },
        judgeMode: 'standard',
      })
      .expect(400);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('POST /v1/judge OJ timeLimitMs < 1 → 400', async () => {
    await request(app.getHttpServer())
      .post('/v1/judge')
      .send({
        type: 'oj',
        language: 'cpp',
        source: '// code',
        testcases: [{ id: 1, input: '1', expectedOutput: '1' }],
        timeLimitMs: 0,
        memoryLimitMb: 256,
        callback: { finish: 'http://f' },
        judgeMode: 'standard',
      })
      .expect(400);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('POST /v1/judge OJ memoryLimitMb > 2048 → 400', async () => {
    await request(app.getHttpServer())
      .post('/v1/judge')
      .send({
        type: 'oj',
        language: 'cpp',
        source: '// code',
        testcases: [{ id: 1, input: '1', expectedOutput: '1' }],
        timeLimitMs: 1000,
        memoryLimitMb: 4096,
        callback: { finish: 'http://f' },
        judgeMode: 'standard',
      })
      .expect(400);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
