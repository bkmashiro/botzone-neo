import { NsjailService } from './nsjail.service';
import * as child_process from 'child_process';
import { EventEmitter } from 'events';

jest.mock('child_process');
jest.mock('./nsjail.config', () => ({
  buildNsjailArgs: jest.fn().mockReturnValue(['--mode', 'o', '--', '/bin/test']),
}));

describe('NsjailService', () => {
  let service: NsjailService;

  function createFakeProcess() {
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = { write: jest.fn(), end: jest.fn() };
    proc.kill = jest.fn();
    return proc;
  }

  beforeEach(() => {
    service = new NsjailService();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('should resolve with stdout, stderr, and exitCode on normal exit', async () => {
    const fakeProc = createFakeProcess();
    (child_process.spawn as jest.Mock).mockReturnValue(fakeProc);

    const promise = service.execute({
      execPath: '/bin/test',
      workDir: '/tmp/work',
      timeLimit: 5,
      memoryLimit: 256,
    });

    fakeProc.stdout.emit('data', Buffer.from('hello'));
    fakeProc.stderr.emit('data', Buffer.from('warn'));
    fakeProc.emit('close', 0);

    const result = await promise;
    expect(result).toEqual({
      stdout: 'hello',
      stderr: 'warn',
      exitCode: 0,
      timedOut: false,
    });
  });

  it('should write stdin when provided', async () => {
    const fakeProc = createFakeProcess();
    (child_process.spawn as jest.Mock).mockReturnValue(fakeProc);

    const promise = service.execute(
      {
        execPath: '/bin/test',
        workDir: '/tmp/work',
        timeLimit: 5,
        memoryLimit: 256,
      },
      'input-data',
    );

    fakeProc.emit('close', 0);
    await promise;

    expect(fakeProc.stdin.write).toHaveBeenCalledWith('input-data');
    expect(fakeProc.stdin.end).toHaveBeenCalled();
  });

  it('should not write stdin when not provided', async () => {
    const fakeProc = createFakeProcess();
    (child_process.spawn as jest.Mock).mockReturnValue(fakeProc);

    const promise = service.execute({
      execPath: '/bin/test',
      workDir: '/tmp/work',
      timeLimit: 5,
      memoryLimit: 256,
    });

    fakeProc.emit('close', 0);
    await promise;

    expect(fakeProc.stdin.write).not.toHaveBeenCalled();
    expect(fakeProc.stdin.end).toHaveBeenCalled();
  });

  it('should set timedOut=true when timeout fires', async () => {
    const fakeProc = createFakeProcess();
    (child_process.spawn as jest.Mock).mockReturnValue(fakeProc);

    const promise = service.execute({
      execPath: '/bin/test',
      workDir: '/tmp/work',
      timeLimit: 5,
      memoryLimit: 256,
    });

    // Advance past timeout: (5 + 5) * 1000 = 10000ms
    jest.advanceTimersByTime(10001);

    expect(fakeProc.kill).toHaveBeenCalledWith('SIGKILL');

    fakeProc.emit('close', -1);
    const result = await promise;
    expect(result.timedOut).toBe(true);
  });

  it('should reject on process error', async () => {
    const fakeProc = createFakeProcess();
    (child_process.spawn as jest.Mock).mockReturnValue(fakeProc);

    const promise = service.execute({
      execPath: '/bin/test',
      workDir: '/tmp/work',
      timeLimit: 5,
      memoryLimit: 256,
    });

    fakeProc.emit('error', new Error('spawn ENOENT'));

    await expect(promise).rejects.toThrow('spawn ENOENT');
  });

  it('should use -1 when exit code is null', async () => {
    const fakeProc = createFakeProcess();
    (child_process.spawn as jest.Mock).mockReturnValue(fakeProc);

    const promise = service.execute({
      execPath: '/bin/test',
      workDir: '/tmp/work',
      timeLimit: 5,
      memoryLimit: 256,
    });

    fakeProc.emit('close', null);
    const result = await promise;
    expect(result.exitCode).toBe(-1);
  });
});
