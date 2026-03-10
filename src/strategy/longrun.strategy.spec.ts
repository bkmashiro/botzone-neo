import { LongrunStrategy } from './longrun.strategy';

describe('LongrunStrategy (src/strategy)', () => {
  let strategy: LongrunStrategy;

  const mockBotCtx = {
    id: '0',
    language: 'cpp',
    execCmd: '/bin/test',
    execArgs: [],
    workDir: '/tmp/work',
    limit: { time: 1000, memory: 256 },
  };

  const mockInput = {
    requests: ['req1'],
    responses: [],
    data: '',
    globaldata: '',
    time_limit: 1,
    memory_limit: 256,
  };

  beforeEach(() => {
    strategy = new LongrunStrategy();
  });

  it('should return empty response from runRound (skeleton)', async () => {
    const output = await strategy.runRound(mockBotCtx, mockInput);
    expect(output).toEqual({ response: '' });
  });

  it('should resolve afterRound without error', async () => {
    await expect(strategy.afterRound(mockBotCtx)).resolves.toBeUndefined();
  });

  it('should resolve cleanup without error', async () => {
    await expect(strategy.cleanup(mockBotCtx)).resolves.toBeUndefined();
  });
});
