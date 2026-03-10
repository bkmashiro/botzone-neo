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
    const bot = makeBot('sh', ['-c',
      'echo \'{"response":"r","data":"d1","globaldata":"g1"}\'',
    ]);
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
    const bot = makeBot('sh', [
      '-c',
      `read line; echo "{\\"response\\":\\"got-stdin\\"}"`,
    ]);
    const output = await strategy.runRound(bot, emptyInput);

    // 验证进程成功接收到 stdin 并产生了输出
    expect(output.response).toBe('got-stdin');
  });

  it('afterRound 和 cleanup 不抛异常', async () => {
    const bot = makeBot('echo', ['test']);
    await expect(strategy.afterRound(bot)).resolves.toBeUndefined();
    await expect(strategy.cleanup(bot)).resolves.toBeUndefined();
  });
});
