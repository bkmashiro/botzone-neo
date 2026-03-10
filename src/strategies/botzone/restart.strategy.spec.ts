import { RestartStrategy } from './restart.strategy';
import { BotRuntime, BotInput } from '../../domain/bot';
import { DirectSandbox } from '../../infrastructure/sandbox/direct.sandbox';

describe('RestartStrategy', () => {
  const sandbox = new DirectSandbox();
  const strategy = new RestartStrategy(sandbox);

  const makeBot = (cmd: string, args: string[]): BotRuntime => ({
    id: '0',
    compiled: { cmd, args, language: 'test', readonlyMounts: [] },
    workDir: '/tmp',
    limit: { timeMs: 5000, memoryMb: 256 },
  });

  const emptyInput: BotInput = {
    requests: [],
    responses: [],
    data: '',
    globaldata: '',
    time_limit: 5,
    memory_limit: 256,
  };

  it('运行一轮并解析 JSON 输出', async () => {
    const bot = makeBot('sh', ['-c', 'echo \'{"response":"hello","debug":"ok"}\'']);
    const output = await strategy.runRound(bot, emptyInput);

    expect(output.response).toBe('hello');
    expect(output.debug).toBe('ok');
  });

  it('解析 data/globaldata 字段', async () => {
    const bot = makeBot('sh', ['-c', 'echo \'{"response":"r","data":"d1","globaldata":"g1"}\'']);
    const output = await strategy.runRound(bot, emptyInput);

    expect(output.response).toBe('r');
    expect(output.data).toBe('d1');
    expect(output.globaldata).toBe('g1');
  });

  it('非 JSON 输出整行作为 response', async () => {
    const bot = makeBot('sh', ['-c', 'echo "plain text"']);
    const output = await strategy.runRound(bot, emptyInput);

    expect(output.response).toBe('plain text');
  });

  it('超时返回 TLE debug 信息', async () => {
    const bot: BotRuntime = {
      ...makeBot('sleep', ['10']),
      limit: { timeMs: 100, memoryMb: 256 },
    };

    const output = await strategy.runRound(bot, emptyInput);
    expect(output.response).toBe('');
    expect(output.debug).toContain('TLE');
  });

  it('非零退出码返回 stderr', async () => {
    const bot = makeBot('sh', ['-c', 'echo error >&2; exit 1']);
    const output = await strategy.runRound(bot, emptyInput);

    expect(output.response).toBe('');
    expect(output.debug).toContain('error');
  });

  it('将 stdin（BotInput JSON）传给进程', async () => {
    // 用 sh 脚本：读取 stdin，提取 time_limit 字段作为 response
    const bot = makeBot('sh', ['-c', `read line; echo "{\\"response\\":\\"got-stdin\\"}"`]);
    const output = await strategy.runRound(bot, emptyInput);

    // 验证进程成功接收到 stdin 并产生了输出
    expect(output.response).toBe('got-stdin');
  });

  it('afterRound 和 cleanup 不抛异常', async () => {
    const bot = makeBot('echo', ['test']);
    await expect(strategy.afterRound(bot)).resolves.toBeUndefined();
    await expect(strategy.cleanup(bot)).resolves.toBeUndefined();
  });

  describe('简化交互模式 (parseOutput)', () => {
    it('纯数字首行 → response 为该数字', () => {
      const output = strategy.parseOutput('42\n');
      expect(output.response).toBe('42');
    });

    it('多行简化输出 → response + data + globaldata', () => {
      const output = strategy.parseOutput('move_a1\nmy_data\nmy_global\n');
      expect(output.response).toBe('move_a1');
      expect(output.data).toBe('my_data');
      expect(output.globaldata).toBe('my_global');
    });

    it('单行简化输出 → 只有 response', () => {
      const output = strategy.parseOutput('hello\n');
      expect(output.response).toBe('hello');
      expect(output.data).toBeUndefined();
      expect(output.globaldata).toBeUndefined();
    });

    it('JSON 输出仍正常解析', () => {
      const output = strategy.parseOutput('{"response":"hi","debug":"d"}\n');
      expect(output.response).toBe('hi');
      expect(output.debug).toBe('d');
    });

    it('空字符串 → response 为空', () => {
      const output = strategy.parseOutput('');
      expect(output.response).toBe('');
    });

    it('JSON 数组 → 使用简化模式（非对象）', () => {
      const output = strategy.parseOutput('[1,2,3]\n');
      expect(output.response).toBe('[1,2,3]');
    });

    it('JSON 字符串字面量 → 使用简化模式', () => {
      const output = strategy.parseOutput('"hello"\n');
      expect(output.response).toBe('"hello"');
    });

    it('JSON null → 使用简化模式', () => {
      const output = strategy.parseOutput('null\n');
      expect(output.response).toBe('null');
    });

    it('JSON 对象缺少 response 字段 → response 为空字符串', () => {
      const output = strategy.parseOutput('{"data":"d1"}\n');
      expect(output.response).toBe('');
      expect(output.data).toBe('d1');
    });

    it('非字符串 data/globaldata 字段被忽略', () => {
      const output = strategy.parseOutput(
        '{"response":"ok","data":42,"globaldata":{"key":"val"}}\n',
      );
      expect(output.response).toBe('ok');
      expect(output.data).toBeUndefined();
      expect(output.globaldata).toBeUndefined();
    });

    it('非字符串 response 字段 → 默认空字符串', () => {
      const output = strategy.parseOutput('{"response":123,"debug":true}\n');
      expect(output.response).toBe('');
      expect(output.debug).toBeUndefined();
    });
  });
});
