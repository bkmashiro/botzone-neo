/**
 * Judge API E2E 测试
 *
 * 使用 @nestjs/testing 创建 NestJS app，mock JudgeQueueService（避免 Redis 依赖）。
 * 测试 HTTP 层：状态码、响应体、参数校验。
 */

import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import * as request from 'supertest';
import { JudgeController } from '../../src/interface/judge.controller';
import { HealthController } from '../../src/interface/health.controller';
import { JudgeQueueService } from '../../src/interface/judge-queue.service';
import { AllExceptionsFilter } from '../../src/interface/all-exceptions.filter';

describe('Judge API E2E', () => {
  let app: INestApplication;
  let mockEnqueue: jest.Mock;
  let mockGetJobStatus: jest.Mock;

  const mockQueue = {
    client: { ping: jest.fn().mockResolvedValue('PONG') },
    add: jest.fn(),
  };

  beforeEach(async () => {
    mockEnqueue = jest.fn().mockResolvedValue('test-job-1');
    mockGetJobStatus = jest.fn();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        ThrottlerModule.forRoot([{ ttl: 60000, limit: 1000 }]),
      ],
      controllers: [JudgeController, HealthController],
      providers: [
        {
          provide: JudgeQueueService,
          useValue: { enqueue: mockEnqueue, getJobStatus: mockGetJobStatus },
        },
        { provide: 'BullQueue_judge', useValue: mockQueue },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
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

  // ── 任务状态查询 ──

  it('GET /v1/judge/:jobId/status → 200 + 任务状态', async () => {
    mockGetJobStatus.mockResolvedValue({
      jobId: 'job-42',
      state: 'completed',
      type: 'botzone',
      finishedOn: '2026-03-10T00:00:00.000Z',
    });

    const res = await request(app.getHttpServer()).get('/v1/judge/job-42/status').expect(200);

    expect(res.body.jobId).toBe('job-42');
    expect(res.body.state).toBe('completed');
    expect(res.body.type).toBe('botzone');
    expect(mockGetJobStatus).toHaveBeenCalledWith('job-42');
  });

  it('GET /v1/judge/:jobId/status → 404 不存在的任务', async () => {
    mockGetJobStatus.mockResolvedValue(null);

    await request(app.getHttpServer()).get('/v1/judge/nonexistent/status').expect(404);
  });

  // ── 错误响应格式 ──

  it('400 错误包含标准化字段 (statusCode, error, message, timestamp, path)', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/judge')
      .send({ type: 'botzone' })
      .expect(400);

    expect(res.body.statusCode).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.message).toBeDefined();
    expect(res.body.timestamp).toBeDefined();
    expect(res.body.path).toBe('/v1/judge');
  });

  it('404 错误包含标准化字段', async () => {
    mockGetJobStatus.mockResolvedValue(null);

    const res = await request(app.getHttpServer()).get('/v1/judge/xxx/status').expect(404);

    expect(res.body.statusCode).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
    expect(res.body.message).toContain('xxx');
    expect(res.body.path).toBe('/v1/judge/xxx/status');
  });

  // ── 未知任务类型 ──

  it('POST /v1/judge 未知 type → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/judge')
      .send({ type: 'unknown', source: '// code' })
      .expect(400);

    expect(res.body.message).toContain('未知任务类型');
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  // ── SSRF 防护 ──

  it('POST /v1/judge botzone callback 使用内网地址 192.168.x.x → 400', async () => {
    await request(app.getHttpServer())
      .post('/v1/judge')
      .send({
        type: 'botzone',
        game: {
          judger: { language: 'cpp', source: '// ok', limit: { time: 1000, memory: 256 } },
        },
        callback: { update: 'http://192.168.1.1/u', finish: 'http://192.168.1.1/f' },
      })
      .expect(400);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('POST /v1/judge botzone callback 使用 localhost → 400', async () => {
    await request(app.getHttpServer())
      .post('/v1/judge')
      .send({
        type: 'botzone',
        game: {
          judger: { language: 'cpp', source: '// ok', limit: { time: 1000, memory: 256 } },
        },
        callback: { update: 'http://localhost/u', finish: 'http://localhost/f' },
      })
      .expect(400);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('POST /v1/judge botzone callback 使用 10.x.x.x → 400', async () => {
    await request(app.getHttpServer())
      .post('/v1/judge')
      .send({
        type: 'botzone',
        game: {
          judger: { language: 'cpp', source: '// ok', limit: { time: 1000, memory: 256 } },
        },
        callback: { update: 'http://10.0.0.1/u', finish: 'http://10.0.0.1/f' },
      })
      .expect(400);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('POST /v1/judge botzone callback 使用 127.0.0.1 → 400', async () => {
    await request(app.getHttpServer())
      .post('/v1/judge')
      .send({
        type: 'botzone',
        game: {
          judger: { language: 'cpp', source: '// ok', limit: { time: 1000, memory: 256 } },
        },
        callback: { update: 'http://127.0.0.1/u', finish: 'http://127.0.0.1/f' },
      })
      .expect(400);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('POST /v1/judge OJ callback 使用内网地址 → 400', async () => {
    await request(app.getHttpServer())
      .post('/v1/judge')
      .send({
        type: 'oj',
        language: 'cpp',
        source: '// code',
        testcases: [{ id: 1, input: '1', expectedOutput: '1' }],
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        callback: { finish: 'http://172.16.0.1/f' },
        judgeMode: 'standard',
      })
      .expect(400);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  // ── OJ checker 模式 ──

  it('POST /v1/judge OJ checker 模式合法任务 → 202', async () => {
    const body = {
      type: 'oj',
      language: 'cpp',
      source: '#include <cstdio>\nint main() { printf("3\\n"); }',
      testcases: [{ id: 1, input: '1 2\n', expectedOutput: '3\n' }],
      timeLimitMs: 1000,
      memoryLimitMb: 256,
      callback: { finish: 'http://test/oj-finish' },
      judgeMode: 'checker',
      checkerSource: '#include "testlib.h"\nint main() { return 0; }',
      checkerLanguage: 'cpp',
    };

    const res = await request(app.getHttpServer()).post('/v1/judge').send(body).expect(202);

    expect(res.body.jobId).toBe('test-job-1');
    expect(mockEnqueue).toHaveBeenCalledWith({
      type: 'oj',
      task: expect.objectContaining({ judgeMode: 'checker', checkerSource: expect.any(String) }),
    });
  });

  // ── Botzone callback 缺失 ──

  it('POST /v1/judge botzone 缺少 callback.finish → 400', async () => {
    await request(app.getHttpServer())
      .post('/v1/judge')
      .send({
        type: 'botzone',
        game: {
          judger: { language: 'cpp', source: '// ok', limit: { time: 1000, memory: 256 } },
        },
        callback: { update: 'http://test/u' },
      })
      .expect(400);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('POST /v1/judge botzone 缺少 callback → 400', async () => {
    await request(app.getHttpServer())
      .post('/v1/judge')
      .send({
        type: 'botzone',
        game: {
          judger: { language: 'cpp', source: '// ok', limit: { time: 1000, memory: 256 } },
        },
      })
      .expect(400);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  // ── OJ testcases 上限 ──

  it('POST /v1/judge OJ testcases 超过 1000 个 → 400', async () => {
    const testcases = Array.from({ length: 1001 }, (_, i) => ({
      id: i + 1,
      input: '1',
      expectedOutput: '1',
    }));

    await request(app.getHttpServer())
      .post('/v1/judge')
      .send({
        type: 'oj',
        language: 'cpp',
        source: '// code',
        testcases,
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        callback: { finish: 'http://test/f' },
        judgeMode: 'standard',
      })
      .expect(400);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  // ── IPv6 SSRF 防护 ──

  it('POST /v1/judge botzone callback 使用 IPv6 loopback [::1] → 400', async () => {
    await request(app.getHttpServer())
      .post('/v1/judge')
      .send({
        type: 'botzone',
        game: {
          judger: { language: 'cpp', source: '// ok', limit: { time: 1000, memory: 256 } },
        },
        callback: { update: 'http://[::1]/u', finish: 'http://[::1]/f' },
      })
      .expect(400);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('POST /v1/judge botzone callback 使用 IPv6 link-local → 400', async () => {
    await request(app.getHttpServer())
      .post('/v1/judge')
      .send({
        type: 'botzone',
        game: {
          judger: { language: 'cpp', source: '// ok', limit: { time: 1000, memory: 256 } },
        },
        callback: { update: 'http://[fe80::1]/u', finish: 'http://[fe80::1]/f' },
      })
      .expect(400);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('POST /v1/judge botzone callback 使用 IPv6 unique local (fd) → 400', async () => {
    await request(app.getHttpServer())
      .post('/v1/judge')
      .send({
        type: 'botzone',
        game: {
          judger: { language: 'cpp', source: '// ok', limit: { time: 1000, memory: 256 } },
        },
        callback: { update: 'http://[fd00::1]/u', finish: 'http://[fd00::1]/f' },
      })
      .expect(400);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  // ── OJ checker 验证 ──

  it('POST /v1/judge OJ checker 模式缺少 checkerSource → 400', async () => {
    await request(app.getHttpServer())
      .post('/v1/judge')
      .send({
        type: 'oj',
        language: 'cpp',
        source: '// code',
        testcases: [{ id: 1, input: '1', expectedOutput: '1' }],
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        callback: { finish: 'http://test/f' },
        judgeMode: 'checker',
        checkerLanguage: 'cpp',
      })
      .expect(400);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('POST /v1/judge OJ checker 模式缺少 checkerLanguage → 400', async () => {
    await request(app.getHttpServer())
      .post('/v1/judge')
      .send({
        type: 'oj',
        language: 'cpp',
        source: '// code',
        testcases: [{ id: 1, input: '1', expectedOutput: '1' }],
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        callback: { finish: 'http://test/f' },
        judgeMode: 'checker',
        checkerSource: '#include "testlib.h"\nint main() { return 0; }',
      })
      .expect(400);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  // ── Botzone runMode ──

  it('POST /v1/judge botzone longrun 模式 → 202', async () => {
    const body = {
      type: 'botzone',
      game: {
        judger: { language: 'cpp', source: '// judge', limit: { time: 3000, memory: 256 } },
        '0': { language: 'cpp', source: '// bot', limit: { time: 1000, memory: 128 } },
      },
      callback: { update: 'http://test/u', finish: 'http://test/f' },
      runMode: 'longrun',
    };

    const res = await request(app.getHttpServer()).post('/v1/judge').send(body).expect(202);

    expect(res.body.jobId).toBe('test-job-1');
    expect(mockEnqueue).toHaveBeenCalledWith({
      type: 'botzone',
      task: expect.objectContaining({ runMode: 'longrun' }),
    });
  });
});
