import { RestartStrategy } from './restart.strategy';
import { BotContext, BotInput, BotOutput } from '../judge/types';
import * as child_process from 'child_process';
import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { Writable } from 'stream';
import { NsjailService } from '../sandbox/nsjail.service';

jest.mock('child_process');

/** 构造一个标准 BotContext */
function makeBotCtx(overrides: Partial<BotContext> = {}): BotContext {
  return {
    id: '0',
    language: 'cpp',
    execCmd: '/usr/bin/echo',
    execArgs: [],
    workDir: '/tmp/bot-test',
    limit: { time: 2000, memory: 256 },
    ...overrides,
  };
}

/** 构造一个标准 BotInput */
function makeBotInput(overrides: Partial<BotInput> = {}): BotInput {
  return {
    requests: ['你好'],
    responses: [],
    data: '',
    globaldata: '',
    time_limit: 2,
    memory_limit: 256,
    ...overrides,
  };
}

/** 创建假子进程 */
function createFakeChild(
  exitCode: number,
  stdout = '',
  stderr = '',
  opts: { delay?: number; hang?: boolean } = {},
) {
  const emitter = new EventEmitter();
  const child = emitter as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: Writable;
    kill: jest.Mock;
    _getStdinData: () => string;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  let stdinData = '';
  child.stdin = new Writable({
    write(chunk: Buffer, _enc: string, cb: () => void) {
      stdinData += chunk.toString();
      cb();
    },
  });
  child.kill = jest.fn();

  // 记录 stdin 数据，方便测试断言
  child._getStdinData = () => stdinData;

  if (!opts.hang) {
    setTimeout(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout));
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.emit('close', exitCode);
    }, opts.delay ?? 0);
  }

  return child as unknown as ChildProcess & { _getStdinData: () => string; kill: jest.Mock };
}

describe('RestartStrategy', () => {
  let strategy: RestartStrategy;
  const mockSpawn = child_process.spawn as jest.MockedFunction<typeof child_process.spawn>;

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new RestartStrategy();
  });

  describe('输入 JSON 格式', () => {
    it('应该将 BotInput 完整序列化为 JSON 写入 stdin', async () => {
      const input = makeBotInput({
        requests: ['请求1', '请求2'],
        responses: ['回复1'],
        data: '持久化数据',
        globaldata: '全局数据',
        time_limit: 3,
        memory_limit: 512,
      });

      const outputJson = JSON.stringify({ response: 'ok' });
      const fakeChild = createFakeChild(0, outputJson);
      mockSpawn.mockReturnValue(fakeChild);

      await strategy.runRound(makeBotCtx(), input);

      // 验证 stdin 写入的 JSON 包含所有必要字段
      const stdinData = JSON.parse(fakeChild._getStdinData());
      expect(stdinData).toHaveProperty('requests', ['请求1', '请求2']);
      expect(stdinData).toHaveProperty('responses', ['回复1']);
      expect(stdinData).toHaveProperty('data', '持久化数据');
      expect(stdinData).toHaveProperty('globaldata', '全局数据');
      expect(stdinData).toHaveProperty('time_limit', 3);
      expect(stdinData).toHaveProperty('memory_limit', 512);
    });

    it('应该使用 botCtx.execCmd/execArgs 启动进程', async () => {
      const outputJson = JSON.stringify({ response: 'test' });
      mockSpawn.mockReturnValue(createFakeChild(0, outputJson));

      await strategy.runRound(makeBotCtx({ execCmd: '/my/bot', execArgs: [] }), makeBotInput());

      expect(mockSpawn).toHaveBeenCalledWith(
        '/my/bot',
        [],
        expect.objectContaining({ cwd: '/tmp/bot-test' }),
      );
    });
  });

  describe('Bot 输出解析', () => {
    it('应该正确解析包含 response/data/globaldata/debug 的 JSON 输出', async () => {
      const botOutput: BotOutput = {
        response: '我的回复',
        debug: '调试信息',
        data: '新数据',
        globaldata: '新全局',
      };
      mockSpawn.mockReturnValue(createFakeChild(0, JSON.stringify(botOutput)));

      const result = await strategy.runRound(makeBotCtx(), makeBotInput());

      expect(result.response).toBe('我的回复');
      expect(result.debug).toBe('调试信息');
      expect(result.data).toBe('新数据');
      expect(result.globaldata).toBe('新全局');
    });

    it('应该在输出不是 JSON 时将整行作为 response', async () => {
      mockSpawn.mockReturnValue(createFakeChild(0, 'plain text response'));

      const result = await strategy.runRound(makeBotCtx(), makeBotInput());

      expect(result.response).toBe('plain text response');
    });

    it('应该只解析第一行输出', async () => {
      const line1 = JSON.stringify({ response: '第一行' });
      const multiLine = `${line1}\n这是第二行\n这是第三行`;
      mockSpawn.mockReturnValue(createFakeChild(0, multiLine));

      const result = await strategy.runRound(makeBotCtx(), makeBotInput());

      expect(result.response).toBe('第一行');
    });
  });

  describe('超时处理', () => {
    it('应该在超过时间限制时返回 TLE 信息', async () => {
      // 创建一个会一直挂起的进程
      const fakeChild = createFakeChild(0, '', '', { hang: true });
      mockSpawn.mockReturnValue(fakeChild);

      const ctx = makeBotCtx({ limit: { time: 50, memory: 256 } });

      const result = await strategy.runRound(ctx, makeBotInput());

      expect(result.response).toBe('');
      expect(result.debug).toContain('TLE');
      expect(fakeChild.kill).toHaveBeenCalledWith('SIGKILL');
    });
  });

  describe('异常退出处理', () => {
    it('应该在进程非零退出时返回 stderr 作为 debug', async () => {
      mockSpawn.mockReturnValue(createFakeChild(1, '', '段错误 (core dumped)'));

      const result = await strategy.runRound(makeBotCtx(), makeBotInput());

      expect(result.response).toBe('');
      expect(result.debug).toContain('段错误');
    });

    it('应该在 stderr 为空时返回退出码信息', async () => {
      mockSpawn.mockReturnValue(createFakeChild(139, '', ''));

      const result = await strategy.runRound(makeBotCtx(), makeBotInput());

      expect(result.response).toBe('');
      expect(result.debug).toContain('code=139');
    });
  });

  describe('spawn 错误处理', () => {
    it('应该在 spawn error 时返回 SE verdict', async () => {
      const fakeChild = createFakeChild(0, '', '', { hang: true });
      mockSpawn.mockReturnValue(fakeChild);

      const promise = strategy.runRound(makeBotCtx(), makeBotInput());

      // Emit error on the child process
      fakeChild.emit('error', new Error('spawn ENOENT'));

      const result = await promise;
      expect(result.response).toBe('');
      expect(result.verdict).toBe('SE');
      expect(result.debug).toContain('spawn ENOENT');
    });
  });

  describe('nsjail 模式', () => {
    it('应该通过 nsjail 执行并解析正常输出', async () => {
      const mockNsjail = {
        execute: jest.fn().mockResolvedValue({
          stdout: JSON.stringify({ response: 'nsjail-ok' }),
          stderr: '',
          exitCode: 0,
          timedOut: false,
        }),
      };

      // Mock child_process.execSync to make nsjail "available"
      const cp = jest.requireActual('child_process');
      jest.spyOn(cp, 'execSync').mockReturnValue(Buffer.from('/usr/bin/nsjail'));

      const nsjailStrategy = new RestartStrategy(mockNsjail as unknown as NsjailService);

      const result = await nsjailStrategy.runRound(makeBotCtx(), makeBotInput());
      expect(result.response).toBe('nsjail-ok');
    });

    it('应该在 nsjail 超时时返回 TLE', async () => {
      const mockNsjail = {
        execute: jest.fn().mockResolvedValue({
          stdout: '',
          stderr: '',
          exitCode: -1,
          timedOut: true,
        }),
      };

      const cp = jest.requireActual('child_process');
      jest.spyOn(cp, 'execSync').mockReturnValue(Buffer.from('/usr/bin/nsjail'));

      const nsjailStrategy = new RestartStrategy(mockNsjail as unknown as NsjailService);

      const result = await nsjailStrategy.runRound(makeBotCtx(), makeBotInput());
      expect(result.verdict).toBe('TLE');
      expect(result.debug).toContain('TLE');
    });

    it('应该在 nsjail 非零退出时返回 RE', async () => {
      const mockNsjail = {
        execute: jest.fn().mockResolvedValue({
          stdout: '',
          stderr: 'segfault',
          exitCode: 139,
          timedOut: false,
        }),
      };

      const cp = jest.requireActual('child_process');
      jest.spyOn(cp, 'execSync').mockReturnValue(Buffer.from('/usr/bin/nsjail'));

      const nsjailStrategy = new RestartStrategy(mockNsjail as unknown as NsjailService);

      const result = await nsjailStrategy.runRound(makeBotCtx(), makeBotInput());
      expect(result.verdict).toBe('RE');
      expect(result.debug).toContain('segfault');
    });
  });

  describe('生命周期方法', () => {
    it('afterRound 应该正常执行不抛异常', async () => {
      await expect(strategy.afterRound(makeBotCtx())).resolves.toBeUndefined();
    });

    it('cleanup 应该正常执行不抛异常', async () => {
      await expect(strategy.cleanup(makeBotCtx())).resolves.toBeUndefined();
    });
  });
});
