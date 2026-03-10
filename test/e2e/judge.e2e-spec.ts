import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { JudgeController } from '../../src/judge/judge.controller';
import { JudgeService } from '../../src/judge/judge.service';
import { MatchRunner } from '../../src/judge/match-runner';
import { CompileService } from '../../src/compile/compile.service';
import { CallbackService } from '../../src/callback/callback.service';
import { DataStoreService } from '../../src/data-store/data-store.service';
import { NsjailService } from '../../src/sandbox/nsjail.service';
import { GameResult, JudgeOutput } from '../../src/judge/types';
import * as child_process from 'child_process';
import * as fs from 'fs/promises';
import { EventEmitter } from 'events';
import { Writable } from 'stream';

jest.mock('child_process');
jest.mock('fs/promises');

/** 创建假子进程 */
function createFakeChild(exitCode: number, stdout = '') {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new Writable({
    write(_c: Buffer, _e: string, cb: () => void) { cb(); },
  });
  child.kill = jest.fn();

  setTimeout(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    child.emit('close', exitCode);
  }, 0);

  return child;
}

describe('Judge E2E 测试', () => {
  let app: INestApplication;
  let callbackService: jest.Mocked<CallbackService>;
  let compileService: jest.Mocked<CompileService>;
  const mockSpawn = child_process.spawn as jest.MockedFunction<typeof child_process.spawn>;
  const mockExecSync = child_process.execSync as jest.MockedFunction<typeof child_process.execSync>;

  beforeEach(async () => {
    jest.clearAllMocks();

    // 让 isNsjailAvailable() 返回 false，降级为直接 spawn
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });

    // Mock fs
    (fs.mkdtemp as jest.Mock).mockResolvedValue('/tmp/botzone-e2e');
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
    (fs.rm as jest.Mock).mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [JudgeController],
      providers: [
        {
          provide: JudgeService,
          useFactory: (matchRunner: MatchRunner) => {
            return {
              enqueue: jest.fn(async (task) => {
                await matchRunner.run(task);
                return 'e2e-job-1';
              }),
              getTrustIps: jest.fn().mockReturnValue(['0.0.0.0']),
            };
          },
          inject: [MatchRunner],
        },
        MatchRunner,
        {
          provide: CompileService,
          useValue: {
            compile: jest.fn(),
            getLanguage: jest.fn(),
          },
        },
        {
          provide: CallbackService,
          useValue: {
            update: jest.fn().mockResolvedValue(undefined),
            finish: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: DataStoreService,
          useValue: {
            getData: jest.fn().mockResolvedValue(''),
            setData: jest.fn().mockResolvedValue(undefined),
            getGlobalData: jest.fn().mockResolvedValue(''),
            setGlobalData: jest.fn().mockResolvedValue(undefined),
            clearSessionData: jest.fn(),
          },
        },
        {
          provide: NsjailService,
          useValue: {
            execute: jest.fn(),
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

    callbackService = module.get(CallbackService) as jest.Mocked<CallbackService>;
    compileService = module.get(CompileService) as jest.Mocked<CompileService>;
  });

  afterEach(async () => {
    await app.close();
  });

  it('应该完成一场完整对局并触发 finish 回调', async () => {
    compileService.compile.mockResolvedValue({
      verdict: 'OK',
      execCmd: '/tmp/e2e/main',
      execArgs: [],
    });

    const judgeOutput: JudgeOutput = {
      command: 'finish',
      content: { '0': 1 },
      display: '玩家0获胜',
    };
    // 使用 mockImplementation 而非 mockReturnValue，确保 createFakeChild
    // 在 spawn 实际调用时创建（而非在 HTTP 请求处理前），避免 setTimeout(0) 先于 I/O 触发
    const stdout = JSON.stringify({ response: JSON.stringify(judgeOutput) });
    mockSpawn.mockImplementation(() => createFakeChild(0, stdout) as any);

    const body = {
      game: {
        judger: {
          language: 'cpp',
          source: '// judge',
          limit: { time: 3000, memory: 256 },
        },
        '0': {
          language: 'cpp',
          source: '// bot0',
          limit: { time: 1000, memory: 128 },
        },
      },
      callback: {
        update: 'http://test-server/update',
        finish: 'http://test-server/finish',
      },
    };

    await request(app.getHttpServer())
      .post('/v1/judge')
      .send(body)
      .expect(202);

    expect(callbackService.finish).toHaveBeenCalledTimes(1);

    const [url, result] = callbackService.finish.mock.calls[0];
    expect(url).toBe('http://test-server/finish');

    const gameResult = result as GameResult;
    expect(gameResult.scores).toEqual({ '0': 1 });
    expect(gameResult.compile['judger'].verdict).toBe('OK');
    expect(gameResult.compile['0'].verdict).toBe('OK');
  });

  it('应该在编译失败时返回 CE 结果', async () => {
    // 注意：JS 中 Object.entries 对整数键（'0'）先于字符串键（'judger'）迭代
    compileService.compile
      .mockResolvedValueOnce({ verdict: 'CE', message: '编译错误: undefined reference' })
      .mockResolvedValueOnce({ verdict: 'OK', execCmd: '/tmp/judger', execArgs: [] });

    const body = {
      game: {
        judger: {
          language: 'cpp',
          source: '// judge',
          limit: { time: 3000, memory: 256 },
        },
        '0': {
          language: 'cpp',
          source: '// bad bot',
          limit: { time: 1000, memory: 128 },
        },
      },
      callback: {
        update: 'http://test-server/update',
        finish: 'http://test-server/finish',
      },
    };

    await request(app.getHttpServer())
      .post('/v1/judge')
      .send(body)
      .expect(202);

    expect(callbackService.finish).toHaveBeenCalledTimes(1);
    const result = callbackService.finish.mock.calls[0][1] as GameResult;
    expect(result.compile['0'].verdict).toBe('CE');
    expect(result.scores['0']).toBe(0);
  });

  it('应该在多轮对局中正确传递 bot 回复给裁判', async () => {
    compileService.compile.mockResolvedValue({
      verdict: 'OK',
      execCmd: '/tmp/e2e/main',
      execArgs: [],
    });

    let callCount = 0;
    mockSpawn.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        const out: JudgeOutput = {
          command: 'request',
          content: { '0': '你先走' },
          display: '第一轮',
        };
        return createFakeChild(0, JSON.stringify({ response: JSON.stringify(out) })) as any;
      } else if (callCount === 2) {
        return createFakeChild(0, JSON.stringify({ response: '走E2' })) as any;
      } else {
        const fin: JudgeOutput = {
          command: 'finish',
          content: { '0': 3 },
          display: '结束',
        };
        return createFakeChild(0, JSON.stringify({ response: JSON.stringify(fin) })) as any;
      }
    });

    const body = {
      game: {
        judger: {
          language: 'cpp',
          source: '// j',
          limit: { time: 3000, memory: 256 },
        },
        '0': {
          language: 'python',
          source: '# bot',
          limit: { time: 1000, memory: 128 },
        },
      },
      callback: {
        update: 'http://cb/u',
        finish: 'http://cb/f',
      },
    };

    await request(app.getHttpServer())
      .post('/v1/judge')
      .send(body)
      .expect(202);

    expect(callbackService.finish).toHaveBeenCalledTimes(1);
    const result = callbackService.finish.mock.calls[0][1] as GameResult;
    expect(result.scores['0']).toBe(3);
    expect(callbackService.update).toHaveBeenCalled();
  });

  it('应该拒绝缺少 game 字段的请求', async () => {
    await request(app.getHttpServer())
      .post('/v1/judge')
      .send({ callback: { update: 'a', finish: 'b' } })
      .expect(400);
  });

  it('应该支持 initdata 参数', async () => {
    compileService.compile.mockResolvedValue({
      verdict: 'OK',
      execCmd: '/tmp/e2e/main',
      execArgs: [],
    });

    const judgeOutput: JudgeOutput = {
      command: 'finish',
      content: { '0': 0, '1': 0 },
      display: '平局',
    };
    const initStdout = JSON.stringify({ response: JSON.stringify(judgeOutput) });
    mockSpawn.mockImplementation(() => createFakeChild(0, initStdout) as any);

    const body = {
      game: {
        judger: {
          language: 'cpp',
          source: '// j',
          limit: { time: 3000, memory: 256 },
        },
        '0': {
          language: 'cpp',
          source: '// b0',
          limit: { time: 1000, memory: 128 },
        },
        '1': {
          language: 'python',
          source: '# b1',
          limit: { time: 1000, memory: 128 },
        },
      },
      callback: {
        update: 'http://cb/u',
        finish: 'http://cb/f',
      },
      initdata: { boardSize: 9, komi: 7.5 },
    };

    await request(app.getHttpServer())
      .post('/v1/judge')
      .send(body)
      .expect(202);

    expect(callbackService.finish).toHaveBeenCalledTimes(1);
  });
});
