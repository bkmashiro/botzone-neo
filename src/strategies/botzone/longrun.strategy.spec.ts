import { LongrunStrategy } from './longrun.strategy';
import { BotRuntime, BotInput } from '../../domain/bot';
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
    destroy: jest.fn(),
  });
  const child = Object.assign(emitter, {
    stdout,
    stderr,
    stdin,
    kill: jest.fn().mockReturnValue(true),
    pid: 12345,
  }) as unknown as ChildProcess;
  return child;
}

describe('LongrunStrategy', () => {
  let strategy: LongrunStrategy;
  const mockSpawn = child_process.spawn as jest.MockedFunction<typeof child_process.spawn>;

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
    jest.clearAllMocks();
    strategy = new LongrunStrategy();
  });

  describe('runRound', () => {
    it('should spawn a process on first call and return parsed JSON output', async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);

      // Simulate the process writing output when it receives stdin
      (child.stdin as unknown as { write: jest.Mock }).write.mockImplementation(() => {
        process.nextTick(() => {
          child.stdout!.emit('data', Buffer.from('{"response":"hello"}\n'));
        });
        return true;
      });

      const output = await strategy.runRound(mockBot, mockInput);

      expect(mockSpawn).toHaveBeenCalledWith('/bin/test', [], {
        cwd: '/tmp/work',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      expect(output.response).toBe('hello');
    });

    it('should return plain text output for non-JSON responses', async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);

      (child.stdin as unknown as { write: jest.Mock }).write.mockImplementation(() => {
        process.nextTick(() => {
          child.stdout!.emit('data', Buffer.from('42\n'));
        });
        return true;
      });

      const output = await strategy.runRound(mockBot, mockInput);
      expect(output.response).toBe('42');
    });

    it('should reuse the existing process on subsequent rounds', async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);

      // First round
      (child.stdin as unknown as { write: jest.Mock }).write.mockImplementation(() => {
        process.nextTick(() => {
          child.stdout!.emit('data', Buffer.from('{"response":"r1"}\n'));
        });
        return true;
      });
      await strategy.runRound(mockBot, mockInput);

      // Second round should send SIGCONT, not spawn again
      (child.stdin as unknown as { write: jest.Mock }).write.mockImplementation(() => {
        process.nextTick(() => {
          child.stdout!.emit('data', Buffer.from('{"response":"r2"}\n'));
        });
        return true;
      });
      const output = await strategy.runRound(mockBot, mockInput);

      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(child.kill).toHaveBeenCalledWith('SIGCONT');
      expect(output.response).toBe('r2');
    });

    it('should return TLE when process exceeds time limit', async () => {
      jest.useFakeTimers();
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);

      // Process never responds
      const promise = strategy.runRound(mockBot, mockInput);
      jest.advanceTimersByTime(1000);
      const output = await promise;

      expect(output.response).toBe('');
      expect(output.debug).toContain('TLE');
      jest.useRealTimers();
    });

    it('should handle EPIPE errors gracefully', async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);

      (child.stdin as unknown as { write: jest.Mock }).write.mockImplementation(() => {
        throw new Error('EPIPE');
      });

      const output = await strategy.runRound(mockBot, mockInput);
      expect(output.response).toBe('');
      expect(output.debug).toContain('EPIPE');
    });

    it('should handle spawn error and mark process as exited', async () => {
      jest.useFakeTimers();
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);

      // Spawn error fires asynchronously; runRound waits until timeout
      const promise = strategy.runRound(mockBot, mockInput);
      child.emit('error', new Error('spawn ENOENT'));
      jest.advanceTimersByTime(1000);
      const output = await promise;

      expect(output.response).toBe('');
      expect(output.debug).toContain('TLE');
      jest.useRealTimers();

      // Subsequent round should detect exited process immediately
      const output2 = await strategy.runRound(mockBot, mockInput);
      expect(output2.debug).toContain('进程已退出');
    });

    it('should return error when process has already exited', async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);

      // First round succeeds
      (child.stdin as unknown as { write: jest.Mock }).write.mockImplementation(() => {
        process.nextTick(() => {
          child.stdout!.emit('data', Buffer.from('{"response":"ok"}\n'));
        });
        return true;
      });
      await strategy.runRound(mockBot, mockInput);

      // Process exits
      child.emit('exit', 0);

      // Second round should detect exited process
      const output = await strategy.runRound(mockBot, mockInput);
      expect(output.debug).toContain('进程已退出');
    });
  });

  describe('afterRound', () => {
    it('should send SIGSTOP to pause the process', async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);

      (child.stdin as unknown as { write: jest.Mock }).write.mockImplementation(() => {
        process.nextTick(() => {
          child.stdout!.emit('data', Buffer.from('{"response":"ok"}\n'));
        });
        return true;
      });
      await strategy.runRound(mockBot, mockInput);

      await strategy.afterRound(mockBot);
      expect(child.kill).toHaveBeenCalledWith('SIGSTOP');
    });

    it('should not signal if no process is running', async () => {
      await expect(strategy.afterRound(mockBot)).resolves.toBeUndefined();
    });
  });

  describe('cleanup', () => {
    it('should send SIGKILL and release the process reference', async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);

      (child.stdin as unknown as { write: jest.Mock }).write.mockImplementation(() => {
        process.nextTick(() => {
          child.stdout!.emit('data', Buffer.from('{"response":"ok"}\n'));
        });
        return true;
      });
      await strategy.runRound(mockBot, mockInput);

      await strategy.cleanup(mockBot);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('should be safe to call without a running process', async () => {
      await expect(strategy.cleanup(mockBot)).resolves.toBeUndefined();
    });
  });

  describe('signal failure', () => {
    it('should handle kill() throwing (process already dead)', async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);

      (child.stdin as unknown as { write: jest.Mock }).write.mockImplementation(() => {
        process.nextTick(() => {
          child.stdout!.emit('data', Buffer.from('{"response":"ok"}\n'));
        });
        return true;
      });
      await strategy.runRound(mockBot, mockInput);

      (child.kill as jest.Mock).mockImplementation(() => {
        throw new Error('kill ESRCH');
      });

      await expect(strategy.afterRound(mockBot)).resolves.toBeUndefined();
    });
  });

  describe('stdin non-EPIPE error', () => {
    it('should re-throw non-EPIPE errors from stdin', async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);

      (child.stdin as unknown as { write: jest.Mock }).write.mockImplementation(() => {
        process.nextTick(() => {
          child.stdout!.emit('data', Buffer.from('{"response":"ok"}\n'));
        });
        return true;
      });
      await strategy.runRound(mockBot, mockInput);

      const nonEpipeErr = Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' });
      expect(() => {
        child.stdin!.emit('error', nonEpipeErr);
      }).toThrow('ECONNRESET');
    });

    it('should swallow EPIPE errors from stdin', async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);

      (child.stdin as unknown as { write: jest.Mock }).write.mockImplementation(() => {
        process.nextTick(() => {
          child.stdout!.emit('data', Buffer.from('{"response":"ok"}\n'));
        });
        return true;
      });
      await strategy.runRound(mockBot, mockInput);

      const epipeErr = Object.assign(new Error('EPIPE'), { code: 'EPIPE' });
      expect(() => {
        child.stdin!.emit('error', epipeErr);
      }).not.toThrow();
    });
  });

  describe('buffer overflow', () => {
    it('should return OLE when stdout exceeds MAX_BUFFER_SIZE', async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);

      // Send more than 1MB without a newline
      (child.stdin as unknown as { write: jest.Mock }).write.mockImplementation(() => {
        process.nextTick(() => {
          const bigChunk = Buffer.alloc(1024 * 1024 + 1, 'A');
          child.stdout!.emit('data', bigChunk);
        });
        return true;
      });

      const output = await strategy.runRound(mockBot, mockInput);
      expect(output.response).toBe('');
      expect(output.debug).toContain('OLE');
    });
  });

  describe('process error event', () => {
    it('should mark process as exited on error event', async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);

      (child.stdin as unknown as { write: jest.Mock }).write.mockImplementation(() => {
        process.nextTick(() => {
          child.stdout!.emit('data', Buffer.from('{"response":"ok"}\n'));
        });
        return true;
      });
      await strategy.runRound(mockBot, mockInput);

      child.emit('error', new Error('spawn EACCES'));

      const output = await strategy.runRound(mockBot, mockInput);
      expect(output.debug).toContain('进程已退出');
    });
  });
});
