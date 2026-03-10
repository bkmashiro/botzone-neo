import { Match, MatchTask, MatchState, MAX_ROUNDS } from './match';
import { Verdict } from './verdict';

const makeTask = (): MatchTask => ({
  type: 'botzone',
  bots: [
    { id: 'judger', language: 'cpp', source: '', limit: { timeMs: 1000, memoryMb: 256 } },
    { id: '0', language: 'cpp', source: '', limit: { timeMs: 1000, memoryMb: 256 } },
    { id: '1', language: 'cpp', source: '', limit: { timeMs: 1000, memoryMb: 256 } },
  ],
  callback: { update: 'http://cb/update', finish: 'http://cb/finish' },
  runMode: 'restart',
});

describe('Match', () => {
  it('should start at round 0', () => {
    const match = new Match(makeTask());
    expect(match.currentRound).toBe(0);
    expect(match.hasRoundsLeft).toBe(true);
    expect(match.isFinished).toBe(false);
  });

  it('should advance rounds', () => {
    const match = new Match(makeTask());
    expect(match.nextRound()).toBe(1);
    expect(match.nextRound()).toBe(2);
    expect(match.currentRound).toBe(2);
  });

  it('should respect max rounds', () => {
    const match = new Match(makeTask(), 2);
    match.nextRound();
    match.nextRound();
    expect(match.hasRoundsLeft).toBe(false);
    expect(() => match.nextRound()).toThrow('超过最大轮次限制');
  });

  it('should collect logs and produce result', () => {
    const match = new Match(makeTask());
    match.nextRound();
    match.addLog({ round: 1, data: 'test' });

    const result = match.finish(
      { '0': 1, '1': 0 },
      [
        { botId: 'judger', verdict: Verdict.OK },
        { botId: '0', verdict: Verdict.OK },
        { botId: '1', verdict: Verdict.OK },
      ],
    );

    expect(result.scores).toEqual({ '0': 1, '1': 0 });
    expect(result.log).toHaveLength(1);
    expect(result.compiles).toHaveLength(3);
    expect(match.isFinished).toBe(true);
  });

  it('MAX_ROUNDS should be 1000', () => {
    expect(MAX_ROUNDS).toBe(1000);
  });

  it('状态机：Pending → Running → Finished', () => {
    const match = new Match(makeTask());
    expect(match.state).toBe(MatchState.PENDING);

    match.nextRound();
    expect(match.state).toBe(MatchState.RUNNING);

    match.finish({ '0': 1 }, []);
    expect(match.state).toBe(MatchState.FINISHED);
  });

  it('已结束的对局不能推进轮次', () => {
    const match = new Match(makeTask());
    match.nextRound();
    match.finish({ '0': 0 }, []);

    expect(() => match.nextRound()).toThrow('对局已结束');
  });

  it('不能重复结束对局', () => {
    const match = new Match(makeTask());
    match.nextRound();
    match.finish({ '0': 0 }, []);

    expect(() => match.finish({ '0': 0 }, [])).toThrow('对局已结束');
  });
});
