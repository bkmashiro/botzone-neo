import { Test, TestingModule } from '@nestjs/testing';
import { JudgeController } from './judge.controller';
import { JudgeService } from './judge.service';
import { TaskDto } from './dto/task.dto';
import { ValidationPipe, HttpStatus } from '@nestjs/common';
import { INestApplication } from '@nestjs/common';
import { Request } from 'express';
import * as request from 'supertest';

describe('JudgeController', () => {
  let controller: JudgeController;
  let judgeService: jest.Mocked<JudgeService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [JudgeController],
      providers: [
        {
          provide: JudgeService,
          useValue: {
            enqueue: jest.fn().mockResolvedValue('job-123'),
            getTrustIps: jest.fn().mockReturnValue(['127.0.0.1', '0.0.0.0']),
          },
        },
      ],
    }).compile();

    controller = module.get(JudgeController);
    judgeService = module.get(JudgeService) as jest.Mocked<JudgeService>;
  });

  // Mock Request with trusted IP
  const mockReq = {
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as Request;

  describe('submitTask', () => {
    it('应该接受合法 Task 并返回 jobId', async () => {
      const taskDto: TaskDto = {
        game: {
          judger: {
            language: 'cpp',
            source: 'int main() {}',
            limit: { time: 3000, memory: 256 },
          },
          '0': {
            language: 'python',
            source: 'print("hi")',
            limit: { time: 1000, memory: 128 },
          },
        },
        callback: {
          update: 'http://localhost:3000/update',
          finish: 'http://localhost:3000/finish',
        },
      };

      const result = await controller.submitTask(taskDto, mockReq);

      expect(result).toEqual({
        jobId: 'job-123',
        message: '评测任务已入队',
      });
      expect(judgeService.enqueue).toHaveBeenCalledWith(taskDto);
    });

    it('应该将 taskDto 原样传递给 JudgeService.enqueue', async () => {
      const taskDto: TaskDto = {
        game: {
          judger: {
            language: 'typescript',
            source: 'console.log(1)',
            limit: { time: 5000, memory: 512 },
          },
        },
        callback: {
          update: 'http://cb/up',
          finish: 'http://cb/fin',
        },
        runMode: 'restart',
      };

      await controller.submitTask(taskDto, mockReq);

      expect(judgeService.enqueue).toHaveBeenCalledWith(taskDto);
    });

    it('应该支持包含 initdata 的 Task', async () => {
      const taskDto: TaskDto = {
        game: {
          judger: {
            language: 'cpp',
            source: '// j',
            limit: { time: 3000, memory: 256 },
          },
        },
        callback: { update: 'http://u', finish: 'http://f' },
        initdata: { board: [[0, 0], [0, 0]] },
      };

      const result = await controller.submitTask(taskDto, mockReq);

      expect(result.jobId).toBe('job-123');
    });
  });
});

describe('JudgeController (HTTP 集成)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [JudgeController],
      providers: [
        {
          provide: JudgeService,
          useValue: {
            enqueue: jest.fn().mockResolvedValue('job-456'),
            getTrustIps: jest.fn().mockReturnValue(['127.0.0.1', '0.0.0.0']),
          },
        },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      transform: true,
    }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /v1/judge 应该接受合法请求并返回 202', async () => {
    const body = {
      game: {
        judger: {
          language: 'cpp',
          source: 'int main() {}',
          limit: { time: 3000, memory: 256 },
        },
        '0': {
          language: 'python',
          source: 'print(1)',
          limit: { time: 1000, memory: 128 },
        },
      },
      callback: {
        update: 'http://localhost/update',
        finish: 'http://localhost/finish',
      },
    };

    const res = await request(app.getHttpServer())
      .post('/v1/judge')
      .send(body)
      .expect(HttpStatus.ACCEPTED);

    expect(res.body).toHaveProperty('jobId', 'job-456');
    expect(res.body).toHaveProperty('message');
  });

  it('POST /v1/judge 应该在缺少 game 字段时返回 400', async () => {
    const body = {
      callback: {
        update: 'http://localhost/update',
        finish: 'http://localhost/finish',
      },
    };

    await request(app.getHttpServer())
      .post('/v1/judge')
      .send(body)
      .expect(HttpStatus.BAD_REQUEST);
  });

  it('POST /v1/judge 应该在 runMode 值非法时返回 400', async () => {
    const body = {
      game: {
        judger: {
          language: 'cpp',
          source: 'code',
          limit: { time: 3000, memory: 256 },
        },
      },
      callback: {
        update: 'http://localhost/update',
        finish: 'http://localhost/finish',
      },
      runMode: 'invalid_mode',
    };

    await request(app.getHttpServer())
      .post('/v1/judge')
      .send(body)
      .expect(HttpStatus.BAD_REQUEST);
  });

  it('POST /v1/judge 应该接受带 runMode=longrun 的请求', async () => {
    const body = {
      game: {
        judger: {
          language: 'cpp',
          source: 'code',
          limit: { time: 3000, memory: 256 },
        },
      },
      callback: {
        update: 'http://localhost/update',
        finish: 'http://localhost/finish',
      },
      runMode: 'longrun',
    };

    await request(app.getHttpServer())
      .post('/v1/judge')
      .send(body)
      .expect(HttpStatus.ACCEPTED);
  });

  it('POST /v1/judge 应该拒绝空 body', async () => {
    await request(app.getHttpServer())
      .post('/v1/judge')
      .send({})
      .expect(HttpStatus.BAD_REQUEST);
  });
});
