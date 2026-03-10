import { RunMatchUseCase } from './run-match.usecase';
import { MatchTask } from '../domain/match';
import { CompiledBot } from '../domain/bot';
import { Verdict, CompileError } from '../domain/verdict';

jest.mock('fs/promises');
jest.mock('os');
jest.mock('child_process');

import * as fs from 'fs/promises';
import * as os from 'os';
import * as child_process from 'child_process';

describe('RunMatchUseCase', () => {
  // ── Mocks ──────────────────────────────────────────────

  const mockCompileService = { compile: jest.fn() };
  const mockCallbackService = { finish: jest.fn(), update: jest.fn() };
  const mockDataStoreService = {
    createSession: jest.fn().mockReturnValue({
      getData: jest.fn().mockReturnValue(''),
      setData: jest.fn(),
      clear: jest.fn(),
    }),
    getGlobalData: jest.fn().mockResolvedValue(''),
    setGlobalData: jest.fn().mockResolvedValue(undefined),
  };
  const mockSandbox = { execute: jest.fn() };
  const mockConfigService = { get: jest.fn().mockReturnValue(300_000) };
  const mockCounter = { inc: jest.fn() };
  const mockHistogram = { observe: jest.fn() };
  const mockGauge = { inc: jest.fn(), dec: jest.fn() };

  let useCase: RunMatchUseCase;

  // ── Default task ───────────────────────────────────────

  const task: MatchTask = {
    type: 'botzone',
    bots: [
      {
        id: 'judger',
        language: 'cpp',
        source: 'judge code',
        limit: { timeMs: 1000, memoryMb: 256 },
      },
      { id: '0', language: 'cpp', source: 'bot code', limit: { timeMs: 1000, memoryMb: 256 } },
    ],
    callback: { update: 'http://update', finish: 'http://finish' },
    runMode: 'restart',
  };

  const compiledBot: CompiledBot = {
    cmd: 'test',
    args: [],
    language: 'cpp',
    readonlyMounts: [],
  };

  // ── Setup / teardown ───────────────────────────────────

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ advanceTimers: true });

    (os.tmpdir as jest.Mock).mockReturnValue('/tmp');
    (fs.mkdtemp as jest.Mock).mockResolvedValue('/tmp/botzone-abc123');
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
    (fs.rm as jest.Mock).mockResolvedValue(undefined);

    mockCallbackService.finish.mockResolvedValue(undefined);
    mockCallbackService.update.mockResolvedValue(undefined);

    useCase = new RunMatchUseCase(
      mockCompileService as never,
      mockCallbackService as never,
      mockDataStoreService as never,
      mockSandbox as never,
      mockConfigService as never,
      mockCounter as never, // judgeRequestsTotal
      mockHistogram as never, // judgeDurationMs
      mockGauge as never, // activeMatches
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── Helpers ────────────────────────────────────────────

  /** Return a sandbox result that mimics a successful program execution. */
  function sandboxOk(stdout: string) {
    return {
      stdout,
      stderr: '',
      exitCode: 0,
      timedOut: false,
    };
  }

  // ── Tests ──────────────────────────────────────────────

  describe('successful match execution', () => {
    it('should compile bots, run rounds, and finish when judge says finish', async () => {
      // Both bots compile successfully
      mockCompileService.compile.mockResolvedValue(compiledBot);

      // Sandbox calls in order:
      // 1. Judge round 1 -> request bot 0 to play
      // 2. Bot 0 responds
      // 3. Judge round 2 -> finish with scores
      mockSandbox.execute
        .mockResolvedValueOnce(
          sandboxOk(
            JSON.stringify({
              response: JSON.stringify({ command: 'request', content: { '0': 'your turn' } }),
            }),
          ),
        )
        .mockResolvedValueOnce(sandboxOk(JSON.stringify({ response: 'my move' })))
        .mockResolvedValueOnce(
          sandboxOk(
            JSON.stringify({
              response: JSON.stringify({ command: 'finish', content: { '0': 1 } }),
            }),
          ),
        );

      await useCase.execute(task);

      // Compile called for both bots
      expect(mockCompileService.compile).toHaveBeenCalledTimes(2);
      expect(mockCompileService.compile).toHaveBeenCalledWith('cpp', 'judge code');
      expect(mockCompileService.compile).toHaveBeenCalledWith('cpp', 'bot code');

      // Callback finish called with correct scores
      expect(mockCallbackService.finish).toHaveBeenCalledTimes(1);
      const finishArgs = mockCallbackService.finish.mock.calls[0];
      expect(finishArgs[0]).toBe('http://finish');
      expect(finishArgs[1].scores).toEqual({ '0': 1 });

      // Callback update called once (after round 1, before finish)
      expect(mockCallbackService.update).toHaveBeenCalledTimes(1);
      expect(mockCallbackService.update).toHaveBeenCalledWith(
        'http://update',
        expect.objectContaining({ round: 1 }),
      );

      // Work directory created and cleaned up
      expect(fs.mkdtemp).toHaveBeenCalled();
      expect(fs.mkdir).toHaveBeenCalledTimes(2); // one per bot
      expect(fs.rm).toHaveBeenCalledWith('/tmp/botzone-abc123', { recursive: true, force: true });
    });
  });

  describe('compile error handling', () => {
    it('should finish immediately with CE when a bot fails to compile', async () => {
      // Judger compiles OK, bot 0 fails
      mockCompileService.compile
        .mockResolvedValueOnce(compiledBot)
        .mockRejectedValueOnce(new CompileError('syntax error'));

      await useCase.execute(task);

      // Sandbox should never be called since compile failed
      expect(mockSandbox.execute).not.toHaveBeenCalled();

      // Callback finish called with CE result
      expect(mockCallbackService.finish).toHaveBeenCalledTimes(1);
      const finishArgs = mockCallbackService.finish.mock.calls[0];
      expect(finishArgs[0]).toBe('http://finish');

      const result = finishArgs[1];
      // Bot 0 gets score 0 (CE), no other player bots
      expect(result.scores).toEqual({ '0': 0 });

      // Compile summaries contain the CE
      const ceSummary = result.compiles.find(
        (c: { botId: string; verdict: Verdict }) => c.verdict === Verdict.CE,
      );
      expect(ceSummary).toBeDefined();
      expect(ceSummary.botId).toBe('0');
      expect(ceSummary.message).toBe('syntax error');
    });

    it('should assign score 1 to non-failing bots and 0 to the failing bot', async () => {
      const multiTask: MatchTask = {
        ...task,
        bots: [
          { id: 'judger', language: 'cpp', source: 'j', limit: { timeMs: 1000, memoryMb: 256 } },
          { id: '0', language: 'cpp', source: 'b0', limit: { timeMs: 1000, memoryMb: 256 } },
          { id: '1', language: 'cpp', source: 'b1', limit: { timeMs: 1000, memoryMb: 256 } },
        ],
      };

      // Judger OK, bot 0 OK, bot 1 CE
      mockCompileService.compile
        .mockResolvedValueOnce(compiledBot)
        .mockResolvedValueOnce(compiledBot)
        .mockRejectedValueOnce(new CompileError('undefined reference'));

      await useCase.execute(multiTask);

      const result = mockCallbackService.finish.mock.calls[0][1];
      expect(result.scores).toEqual({ '0': 1, '1': 0 });
    });

    it('should call finish callback on non-CompileError exceptions (SE)', async () => {
      mockCompileService.compile.mockRejectedValue(new Error('disk full'));

      await useCase.execute(task);

      expect(mockCallbackService.finish).toHaveBeenCalledTimes(1);
      const result = mockCallbackService.finish.mock.calls[0][1];
      expect(result.scores).toEqual({ '0': 0 });
    });
  });

  describe('match timeout handling', () => {
    it('should finish with TLE verdict when match exceeds maxMatchDurationMs', async () => {
      mockCompileService.compile.mockResolvedValue(compiledBot);

      // Judge keeps requesting indefinitely -- sandbox hangs
      mockSandbox.execute.mockImplementation(() => {
        return new Promise((resolve) => {
          // Advance the timer far enough to trigger the timeout
          jest.advanceTimersByTime(300_001);
          resolve(
            sandboxOk(
              JSON.stringify({
                response: JSON.stringify({ command: 'request', content: { '0': 'go' } }),
              }),
            ),
          );
        });
      });

      await useCase.execute(task);

      // Should have finished via the timeout path
      expect(mockCallbackService.finish).toHaveBeenCalledTimes(1);
      const result = mockCallbackService.finish.mock.calls[0][1];
      expect(result.scores).toEqual({ '0': 0 });

      // Metrics should record TLE verdict
      expect(mockCounter.inc).toHaveBeenCalledWith(
        expect.objectContaining({ verdict: Verdict.TLE }),
      );
    });
  });

  describe('strategy creation', () => {
    it('should use RestartStrategy for runMode "restart"', async () => {
      mockCompileService.compile.mockResolvedValue(compiledBot);

      // Simple finish on first judge call
      mockSandbox.execute.mockResolvedValueOnce(
        sandboxOk(
          JSON.stringify({ response: JSON.stringify({ command: 'finish', content: { '0': 1 } }) }),
        ),
      );

      // The fact that sandbox.execute is called proves RestartStrategy is used
      // (LongrunStrategy would throw "not implemented")
      await useCase.execute(task);

      expect(mockSandbox.execute).toHaveBeenCalled();
    });

    it('should use LongrunStrategy for runMode "longrun"', async () => {
      const { EventEmitter } = jest.requireActual<typeof import('events')>('events');
      const mockSpawn = child_process.spawn as jest.MockedFunction<typeof child_process.spawn>;
      mockSpawn.mockImplementation(() => {
        const proc = new EventEmitter();
        Object.assign(proc, {
          stdout: new EventEmitter(),
          stderr: new EventEmitter(),
          stdin: { write: jest.fn(), end: jest.fn(), on: jest.fn() },
          kill: jest.fn(),
          pid: 12345,
        });
        process.nextTick(() => proc.emit('exit', 0));
        return proc as child_process.ChildProcess;
      });

      const longrunTask: MatchTask = { ...task, runMode: 'longrun' };
      mockCompileService.compile.mockResolvedValue(compiledBot);

      await useCase.execute(longrunTask).catch(() => {});

      // Sandbox should NOT have been called (LongrunStrategy spawns directly)
      expect(mockSandbox.execute).not.toHaveBeenCalled();
    });
  });

  describe('metrics', () => {
    it('should increment and decrement activeMatches gauge', async () => {
      mockCompileService.compile.mockResolvedValue(compiledBot);
      mockSandbox.execute.mockResolvedValueOnce(
        sandboxOk(
          JSON.stringify({ response: JSON.stringify({ command: 'finish', content: { '0': 1 } }) }),
        ),
      );

      await useCase.execute(task);

      expect(mockGauge.inc).toHaveBeenCalledTimes(1);
      expect(mockGauge.dec).toHaveBeenCalledTimes(1);
    });

    it('should call judgeRequestsTotal.inc with verdict OK on success', async () => {
      mockCompileService.compile.mockResolvedValue(compiledBot);
      mockSandbox.execute.mockResolvedValueOnce(
        sandboxOk(
          JSON.stringify({ response: JSON.stringify({ command: 'finish', content: { '0': 1 } }) }),
        ),
      );

      await useCase.execute(task);

      expect(mockCounter.inc).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'botzone', verdict: Verdict.OK }),
      );
    });

    it('should call judgeDurationMs.observe on completion', async () => {
      mockCompileService.compile.mockResolvedValue(compiledBot);
      mockSandbox.execute.mockResolvedValueOnce(
        sandboxOk(
          JSON.stringify({ response: JSON.stringify({ command: 'finish', content: { '0': 1 } }) }),
        ),
      );

      await useCase.execute(task);

      expect(mockHistogram.observe).toHaveBeenCalledWith({ type: 'botzone' }, expect.any(Number));
    });

    it('should record CE verdict when a bot fails to compile', async () => {
      mockCompileService.compile
        .mockResolvedValueOnce(compiledBot)
        .mockRejectedValueOnce(new CompileError('syntax error'));

      await useCase.execute(task);

      expect(mockCounter.inc).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'botzone', verdict: Verdict.CE }),
      );
    });

    it('should record SE verdict on unexpected error and still call finish', async () => {
      mockCompileService.compile.mockRejectedValue(new Error('unexpected'));

      await useCase.execute(task);

      expect(mockCounter.inc).toHaveBeenCalledWith(
        expect.objectContaining({ verdict: Verdict.SE }),
      );
      // Gauge should still be decremented even on error
      expect(mockGauge.dec).toHaveBeenCalledTimes(1);
      // Finish callback should be called with SE result
      expect(mockCallbackService.finish).toHaveBeenCalledTimes(1);
    });
  });

  describe('session and data store', () => {
    it('should create a session and clear it in the finally block', async () => {
      const mockSession = {
        getData: jest.fn().mockReturnValue(''),
        setData: jest.fn(),
        clear: jest.fn(),
      };
      mockDataStoreService.createSession.mockReturnValue(mockSession);
      mockCompileService.compile.mockResolvedValue(compiledBot);
      mockSandbox.execute.mockResolvedValueOnce(
        sandboxOk(
          JSON.stringify({ response: JSON.stringify({ command: 'finish', content: { '0': 1 } }) }),
        ),
      );

      await useCase.execute(task);

      expect(mockDataStoreService.createSession).toHaveBeenCalledTimes(1);
      expect(mockSession.clear).toHaveBeenCalledTimes(1);
    });

    it('should update persistent data when bot output includes data/globaldata', async () => {
      const mockSession = {
        getData: jest.fn().mockReturnValue(''),
        setData: jest.fn(),
        clear: jest.fn(),
      };
      mockDataStoreService.createSession.mockReturnValue(mockSession);
      mockCompileService.compile.mockResolvedValue(compiledBot);

      // Judge round 1: request
      mockSandbox.execute.mockResolvedValueOnce(
        sandboxOk(
          JSON.stringify({
            response: JSON.stringify({ command: 'request', content: { '0': 'play' } }),
            data: 'judge-session-data',
            globaldata: 'judge-global-data',
          }),
        ),
      );
      // Bot 0 responds with data
      mockSandbox.execute.mockResolvedValueOnce(
        sandboxOk(
          JSON.stringify({
            response: 'my move',
            data: 'bot-session-data',
            globaldata: 'bot-global-data',
          }),
        ),
      );
      // Judge round 2: finish
      mockSandbox.execute.mockResolvedValueOnce(
        sandboxOk(
          JSON.stringify({
            response: JSON.stringify({ command: 'finish', content: { '0': 1 } }),
          }),
        ),
      );

      await useCase.execute(task);

      // Session data set for both judger and bot
      expect(mockSession.setData).toHaveBeenCalledWith('judger', 'judge-session-data');
      expect(mockSession.setData).toHaveBeenCalledWith('0', 'bot-session-data');

      // Global data set for both
      expect(mockDataStoreService.setGlobalData).toHaveBeenCalledWith(
        'judger',
        'judge-global-data',
      );
      expect(mockDataStoreService.setGlobalData).toHaveBeenCalledWith('0', 'bot-global-data');
    });
  });

  describe('cleanup', () => {
    it('should remove the work directory even when the match fails', async () => {
      mockCompileService.compile.mockRejectedValue(new Error('boom'));

      await useCase.execute(task);

      expect(fs.rm).toHaveBeenCalledWith('/tmp/botzone-abc123', { recursive: true, force: true });
    });

    it('should not throw when work directory cleanup fails', async () => {
      mockCompileService.compile.mockResolvedValue(compiledBot);
      mockSandbox.execute.mockResolvedValueOnce(
        sandboxOk(
          JSON.stringify({ response: JSON.stringify({ command: 'finish', content: { '0': 1 } }) }),
        ),
      );
      (fs.rm as jest.Mock).mockRejectedValue(new Error('ENOENT'));

      // Should not throw despite rm failure
      await expect(useCase.execute(task)).resolves.toBeUndefined();
    });
  });

  describe('judge output edge cases', () => {
    it('should break the loop and finish when judge returns no response', async () => {
      mockCompileService.compile.mockResolvedValue(compiledBot);

      // Judge returns empty stdout -> parsed as { response: '' }
      mockSandbox.execute.mockResolvedValueOnce(sandboxOk(''));

      await useCase.execute(task);

      // Should call finish via the max-rounds-exceeded fallback path
      expect(mockCallbackService.finish).toHaveBeenCalledTimes(1);
      const result = mockCallbackService.finish.mock.calls[0][1];
      expect(result.scores).toEqual({ '0': 0 });
    });

    it('should break when judge output is valid JSON but missing command/content', async () => {
      mockCompileService.compile.mockResolvedValue(compiledBot);

      // Judge returns valid JSON but no command/content
      mockSandbox.execute.mockResolvedValueOnce(
        sandboxOk(JSON.stringify({ response: JSON.stringify({ data: 42 }) })),
      );

      await useCase.execute(task);

      expect(mockCallbackService.finish).toHaveBeenCalledTimes(1);
      const result = mockCallbackService.finish.mock.calls[0][1];
      expect(result.scores).toEqual({ '0': 0 });
    });

    it('should break when no judger bot exists in the task', async () => {
      const noJudgerTask: MatchTask = {
        ...task,
        bots: [
          { id: '0', language: 'cpp', source: 'bot code', limit: { timeMs: 1000, memoryMb: 256 } },
        ],
      };
      mockCompileService.compile.mockResolvedValue(compiledBot);

      await useCase.execute(noJudgerTask);

      expect(mockCallbackService.finish).toHaveBeenCalledTimes(1);
      const result = mockCallbackService.finish.mock.calls[0][1];
      expect(result.scores).toEqual({ '0': 0 });
    });

    it('should break the loop when judge output is not valid JSON', async () => {
      mockCompileService.compile.mockResolvedValue(compiledBot);

      // Judge returns non-JSON response (parsed by RestartStrategy as simplified output)
      mockSandbox.execute.mockResolvedValueOnce(sandboxOk('not valid json at all'));

      await useCase.execute(task);

      // Falls through to the max-rounds fallback since JSON.parse fails
      expect(mockCallbackService.finish).toHaveBeenCalledTimes(1);
    });
  });

  describe('judge command validation', () => {
    it('should reject judge output with invalid command value', async () => {
      mockCompileService.compile.mockResolvedValue(compiledBot);
      mockSandbox.execute.mockResolvedValueOnce(
        sandboxOk(
          JSON.stringify({
            response: JSON.stringify({ command: 'invalid', content: { '0': 'go' } }),
          }),
        ),
      );

      await useCase.execute(task);

      expect(mockCallbackService.finish).toHaveBeenCalledTimes(1);
      const result = mockCallbackService.finish.mock.calls[0][1];
      expect(result.scores).toEqual({ '0': 0 });
    });

    it('should reject judge output with array content instead of object', async () => {
      mockCompileService.compile.mockResolvedValue(compiledBot);
      mockSandbox.execute.mockResolvedValueOnce(
        sandboxOk(
          JSON.stringify({
            response: JSON.stringify({ command: 'request', content: ['item1', 'item2'] }),
          }),
        ),
      );

      await useCase.execute(task);

      expect(mockCallbackService.finish).toHaveBeenCalledTimes(1);
      const result = mockCallbackService.finish.mock.calls[0][1];
      expect(result.scores).toEqual({ '0': 0 });
    });
  });

  describe('callback error handling', () => {
    it('should continue match when update callback fails', async () => {
      mockCompileService.compile.mockResolvedValue(compiledBot);
      mockCallbackService.update.mockRejectedValue(new Error('network error'));

      // Round 1: request bot 0
      mockSandbox.execute
        .mockResolvedValueOnce(
          sandboxOk(
            JSON.stringify({
              response: JSON.stringify({ command: 'request', content: { '0': 'play' } }),
            }),
          ),
        )
        .mockResolvedValueOnce(sandboxOk(JSON.stringify({ response: 'move' })))
        // Round 2: finish
        .mockResolvedValueOnce(
          sandboxOk(
            JSON.stringify({
              response: JSON.stringify({ command: 'finish', content: { '0': 1 } }),
            }),
          ),
        );

      // Should not throw despite update callback failure
      await expect(useCase.execute(task)).resolves.toBeUndefined();

      // Finish callback should still be called
      expect(mockCallbackService.finish).toHaveBeenCalledTimes(1);
      const result = mockCallbackService.finish.mock.calls[0][1];
      expect(result.scores).toEqual({ '0': 1 });
    });
  });
});
