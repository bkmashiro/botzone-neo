import { DirectSandbox } from './direct.sandbox';
import { SandboxRequest, MAX_OUTPUT_BYTES } from './sandbox.interface';

describe('DirectSandbox', () => {
  const sandbox = new DirectSandbox();

  it('执行 echo 命令并获取 stdout', async () => {
    const req: SandboxRequest = {
      compiled: { cmd: 'echo', args: ['hello world'], language: 'test', readonlyMounts: [] },
      workDir: '/tmp',
      limit: { timeMs: 5000, memoryMb: 256 },
    };

    const result = await sandbox.execute(req);
    expect(result.stdout.trim()).toBe('hello world');
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it('传递 stdin 给 cat 并读取输出', async () => {
    const req: SandboxRequest = {
      compiled: { cmd: 'cat', args: [], language: 'test', readonlyMounts: [] },
      workDir: '/tmp',
      limit: { timeMs: 5000, memoryMb: 256 },
      stdin: 'test input',
    };

    const result = await sandbox.execute(req);
    expect(result.stdout).toBe('test input');
    expect(result.exitCode).toBe(0);
  });

  it('非零退出码', async () => {
    const req: SandboxRequest = {
      compiled: { cmd: 'sh', args: ['-c', 'exit 42'], language: 'test', readonlyMounts: [] },
      workDir: '/tmp',
      limit: { timeMs: 5000, memoryMb: 256 },
    };

    const result = await sandbox.execute(req);
    expect(result.exitCode).toBe(42);
    expect(result.timedOut).toBe(false);
  });

  it('超时触发 SIGKILL', async () => {
    const req: SandboxRequest = {
      compiled: { cmd: 'sleep', args: ['10'], language: 'test', readonlyMounts: [] },
      workDir: '/tmp',
      limit: { timeMs: 100, memoryMb: 256 },
    };

    const result = await sandbox.execute(req);
    expect(result.timedOut).toBe(true);
  });

  it('truncates stdout exceeding MAX_OUTPUT_BYTES and sets outputTruncated', async () => {
    // Generate output slightly over the limit
    const overSize = MAX_OUTPUT_BYTES + 1024;
    const req: SandboxRequest = {
      compiled: {
        cmd: 'sh',
        args: ['-c', `dd if=/dev/zero bs=${overSize} count=1 2>/dev/null | tr '\\0' 'A'`],
        language: 'test',
        readonlyMounts: [],
      },
      workDir: '/tmp',
      limit: { timeMs: 10000, memoryMb: 256 },
    };

    const result = await sandbox.execute(req);
    expect(result.stdout.length).toBeLessThanOrEqual(MAX_OUTPUT_BYTES + 65536); // buffer margin
    expect(result.exitCode).toBe(0);
    expect(result.outputTruncated).toBe(true);
  });

  it('should not set outputTruncated for normal output', async () => {
    const req: SandboxRequest = {
      compiled: { cmd: 'echo', args: ['small output'], language: 'test', readonlyMounts: [] },
      workDir: '/tmp',
      limit: { timeMs: 5000, memoryMb: 256 },
    };

    const result = await sandbox.execute(req);
    expect(result.outputTruncated).toBe(false);
  });

  it('should reject when spawn fails (e.g. command not found)', async () => {
    const req: SandboxRequest = {
      compiled: {
        cmd: '/nonexistent/binary_that_does_not_exist_xyz',
        args: [],
        language: 'test',
        readonlyMounts: [],
      },
      workDir: '/tmp',
      limit: { timeMs: 5000, memoryMb: 256 },
    };

    await expect(sandbox.execute(req)).rejects.toThrow();
  });

  it('捕获 stderr', async () => {
    const req: SandboxRequest = {
      compiled: {
        cmd: 'sh',
        args: ['-c', 'echo error >&2; exit 1'],
        language: 'test',
        readonlyMounts: [],
      },
      workDir: '/tmp',
      limit: { timeMs: 5000, memoryMb: 256 },
    };

    const result = await sandbox.execute(req);
    expect(result.stderr.trim()).toBe('error');
    expect(result.exitCode).toBe(1);
  });
});
