import { NsjailSandbox } from './nsjail.sandbox';
import * as child_process from 'child_process';
import { EventEmitter } from 'events';
import type { SandboxRequest } from './sandbox.interface';

jest.mock('child_process');

interface FakeProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: jest.Mock; end: jest.Mock; on: jest.Mock };
  kill: jest.Mock;
}

describe('NsjailSandbox', () => {
  let sandbox: NsjailSandbox;

  function createFakeProcess(): FakeProcess {
    const emitter = new EventEmitter();
    return Object.assign(emitter, {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdin: { write: jest.fn(), end: jest.fn(), on: jest.fn() },
      kill: jest.fn(),
    }) as FakeProcess;
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
    const mockConfig = {
      get: jest.fn().mockReturnValue('/usr/bin/nsjail'),
    } as unknown as import('@nestjs/config').ConfigService;
    sandbox = new NsjailSandbox(mockConfig);
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
      outputTruncated: false,
    });

    // Verify spawn was called with nsjail path
    expect(child_process.spawn).toHaveBeenCalledWith('/usr/bin/nsjail', expect.any(Array), {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
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
    const spawnMock = child_process.spawn as jest.Mock;
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

  describe('mount path sanitization', () => {
    it('should skip empty mount path', () => {
      const fakeProc = createFakeProcess();
      (child_process.spawn as jest.Mock).mockReturnValue(fakeProc);

      sandbox.execute(
        makeRequest({
          compiled: {
            cmd: '/usr/bin/python3',
            args: [],
            language: 'python',
            readonlyMounts: ['', '/opt/python3'],
          },
        }),
      );
      fakeProc.emit('close', 0);

      const args = (child_process.spawn as jest.Mock).mock.calls[0][1] as string[];
      expect(args).toContain('/opt/python3:/opt/python3:ro');
      expect(args).not.toContain('::ro');
    });

    it('should skip relative mount paths', () => {
      const fakeProc = createFakeProcess();
      (child_process.spawn as jest.Mock).mockReturnValue(fakeProc);

      sandbox.execute(
        makeRequest({
          compiled: {
            cmd: '/usr/bin/python3',
            args: [],
            language: 'python',
            readonlyMounts: ['../etc/passwd'],
          },
        }),
      );
      fakeProc.emit('close', 0);

      const args = (child_process.spawn as jest.Mock).mock.calls[0][1] as string[];
      expect(args.some((a: string) => a.includes('passwd'))).toBe(false);
    });

    it('should skip mount paths containing colons', () => {
      const fakeProc = createFakeProcess();
      (child_process.spawn as jest.Mock).mockReturnValue(fakeProc);

      sandbox.execute(
        makeRequest({
          compiled: {
            cmd: '/usr/bin/python3',
            args: [],
            language: 'python',
            readonlyMounts: ['/opt/lib:evil'],
          },
        }),
      );
      fakeProc.emit('close', 0);

      const args = (child_process.spawn as jest.Mock).mock.calls[0][1] as string[];
      expect(args.some((a: string) => a.includes('evil'))).toBe(false);
    });
  });
});
