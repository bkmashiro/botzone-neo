import { LongrunStrategy } from './longrun.strategy';
import { BotRuntime, BotInput } from '../../domain/bot';

describe('LongrunStrategy (strategies/botzone)', () => {
  let strategy: LongrunStrategy;

  const mockBot: BotRuntime = {
    id: '0',
    compiled: {
      cmd: '/bin/test',
      args: [],
      language: 'cpp',
      readonlyMounts: [],
    },
    workDir: '/tmp/work',
    limit: { timeMs: 1000, memoryMb: 256 },
  };

  const mockInput: BotInput = {
    requests: ['move'],
    responses: [],
    data: '',
    globaldata: '',
    time_limit: 1,
    memory_limit: 256,
  };

  beforeEach(() => {
    strategy = new LongrunStrategy();
  });

  it('should throw "not implemented" from runRound', async () => {
    await expect(strategy.runRound(mockBot, mockInput)).rejects.toThrow(
      'Longrun 策略尚未实现',
    );
  });

  it('should resolve afterRound without error', async () => {
    await expect(strategy.afterRound(mockBot)).resolves.toBeUndefined();
  });

  it('should resolve cleanup without error', async () => {
    await expect(strategy.cleanup(mockBot)).resolves.toBeUndefined();
  });
});
