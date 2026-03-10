import { JudgeProgramRunner } from './judge-program.runner';
import { CompiledBot } from '../../domain/bot';
import * as child_process from 'child_process';
import { EventEmitter } from 'events';
import { ChildProcess } from 'child_process';

jest.mock('child_process');

function createMockChild(): ChildProcess {
  const emitter = new EventEmitter();
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const stdin = Object.assign(new EventEmitter(), {
    write: jest.fn().mockReturnValue(true),
    end: jest.fn(),
  });
  return Object.assign(emitter, {
    stdout,
    stderr,
    stdin,
    kill: jest.fn().mockReturnValue(true),
    pid: 12345,
  }) as unknown as ChildProcess;
}

const compiledBot: CompiledBot = {
  cmd: '/usr/bin/python3',
  args: ['/cache/abc/judge.py'],
  language: 'python',
  readonlyMounts: [],
};

describe('JudgeProgramRunner', () => {
  const mockSpawn = child_process.spawn as jest.MockedFunction<typeof child_process.spawn>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('runRound – happy path', () => {
    it('spawns a process on the first call and sends round 1 with empty responses', async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);

      const writeImpl = (child.stdin as unknown as { write: jest.Mock }).write;
      writeImpl.mockImplementation(() => {
        process.nextTick(() => {
          child.stdout!.emit(
            'data',
            Buffer.from(
              JSON.stringify({
                commands: { '0': { round: 1 } },
                verdict: 'continue',
                debug: 'init',
              }) + '\n',
            ),
          );
        });
        return true;
      });

      const runner = new JudgeProgramRunner(compiledBot, '/tmp/work', 2000);
      const result = await runner.runRound(1, {});

      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(result.verdict).toBe('continue');
      expect(result.commands).toEqual({ '0': { round: 1 } });
      expect(result.debug).toBe('init');

      const writtenInput = JSON.parse(writeImpl.mock.calls[0][0].trim());
      expect(writtenInput).toEqual({ round: 1, responses: {} });

      await runner.cleanup();
    });

    it('reuses the process on subsequent rounds', async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);

      const makeResponse = (verdict: string, extra: object = {}) =>
        Buffer.from(JSON.stringify({ commands: {}, display: {}, verdict, ...extra }) + '\n');

      let callCount = 0;
      (child.stdin as unknown as { write: jest.Mock }).write.mockImplementation(() => {
        callCount++;
        process.nextTick(() => {
          if (callCount === 1) {
            child.stdout!.emit('data', makeResponse('continue'));
          } else {
            child.stdout!.emit('data', makeResponse('finish', { scores: { '0': 1, '1': 0 } }));
          }
        });
        return true;
      });

      const runner = new JudgeProgramRunner(compiledBot, '/tmp/work', 2000);
      await runner.runRound(1, {});
      const r2 = await runner.runRound(2, { '0': 42, '1': 87 });

      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(r2.verdict).toBe('finish');
      expect(r2.scores).toEqual({ '0': 1, '1': 0 });

      await runner.cleanup();
    });

    it('attaches stderr collected between rounds', async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);

      (child.stdin as unknown as { write: jest.Mock }).write.mockImplementation(() => {
        // Emit stderr first, then stdout
        process.nextTick(() => {
          child.stderr!.emit('data', Buffer.from('debug log line\n'));
          child.stdout!.emit(
            'data',
            Buffer.from(JSON.stringify({ commands: {}, verdict: 'continue' }) + '\n'),
          );
        });
        return true;
      });

      const runner = new JudgeProgramRunner(compiledBot, '/tmp/work', 2000);
      const result = await runner.runRound(1, {});

      expect(result.stderr).toBe('debug log line');
      await runner.cleanup();
    });
  });

  describe('runRound – error handling', () => {
    it('returns error verdict when the judge outputs invalid JSON', async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);

      (child.stdin as unknown as { write: jest.Mock }).write.mockImplementation(() => {
        process.nextTick(() => {
          child.stdout!.emit('data', Buffer.from('not json at all\n'));
        });
        return true;
      });

      const runner = new JudgeProgramRunner(compiledBot, '/tmp/work', 2000);
      const result = await runner.runRound(1, {});

      expect(result.verdict).toBe('error');
      expect(result.error).toMatch(/not valid JSON/);
      await runner.cleanup();
    });

    it('returns error verdict when the judge outputs an unknown verdict', async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);

      (child.stdin as unknown as { write: jest.Mock }).write.mockImplementation(() => {
        process.nextTick(() => {
          child.stdout!.emit(
            'data',
            Buffer.from(JSON.stringify({ commands: {}, verdict: 'unknown' }) + '\n'),
          );
        });
        return true;
      });

      const runner = new JudgeProgramRunner(compiledBot, '/tmp/work', 2000);
      const result = await runner.runRound(1, {});

      expect(result.verdict).toBe('error');
      expect(result.error).toMatch(/unknown verdict/);
      await runner.cleanup();
    });

    it('returns error verdict on timeout', async () => {
      jest.useFakeTimers();
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);

      // Process never writes to stdout
      (child.stdin as unknown as { write: jest.Mock }).write.mockReturnValue(true);

      const runner = new JudgeProgramRunner(compiledBot, '/tmp/work', 1000);
      const promise = runner.runRound(1, {});
      jest.advanceTimersByTime(1001);
      const result = await promise;

      expect(result.verdict).toBe('error');
      expect(result.error).toMatch(/TLE/);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');

      jest.useRealTimers();
      await runner.cleanup();
    });

    it('returns error verdict on buffer overflow (OLE)', async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);

      (child.stdin as unknown as { write: jest.Mock }).write.mockImplementation(() => {
        process.nextTick(() => {
          // Emit more than 1 MB without a newline
          child.stdout!.emit('data', Buffer.alloc(1024 * 1024 + 1, 'X'));
        });
        return true;
      });

      const runner = new JudgeProgramRunner(compiledBot, '/tmp/work', 2000);
      const result = await runner.runRound(1, {});

      expect(result.verdict).toBe('error');
      expect(result.error).toMatch(/OLE/);
      await runner.cleanup();
    });

    it('returns error verdict when process has already exited', async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);

      (child.stdin as unknown as { write: jest.Mock }).write.mockImplementation(() => {
        process.nextTick(() => {
          child.stdout!.emit(
            'data',
            Buffer.from(JSON.stringify({ commands: {}, verdict: 'continue' }) + '\n'),
          );
        });
        return true;
      });

      const runner = new JudgeProgramRunner(compiledBot, '/tmp/work', 2000);
      await runner.runRound(1, {});

      // Simulate process exit
      child.emit('exit', 1);

      const result = await runner.runRound(2, {});
      expect(result.verdict).toBe('error');
      await runner.cleanup();
    });

    it('returns error verdict when EPIPE is thrown writing to stdin', async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);

      (child.stdin as unknown as { write: jest.Mock }).write.mockImplementation(() => {
        throw new Error('EPIPE');
      });

      const runner = new JudgeProgramRunner(compiledBot, '/tmp/work', 2000);
      const result = await runner.runRound(1, {});

      expect(result.verdict).toBe('error');
      expect(result.error).toMatch(/EPIPE/);
      await runner.cleanup();
    });
  });

  describe('cleanup', () => {
    it('kills the process and clears state', async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);

      (child.stdin as unknown as { write: jest.Mock }).write.mockImplementation(() => {
        process.nextTick(() => {
          child.stdout!.emit(
            'data',
            Buffer.from(JSON.stringify({ commands: {}, verdict: 'continue' }) + '\n'),
          );
        });
        return true;
      });

      const runner = new JudgeProgramRunner(compiledBot, '/tmp/work', 2000);
      await runner.runRound(1, {});
      await runner.cleanup();

      expect(child.kill).toHaveBeenCalledWith('SIGKILL');

      // After cleanup, runRound should spawn a fresh process
      mockSpawn.mockReturnValueOnce(createMockChild());
    });

    it('is safe to call without a running process', async () => {
      const runner = new JudgeProgramRunner(compiledBot, '/tmp/work', 2000);
      await expect(runner.cleanup()).resolves.toBeUndefined();
    });
  });
});
