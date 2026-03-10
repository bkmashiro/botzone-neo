import { NsjailSandbox } from './nsjail.sandbox';
import * as child_process from 'child_process';
import { EventEmitter } from 'events';
import { SandboxRequest } from './sandbox.interface';

jest.mock('child_process');

describe('NsjailSandbox', () => {
  let sandbox: NsjailSandbox;

  function createFakeProcess() {
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = { write: jest.fn(), end: jest.fn() };
    proc.kill = jest.fn();
    return proc;
  }

  function makeRequest(overrides?: Partial<SandboxRequest>): SandboxRequest {
    return {
      compiled: {
        cmd: '/usr/bin/python3',
        args: ['/workspace/main.py'],
        language: 'python',
        readonlyMounts: ['/opt/python3'],
      },
      workDir: '/tmp/sandbox-work',
      limit: { timeMs: 3000, memoryMb: 256 },
      ...overrides,
    };
  }

  beforeEach(() => {
    sandbox = new NsjailSandbox();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('should spawn nsjail with correct args and resolve on close', async () => {
    const fakeProc = createFakeProcess();
    (child_process.spawn as jest.Mock).mockReturnValue(fakeProc);

    const promise = sandbox.execute(makeRequest());

    fakeProc.stdout.emit('data', Buffer.from('output'));
    fakeProc.stderr.emit('data', Buffer.from('err'));
    fakeProc.emit('close', 0);

    const result = await promise;
    expect(result).toEqual({
      stdout: 'output',
      stderr: 'err',
      exitCode: 0,
      timedOut: false,
    });

    // Verify spawn was called with nsjail path
    expect(child_process.spawn).toHaveBeenCalledWith(
      '/usr/bin/nsjail',
      expect.any(Array),
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
  });

  it('should include readonly mounts from compiled bot', () => {
    const fakeProc = createFakeProcess();
    (child_process.spawn as jest.Mock).mockReturnValue(fakeProc);

    sandbox.execute(makeRequest());
    fakeProc.emit('close', 0);

    const args = (child_process.spawn as jest.Mock).mock.calls[0][1] as string[];
    expect(args).toContain('/opt/python3:/opt/python3:ro');
  });

  it('should include compiled cmd and args after -- separator', () => {
    const fakeProc = createFakeProcess();
    (child_process.spawn as jest.Mock).mockReturnValue(fakeProc);

    sandbox.execute(makeRequest());
    fakeProc.emit('close', 0);

    const args = (child_process.spawn as jest.Mock).mock.calls[0][1] as string[];
    const sepIndex = args.indexOf('--');
    expect(args[sepIndex + 1]).toBe('/usr/bin/python3');
    expect(args[sepIndex + 2]).toBe('/workspace/main.py');
  });

  it('should compute time limit from milliseconds', () => {
    const fakeProc = createFakeProcess();
    const spawnMock = (child_process.spawn as jest.Mock);
    spawnMock.mockReturnValue(fakeProc);

    sandbox.execute(makeRequest({ limit: { timeMs: 1500, memoryMb: 128 } }));
    fakeProc.emit('close', 0);

    // Get the most recent spawn call
    const lastCall = spawnMock.mock.calls[spawnMock.mock.calls.length - 1];
    const args = lastCall[1] as string[];
    // ceil(1500/1000) = 2
    expect(args[args.indexOf('--time_limit') + 1]).toBe('2');
  });

  it('should write stdin when provided', async () => {
    const fakeProc = createFakeProcess();
    (child_process.spawn as jest.Mock).mockReturnValue(fakeProc);

    const promise = sandbox.execute(makeRequest({ stdin: 'hello stdin' }));
    fakeProc.emit('close', 0);
    await promise;

    expect(fakeProc.stdin.write).toHaveBeenCalledWith('hello stdin');
    expect(fakeProc.stdin.end).toHaveBeenCalled();
  });

  it('should not write stdin when not provided', async () => {
    const fakeProc = createFakeProcess();
    (child_process.spawn as jest.Mock).mockReturnValue(fakeProc);

    const promise = sandbox.execute(makeRequest({ stdin: undefined }));
    fakeProc.emit('close', 0);
    await promise;

    expect(fakeProc.stdin.write).not.toHaveBeenCalled();
    expect(fakeProc.stdin.end).toHaveBeenCalled();
  });

  it('should set timedOut=true and kill process on timeout', async () => {
    const fakeProc = createFakeProcess();
    (child_process.spawn as jest.Mock).mockReturnValue(fakeProc);

    const promise = sandbox.execute(makeRequest({ limit: { timeMs: 2000, memoryMb: 128 } }));

    // ceil(2000/1000)=2, timeout=(2+5)*1000=7000
    jest.advanceTimersByTime(7001);

    expect(fakeProc.kill).toHaveBeenCalledWith('SIGKILL');
    fakeProc.emit('close', -1);

    const result = await promise;
    expect(result.timedOut).toBe(true);
  });

  it('should reject on process error', async () => {
    const fakeProc = createFakeProcess();
    (child_process.spawn as jest.Mock).mockReturnValue(fakeProc);

    const promise = sandbox.execute(makeRequest());
    fakeProc.emit('error', new Error('spawn failed'));

    await expect(promise).rejects.toThrow('spawn failed');
  });

  it('should use -1 when exit code is null', async () => {
    const fakeProc = createFakeProcess();
    (child_process.spawn as jest.Mock).mockReturnValue(fakeProc);

    const promise = sandbox.execute(makeRequest());
    fakeProc.emit('close', null);

    const result = await promise;
    expect(result.exitCode).toBe(-1);
  });
});
