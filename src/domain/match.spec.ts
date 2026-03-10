import { Match, MatchTask } from './match';
import { Verdict } from './verdict';

describe('Match', () => {
  const task: MatchTask = {
    type: 'botzone',
    bots: [
      { id: 'judger', language: 'cpp', source: '', limit: { timeMs: 1000, memoryMb: 256 } },
      { id: '0', language: 'cpp', source: '', limit: { timeMs: 1000, memoryMb: 256 } },
      { id: '1', language: 'cpp', source: '', limit: { timeMs: 1000, memoryMb: 256 } },
    ],
    callback: { update: 'http://test/update', finish: 'http://test/finish' },
    runMode: 'restart',
  };

  it('初始状态：轮次为 0，未结束', () => {
    const match = new Match(task);
    expect(match.currentRound).toBe(0);
    expect(match.isFinished).toBe(false);
    expect(match.hasRoundsLeft).toBe(true);
  });

  it('nextRound 推进轮次', () => {
    const match = new Match(task);
    expect(match.nextRound()).toBe(1);
    expect(match.nextRound()).toBe(2);
    expect(match.currentRound).toBe(2);
  });

  it('超过最大轮次抛异常', () => {
    const match = new Match(task, 2);
    match.nextRound();
    match.nextRound();
    expect(match.hasRoundsLeft).toBe(false);
    expect(() => match.nextRound()).toThrow('超过最大轮次限制');
  });

  it('addLog 记录日志', () => {
    const match = new Match(task);
    match.addLog({ round: 1, data: 'test' });
    match.addLog({ round: 2, data: 'test2' });

    const result = match.finish({ '0': 1, '1': 0 }, [
      { botId: '0', verdict: Verdict.OK },
      { botId: '1', verdict: Verdict.OK },
    ]);

    expect(result.log).toHaveLength(2);
  });

  it('finish 返回完整结果并标记结束', () => {
    const match = new Match(task);
    match.addLog({ test: true });

    const result = match.finish(
      { '0': 1, '1': 0 },
      [
        { botId: 'judger', verdict: Verdict.OK },
        { botId: '0', verdict: Verdict.OK },
        { botId: '1', verdict: Verdict.OK },
      ],
    );

    expect(match.isFinished).toBe(true);
    expect(result.scores).toEqual({ '0': 1, '1': 0 });
    expect(result.compiles).toHaveLength(3);
    expect(result.log).toHaveLength(1);
  });

  it('finish 返回的 log 是副本', () => {
    const match = new Match(task);
    match.addLog({ a: 1 });
    const result = match.finish({ '0': 0 }, []);
    match.addLog({ b: 2 }); // 不应影响已返回的结果
    expect(result.log).toHaveLength(1);
  });
});
