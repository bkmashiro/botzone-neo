import { UserJudgeStrategy } from './user-judge.strategy';
import {
  JudgeProgramRunner,
  JudgeRunnerRoundResult,
} from '../../infrastructure/judge-runner/judge-program.runner';

function makeRunner(results: JudgeRunnerRoundResult[]): jest.Mocked<JudgeProgramRunner> {
  let callCount = 0;
  const runner = {
    runRound: jest
      .fn()
      .mockImplementation(async () => results[callCount++] ?? results[results.length - 1]),
    cleanup: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<JudgeProgramRunner>;
  return runner;
}

describe('UserJudgeStrategy', () => {
  describe('nextRound', () => {
    it('sends empty responses on the first round regardless of caller input', async () => {
      const runner = makeRunner([{ commands: { '0': 'go' }, verdict: 'continue' }]);
      const strategy = new UserJudgeStrategy(runner);

      // Even if caller passes non-empty responses, round 1 must use {}
      await strategy.nextRound({ '0': 99 });

      expect(runner.runRound).toHaveBeenCalledWith(1, {});
    });

    it('passes caller responses from round 2 onwards', async () => {
      const runner = makeRunner([
        { commands: {}, verdict: 'continue' },
        { commands: {}, verdict: 'continue' },
      ]);
      const strategy = new UserJudgeStrategy(runner);

      await strategy.nextRound({});
      await strategy.nextRound({ '0': 42, '1': 7 });

      expect(runner.runRound).toHaveBeenNthCalledWith(2, 2, { '0': 42, '1': 7 });
    });

    it('increments round counter on each call', async () => {
      const runner = makeRunner([
        { commands: {}, verdict: 'continue' },
        { commands: {}, verdict: 'continue' },
        { commands: {}, verdict: 'finish', scores: { '0': 1, '1': 0 } },
      ]);
      const strategy = new UserJudgeStrategy(runner);

      await strategy.nextRound({});
      await strategy.nextRound({ '0': 1 });
      await strategy.nextRound({ '0': 2 });

      expect(runner.runRound).toHaveBeenNthCalledWith(1, 1, {});
      expect(runner.runRound).toHaveBeenNthCalledWith(2, 2, { '0': 1 });
      expect(runner.runRound).toHaveBeenNthCalledWith(3, 3, { '0': 2 });
    });

    it('maps runner "finish" result to IStrategy output with scores', async () => {
      const runner = makeRunner([
        {
          commands: {},
          display: { winner: '0' },
          verdict: 'finish',
          scores: { '0': 1, '1': 0 },
          debug: 'player 0 wins',
        },
      ]);
      const strategy = new UserJudgeStrategy(runner);

      const out = await strategy.nextRound({});

      expect(out.verdict).toBe('finish');
      expect(out.scores).toEqual({ '0': 1, '1': 0 });
      expect(out.display).toEqual({ winner: '0' });
      expect(out.debug).toBe('player 0 wins');
    });

    it('forwards error verdict from the runner', async () => {
      const runner = makeRunner([{ commands: {}, verdict: 'error', error: 'Judge crashed' }]);
      const strategy = new UserJudgeStrategy(runner);

      const out = await strategy.nextRound({});

      expect(out.verdict).toBe('error');
      expect(out.error).toBe('Judge crashed');
    });

    it('forwards stderr from the runner', async () => {
      const runner = makeRunner([
        { commands: { '0': {} }, verdict: 'continue', stderr: 'some debug log' },
      ]);
      const strategy = new UserJudgeStrategy(runner);

      const out = await strategy.nextRound({});

      expect(out.stderr).toBe('some debug log');
    });
  });

  describe('cleanup', () => {
    it('delegates to runner.cleanup', async () => {
      const runner = makeRunner([]);
      const strategy = new UserJudgeStrategy(runner);

      await strategy.cleanup();

      expect(runner.cleanup).toHaveBeenCalledTimes(1);
    });
  });
});
