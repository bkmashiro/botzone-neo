import { LongrunStrategy } from './longrun.strategy';
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
  return Object.assign(emitter, {
    stdout,
    stderr,
    stdin,
    kill: jest.fn().mockReturnValue(true),
    pid: 12345,
  }) as unknown as ChildProcess;
}

describe('LongrunStrategy (src/strategy)', () => {
  let strategy: LongrunStrategy;
  const mockSpawn = child_process.spawn as jest.MockedFunction<typeof child_process.spawn>;

  const mockBotCtx = {
    id: '0',
    language: 'cpp',
    execCmd: '/bin/test',
    execArgs: [] as string[],
    workDir: '/tmp/work',
    limit: { time: 1000, memory: 256 },
  };

  const mockInput = {
    requests: ['req1'],
    responses: [] as string[],
    data: '',
    globaldata: '',
    time_limit: 1,
    memory_limit: 256,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new LongrunStrategy();
  });

  it('should spawn process and return JSON output', async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child);

    (child.stdin as unknown as { write: jest.Mock }).write.mockImplementation(() => {
      process.nextTick(() => {
        child.stdout!.emit('data', Buffer.from('{"response":"ok"}\n'));
      });
      return true;
    });

    const output = await strategy.runRound(mockBotCtx, mockInput);
    expect(output.response).toBe('ok');
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('should reuse process and send SIGCONT on subsequent rounds', async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child);

    (child.stdin as unknown as { write: jest.Mock }).write.mockImplementation(() => {
      process.nextTick(() => {
        child.stdout!.emit('data', Buffer.from('{"response":"r1"}\n'));
      });
      return true;
    });
    await strategy.runRound(mockBotCtx, mockInput);

    (child.stdin as unknown as { write: jest.Mock }).write.mockImplementation(() => {
      process.nextTick(() => {
        child.stdout!.emit('data', Buffer.from('{"response":"r2"}\n'));
      });
      return true;
    });
    const output = await strategy.runRound(mockBotCtx, mockInput);

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith('SIGCONT');
    expect(output.response).toBe('r2');
  });

  it('should send SIGSTOP on afterRound', async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child);

    (child.stdin as unknown as { write: jest.Mock }).write.mockImplementation(() => {
      process.nextTick(() => {
        child.stdout!.emit('data', Buffer.from('{"response":"ok"}\n'));
      });
      return true;
    });
    await strategy.runRound(mockBotCtx, mockInput);

    await strategy.afterRound(mockBotCtx);
    expect(child.kill).toHaveBeenCalledWith('SIGSTOP');
  });

  it('should send SIGKILL on cleanup', async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child);

    (child.stdin as unknown as { write: jest.Mock }).write.mockImplementation(() => {
      process.nextTick(() => {
        child.stdout!.emit('data', Buffer.from('{"response":"ok"}\n'));
      });
      return true;
    });
    await strategy.runRound(mockBotCtx, mockInput);

    await strategy.cleanup(mockBotCtx);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('should be safe to call afterRound and cleanup without a process', async () => {
    await expect(strategy.afterRound(mockBotCtx)).resolves.toBeUndefined();
    await expect(strategy.cleanup(mockBotCtx)).resolves.toBeUndefined();
  });
});
