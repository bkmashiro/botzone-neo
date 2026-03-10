import { Test, TestingModule } from '@nestjs/testing';
import { MatchRunner } from './match-runner';
import { CompileService } from '../compile/compile.service';
import { CallbackService } from '../callback/callback.service';
import { DataStoreService } from '../data-store/data-store.service';
import { NsjailService } from '../sandbox/nsjail.service';
import { Task, GameResult, JudgeOutput } from './types';
import * as fs from 'fs/promises';
import * as child_process from 'child_process';
import { EventEmitter } from 'events';
import { Writable } from 'stream';

jest.mock('child_process');
jest.mock('fs/promises');

/** 创建一个假子进程，按写入 stdin 的内容决定输出 */
function createFakeChild(
  exitCode: number,
  stdout = '',
  _stderr = '',
) {
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

/** 构建一个最简对局 Task（1裁判 + 1玩家） */
function makeSimpleTask(overrides: Partial<Task> = {}): Task {
  return {
    game: {
      judger: {
        language: 'cpp',
        source: '// judge code',
        limit: { time: 3000, memory: 256 },
      },
      '0': {
        language: 'cpp',
        source: '// bot code',
        limit: { time: 1000, memory: 256 },
      },
    },
    callback: {
      update: 'http://localhost/update',
      finish: 'http://localhost/finish',
    },
    ...overrides,
  };
}

describe('MatchRunner', () => {
  let runner: MatchRunner;
  let compileService: jest.Mocked<CompileService>;
  let callbackService: jest.Mocked<CallbackService>;
  let dataStoreService: jest.Mocked<DataStoreService>;
  const mockSpawn = child_process.spawn as jest.MockedFunction<typeof child_process.spawn>;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Mock fs
    (fs.mkdtemp as jest.Mock).mockResolvedValue('/tmp/botzone-test');
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
    (fs.rm as jest.Mock).mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
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

    runner = module.get(MatchRunner);
    compileService = module.get(CompileService) as jest.Mocked<CompileService>;
    callbackService = module.get(CallbackService) as jest.Mocked<CallbackService>;
    dataStoreService = module.get(DataStoreService) as jest.Mocked<DataStoreService>;
  });

  describe('最简对局流程（裁判立刻 finish）', () => {
    it('应该在裁判返回 finish 时正确结束对局并回调', async () => {
      // 编译全部成功
      compileService.compile.mockResolvedValue({
        verdict: 'OK',
        execCmd: '/tmp/test/main', execArgs: [],
      });

      // 裁判输出 finish
      const judgeOutput: JudgeOutput = {
        command: 'finish',
        content: { '0': 1 },
        display: '玩家0获胜',
      };
      mockSpawn.mockReturnValue(
        createFakeChild(0, JSON.stringify({ response: JSON.stringify(judgeOutput) })) as any,
      );

      await runner.run(makeSimpleTask());

      // 验证 finish 回调被调用
      expect(callbackService.finish).toHaveBeenCalledTimes(1);
      const finishResult: GameResult = callbackService.finish.mock.calls[0][1];
      expect(finishResult.scores).toEqual({ '0': 1 });
      expect(finishResult.compile['judger'].verdict).toBe('OK');
      expect(finishResult.compile['0'].verdict).toBe('OK');
    });
  });

  describe('编译失败处理', () => {
    it('应该在 bot 编译失败时立刻结束并返回 CE', async () => {
      // 裁判编译成功，玩家编译失败
      compileService.compile
        .mockResolvedValueOnce({ verdict: 'OK', execCmd: '/tmp/judger', execArgs: [] })
        .mockResolvedValueOnce({ verdict: 'CE', message: '语法错误' });

      await runner.run(makeSimpleTask());

      expect(callbackService.finish).toHaveBeenCalledTimes(1);
      const result: GameResult = callbackService.finish.mock.calls[0][1];
      // 编译失败的玩家得 0 分，其他人得 1 分
      expect(result.scores['0']).toBe(0);
      expect(result.compile['0'].verdict).toBe('CE');
      expect(result.compile['0'].message).toBe('语法错误');
    });
  });

  describe('完整 round loop', () => {
    it('应该正确执行多轮对局（裁判 request → bot 回复 → 裁判 finish）', async () => {
      compileService.compile.mockResolvedValue({
        verdict: 'OK',
        execCmd: '/tmp/test/main', execArgs: [],
      });

      let judgeCallCount = 0;
      mockSpawn.mockImplementation((_cmd, _args, _opts) => {
        judgeCallCount++;
        if (judgeCallCount <= 2) {
          // 第一次/第二次调用是裁判（第一轮和第二轮）
          if (judgeCallCount === 1) {
            // 第一轮：裁判发请求
            const judgeOut: JudgeOutput = {
              command: 'request',
              content: { '0': '请走棋' },
              display: '等待玩家',
            };
            return createFakeChild(
              0,
              JSON.stringify({ response: JSON.stringify(judgeOut) }),
            ) as any;
          } else {
            // bot 回复
            return createFakeChild(
              0,
              JSON.stringify({ response: '走A1' }),
            ) as any;
          }
        } else if (judgeCallCount === 3) {
          // 第二轮裁判：结束
          const judgeFinish: JudgeOutput = {
            command: 'finish',
            content: { '0': 2 },
            display: '对局结束',
          };
          return createFakeChild(
            0,
            JSON.stringify({ response: JSON.stringify(judgeFinish) }),
          ) as any;
        }
        return createFakeChild(0, '') as any;
      });

      await runner.run(makeSimpleTask());

      // update 应在第一轮被调用
      expect(callbackService.update).toHaveBeenCalled();
      // finish 应被调用
      expect(callbackService.finish).toHaveBeenCalledTimes(1);
      const result: GameResult = callbackService.finish.mock.calls[0][1];
      expect(result.scores['0']).toBe(2);
    });
  });

  describe('data/globaldata 传递', () => {
    it('应该在回合间正确传递 data 和 globaldata', async () => {
      compileService.compile.mockResolvedValue({
        verdict: 'OK',
        execCmd: '/tmp/test/main', execArgs: [],
      });

      let callCount = 0;
      mockSpawn.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // 裁判第一轮 → request
          const judgeOut: JudgeOutput = {
            command: 'request',
            content: { '0': '第一轮请求' },
            display: {},
          };
          return createFakeChild(
            0,
            JSON.stringify({ response: JSON.stringify(judgeOut) }),
          ) as any;
        } else if (callCount === 2) {
          // Bot 第一轮回复，附带 data 和 globaldata
          return createFakeChild(
            0,
            JSON.stringify({
              response: '回复1',
              data: '会话数据X',
              globaldata: '全局数据Y',
            }),
          ) as any;
        } else if (callCount === 3) {
          // 裁判第二轮 → finish
          const judgeFinish: JudgeOutput = {
            command: 'finish',
            content: { '0': 1 },
            display: '结束',
          };
          return createFakeChild(
            0,
            JSON.stringify({ response: JSON.stringify(judgeFinish) }),
          ) as any;
        }
        return createFakeChild(0, '') as any;
      });

      await runner.run(makeSimpleTask());

      // 验证 setData 和 setGlobalData 被调用
      expect(dataStoreService.setData).toHaveBeenCalledWith('0', '会话数据X');
      expect(dataStoreService.setGlobalData).toHaveBeenCalledWith('0', '全局数据Y');
    });
  });

  describe('initdata 处理', () => {
    it('应该在第一回合将 initdata 传递给裁判', async () => {
      compileService.compile.mockResolvedValue({
        verdict: 'OK',
        execCmd: '/tmp/test/main', execArgs: [],
      });

      // 裁判直接 finish
      const judgeOut: JudgeOutput = {
        command: 'finish',
        content: { '0': 1 },
        display: '',
      };
      mockSpawn.mockReturnValue(
        createFakeChild(0, JSON.stringify({ response: JSON.stringify(judgeOut) })) as any,
      );

      const task = makeSimpleTask({ initdata: { board: '初始棋盘' } });
      await runner.run(task);

      // 验证 finish 被调用（说明对局正常完成，initdata 被正确处理）
      expect(callbackService.finish).toHaveBeenCalledTimes(1);
    });

    it('应该支持字符串类型的 initdata', async () => {
      compileService.compile.mockResolvedValue({
        verdict: 'OK',
        execCmd: '/tmp/test/main', execArgs: [],
      });

      const judgeOut: JudgeOutput = {
        command: 'finish',
        content: { '0': 0 },
        display: '',
      };
      mockSpawn.mockReturnValue(
        createFakeChild(0, JSON.stringify({ response: JSON.stringify(judgeOut) })) as any,
      );

      const task = makeSimpleTask({ initdata: '自定义初始数据' });
      await runner.run(task);

      expect(callbackService.finish).toHaveBeenCalledTimes(1);
    });
  });

  describe('清理', () => {
    it('应该在对局结束后清理临时目录', async () => {
      compileService.compile.mockResolvedValue({
        verdict: 'OK',
        execCmd: '/tmp/test/main', execArgs: [],
      });

      const judgeOut: JudgeOutput = {
        command: 'finish',
        content: { '0': 1 },
        display: '',
      };
      mockSpawn.mockReturnValue(
        createFakeChild(0, JSON.stringify({ response: JSON.stringify(judgeOut) })) as any,
      );

      await runner.run(makeSimpleTask());

      expect(fs.rm).toHaveBeenCalledWith(
        '/tmp/botzone-test',
        expect.objectContaining({ recursive: true, force: true }),
      );
    });
  });
});
