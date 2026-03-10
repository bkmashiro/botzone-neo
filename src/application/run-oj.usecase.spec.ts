jest.mock('fs/promises');
jest.mock('os');

import * as fs from 'fs/promises';
import * as os from 'os';

import { RunOJUseCase } from './run-oj.usecase';
import { Verdict, CompileError } from '../domain/verdict';
import { CompiledBot } from '../domain/bot';
import { OJTask, OJResult } from '../domain/oj/testcase';
import { ISandbox, SandboxResult } from '../infrastructure/sandbox/sandbox.interface';
import { CompileService } from '../infrastructure/compile/compile.service';
import { CallbackService } from '../infrastructure/callback/callback.service';

// ── Mocks ──────────────────────────────────────────────────

const mockCompileService = { compile: jest.fn() };
const mockCallbackService = { finish: jest.fn() };
const mockSandbox = { execute: jest.fn() };
const mockCounter = { inc: jest.fn() };
const mockHistogram = { observe: jest.fn() };

const compiledBot: CompiledBot = {
  cmd: 'test',
  args: [],
  language: 'cpp',
  readonlyMounts: [],
};

const successSandboxResult: SandboxResult = {
  stdout: '3\n',
  stderr: '',
  exitCode: 0,
  timedOut: false,
  memoryKb: 1024,
};

function makeTask(overrides?: Partial<OJTask>): OJTask {
  return {
    type: 'oj',
    language: 'cpp',
    source: 'int main() {}',
    testcases: [{ id: 1, input: '1 2\n', expectedOutput: '3\n' }],
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    callback: { finish: 'http://finish' },
    judgeMode: 'standard',
    ...overrides,
  };
}

// ── Test Suite ──────────────────────────────────────────────

describe('RunOJUseCase', () => {
  let useCase: RunOJUseCase;

  beforeEach(() => {
    jest.clearAllMocks();

    // fs/promises mock setup
    (os.tmpdir as jest.Mock).mockReturnValue('/tmp');
    (fs.mkdtemp as jest.Mock).mockResolvedValue('/tmp/oj-abc123');
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
    (fs.rm as jest.Mock).mockResolvedValue(undefined);
    (fs.writeFile as jest.Mock).mockResolvedValue(undefined);

    // Default: compile succeeds
    mockCompileService.compile.mockResolvedValue(compiledBot);

    // Default: callback succeeds
    mockCallbackService.finish.mockResolvedValue(undefined);

    // Default: sandbox returns AC result
    mockSandbox.execute.mockResolvedValue(successSandboxResult);

    useCase = new RunOJUseCase(
      mockCompileService as unknown as CompileService,
      mockCallbackService as unknown as CallbackService,
      mockSandbox as unknown as ISandbox,
      mockCounter as never,
      mockHistogram as never,
    );
  });

  // ── 1. Successful AC ──────────────────────────────────────

  it('should report AC when all testcases pass', async () => {
    const task = makeTask();

    await useCase.execute(task);

    expect(mockCompileService.compile).toHaveBeenCalledWith('cpp', 'int main() {}');
    expect(mockSandbox.execute).toHaveBeenCalledTimes(1);
    expect(mockSandbox.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        compiled: compiledBot,
        stdin: '1 2\n',
        limit: { timeMs: 1000, memoryMb: 256 },
      }),
    );

    expect(mockCallbackService.finish).toHaveBeenCalledTimes(1);
    const result: OJResult = mockCallbackService.finish.mock.calls[0][1];
    expect(result.verdict).toBe(Verdict.AC);
    expect(result.compile.verdict).toBe(Verdict.OK);
    expect(result.testcases).toHaveLength(1);
    expect(result.testcases[0].verdict).toBe(Verdict.AC);
    expect(result.testcases[0].actualOutput).toBe('3\n');
  });

  // ── 2. Compile Error ──────────────────────────────────────

  it('should report CE when compilation fails with CompileError', async () => {
    mockCompileService.compile.mockRejectedValue(new CompileError('syntax error: expected ;'));
    const task = makeTask();

    await useCase.execute(task);

    expect(mockSandbox.execute).not.toHaveBeenCalled();
    expect(mockCallbackService.finish).toHaveBeenCalledTimes(1);

    const result: OJResult = mockCallbackService.finish.mock.calls[0][1];
    expect(result.verdict).toBe(Verdict.CE);
    expect(result.testcases).toHaveLength(0);
    expect(result.compile.verdict).toBe(Verdict.CE);
    expect(result.compile.message).toBe('syntax error: expected ;');
  });

  it('should rethrow non-CompileError exceptions from compile', async () => {
    const internalError = new Error('disk full');
    mockCompileService.compile.mockRejectedValue(internalError);
    const task = makeTask();

    await expect(useCase.execute(task)).rejects.toThrow('disk full');
    expect(mockCallbackService.finish).not.toHaveBeenCalled();
  });

  // ── 3. TLE ────────────────────────────────────────────────

  it('should report TLE when sandbox returns timedOut: true', async () => {
    mockSandbox.execute.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: -1,
      timedOut: true,
      memoryKb: 2048,
    });
    const task = makeTask();

    await useCase.execute(task);

    const result: OJResult = mockCallbackService.finish.mock.calls[0][1];
    expect(result.verdict).toBe(Verdict.TLE);
    expect(result.testcases[0].verdict).toBe(Verdict.TLE);
    expect(result.testcases[0].memoryKb).toBe(2048);
    expect(result.testcases[0].actualOutput).toBeUndefined();
  });

  // ── 4. RE ─────────────────────────────────────────────────

  it('should report RE when sandbox returns non-zero exit code', async () => {
    mockSandbox.execute.mockResolvedValue({
      stdout: '',
      stderr: 'segmentation fault',
      exitCode: 139,
      timedOut: false,
      memoryKb: 4096,
    });
    const task = makeTask();

    await useCase.execute(task);

    const result: OJResult = mockCallbackService.finish.mock.calls[0][1];
    expect(result.verdict).toBe(Verdict.RE);
    expect(result.testcases[0].verdict).toBe(Verdict.RE);
    expect(result.testcases[0].message).toBe('segmentation fault');
  });

  it('should use fallback exit code message when stderr is empty on RE', async () => {
    mockSandbox.execute.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 1,
      timedOut: false,
      memoryKb: 1024,
    });
    const task = makeTask();

    await useCase.execute(task);

    const result: OJResult = mockCallbackService.finish.mock.calls[0][1];
    expect(result.testcases[0].verdict).toBe(Verdict.RE);
    expect(result.testcases[0].message).toBe('exit code 1');
  });

  // ── 5. WA ─────────────────────────────────────────────────

  it('should report WA when actual output does not match expected', async () => {
    mockSandbox.execute.mockResolvedValue({
      stdout: '4\n',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      memoryKb: 1024,
    });
    const task = makeTask();

    await useCase.execute(task);

    const result: OJResult = mockCallbackService.finish.mock.calls[0][1];
    expect(result.verdict).toBe(Verdict.WA);
    expect(result.testcases[0].verdict).toBe(Verdict.WA);
    expect(result.testcases[0].actualOutput).toBe('4\n');
  });

  // ── 6. Multiple testcases with mixed results ──────────────

  it('should handle multiple testcases and report first non-AC as overall verdict', async () => {
    const task = makeTask({
      testcases: [
        { id: 1, input: '1 2\n', expectedOutput: '3\n' },
        { id: 2, input: '3 4\n', expectedOutput: '7\n' },
        { id: 3, input: '5 5\n', expectedOutput: '10\n' },
      ],
    });

    mockSandbox.execute
      .mockResolvedValueOnce({
        stdout: '3\n',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        memoryKb: 1024,
      })
      .mockResolvedValueOnce({
        stdout: '8\n',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        memoryKb: 1024,
      })
      .mockResolvedValueOnce({
        stdout: '',
        stderr: '',
        exitCode: -1,
        timedOut: true,
        memoryKb: 2048,
      });

    await useCase.execute(task);

    expect(mockSandbox.execute).toHaveBeenCalledTimes(3);

    const result: OJResult = mockCallbackService.finish.mock.calls[0][1];
    expect(result.verdict).toBe(Verdict.WA);
    expect(result.testcases).toHaveLength(3);
    expect(result.testcases[0].verdict).toBe(Verdict.AC);
    expect(result.testcases[1].verdict).toBe(Verdict.WA);
    expect(result.testcases[2].verdict).toBe(Verdict.TLE);
  });

  it('should keep overall verdict as first non-AC even when later errors differ', async () => {
    const task = makeTask({
      testcases: [
        { id: 1, input: '1\n', expectedOutput: '1\n' },
        { id: 2, input: '2\n', expectedOutput: '2\n' },
        { id: 3, input: '3\n', expectedOutput: '3\n' },
      ],
    });

    mockSandbox.execute
      .mockResolvedValueOnce({
        stdout: '',
        stderr: '',
        exitCode: -1,
        timedOut: true,
        memoryKb: 1024,
      })
      .mockResolvedValueOnce({
        stdout: '',
        stderr: 'crash',
        exitCode: 139,
        timedOut: false,
        memoryKb: 1024,
      })
      .mockResolvedValueOnce({
        stdout: '999\n',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        memoryKb: 1024,
      });

    await useCase.execute(task);

    const result: OJResult = mockCallbackService.finish.mock.calls[0][1];
    // First non-AC was TLE (testcase 1), so overall remains TLE
    expect(result.verdict).toBe(Verdict.TLE);
    expect(result.testcases[0].verdict).toBe(Verdict.TLE);
    expect(result.testcases[1].verdict).toBe(Verdict.RE);
    expect(result.testcases[2].verdict).toBe(Verdict.WA);
  });

  // ── 7. Temp directory lifecycle ───────────────────────────

  it('should create a temp dir and clean it up after execution', async () => {
    const task = makeTask();

    await useCase.execute(task);

    expect(fs.mkdtemp).toHaveBeenCalledWith('/tmp/oj-');
    expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining('/tmp/oj-abc123/tc-1'), {
      recursive: true,
    });
    expect(fs.rm).toHaveBeenCalledWith('/tmp/oj-abc123', {
      recursive: true,
      force: true,
    });
  });

  it('should clean up temp dir even when compile throws a non-CompileError', async () => {
    mockCompileService.compile.mockRejectedValue(new Error('internal'));
    const task = makeTask();

    await expect(useCase.execute(task)).rejects.toThrow('internal');
    expect(fs.rm).toHaveBeenCalledWith('/tmp/oj-abc123', {
      recursive: true,
      force: true,
    });
  });

  it('should clean up temp dir even when compile throws CompileError', async () => {
    mockCompileService.compile.mockRejectedValue(new CompileError('bad code'));
    const task = makeTask();

    await useCase.execute(task);
    expect(fs.rm).toHaveBeenCalledWith('/tmp/oj-abc123', {
      recursive: true,
      force: true,
    });
  });

  // ── 8. Per-testcase limits ────────────────────────────────

  it('should use per-testcase limits when specified', async () => {
    const task = makeTask({
      testcases: [
        {
          id: 1,
          input: '1\n',
          expectedOutput: '1\n',
          timeLimitMs: 500,
          memoryLimitMb: 128,
        },
      ],
    });

    await useCase.execute(task);

    expect(mockSandbox.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: { timeMs: 500, memoryMb: 128 },
      }),
    );
  });

  it('should fall back to global limits when testcase limits are not set', async () => {
    const task = makeTask({
      timeLimitMs: 2000,
      memoryLimitMb: 512,
      testcases: [{ id: 1, input: '1\n', expectedOutput: '1\n' }],
    });

    await useCase.execute(task);

    expect(mockSandbox.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: { timeMs: 2000, memoryMb: 512 },
      }),
    );
  });

  // ── 9. Custom checker mode ────────────────────────────────

  it('should use CustomChecker when judgeMode is "checker"', async () => {
    const checkerCompiled: CompiledBot = {
      cmd: './checker',
      args: [],
      language: 'cpp',
      readonlyMounts: [],
    };

    // First compile call: user code; second: checker code
    mockCompileService.compile
      .mockResolvedValueOnce(compiledBot)
      .mockResolvedValueOnce(checkerCompiled);

    // First sandbox call: run user code; second: run checker
    mockSandbox.execute
      .mockResolvedValueOnce({
        stdout: '42\n',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        memoryKb: 1024,
      })
      .mockResolvedValueOnce({
        // Checker says AC (exit code 0)
        stdout: '',
        stderr: 'ok accepted',
        exitCode: 0,
        timedOut: false,
        memoryKb: 512,
      });

    const task = makeTask({
      judgeMode: 'checker',
      checkerLanguage: 'cpp',
      checkerSource: '#include "testlib.h"\nint main() {}',
      testcases: [{ id: 1, input: '1\n', expectedOutput: '42\n' }],
    });

    await useCase.execute(task);

    // Checker code should be compiled
    expect(mockCompileService.compile).toHaveBeenCalledTimes(2);
    expect(mockCompileService.compile).toHaveBeenCalledWith(
      'cpp',
      '#include "testlib.h"\nint main() {}',
    );

    // Checker directory should be created
    expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining('/tmp/oj-abc123/checker'), {
      recursive: true,
    });

    // Sandbox should be called twice: once for user, once for checker
    expect(mockSandbox.execute).toHaveBeenCalledTimes(2);

    const result: OJResult = mockCallbackService.finish.mock.calls[0][1];
    expect(result.verdict).toBe(Verdict.AC);
    expect(result.testcases[0].verdict).toBe(Verdict.AC);
    expect(result.testcases[0].message).toBe('ok accepted');
  });

  it('should report WA when custom checker returns exit code 1', async () => {
    const checkerCompiled: CompiledBot = {
      cmd: './checker',
      args: [],
      language: 'cpp',
      readonlyMounts: [],
    };

    mockCompileService.compile
      .mockResolvedValueOnce(compiledBot)
      .mockResolvedValueOnce(checkerCompiled);

    mockSandbox.execute
      .mockResolvedValueOnce({
        stdout: '99\n',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        memoryKb: 1024,
      })
      .mockResolvedValueOnce({
        // Checker says WA (exit code 1)
        stdout: '',
        stderr: 'expected 42, found 99',
        exitCode: 1,
        timedOut: false,
        memoryKb: 512,
      });

    const task = makeTask({
      judgeMode: 'checker',
      checkerLanguage: 'cpp',
      checkerSource: 'checker source',
      testcases: [{ id: 1, input: '1\n', expectedOutput: '42\n' }],
    });

    await useCase.execute(task);

    const result: OJResult = mockCallbackService.finish.mock.calls[0][1];
    expect(result.verdict).toBe(Verdict.WA);
    expect(result.testcases[0].verdict).toBe(Verdict.WA);
    expect(result.testcases[0].message).toBe('expected 42, found 99');
  });

  // ── 9b. Checker compile failure ──────────────────────────

  it('should report CE when custom checker fails to compile', async () => {
    // User code compiles fine, but checker compile fails
    mockCompileService.compile
      .mockResolvedValueOnce(compiledBot)
      .mockRejectedValueOnce(new CompileError('checker: undefined reference to main'));

    const task = makeTask({
      judgeMode: 'checker',
      checkerLanguage: 'cpp',
      checkerSource: 'bad checker code',
      testcases: [{ id: 1, input: '1\n', expectedOutput: '1\n' }],
    });

    await useCase.execute(task);

    const result: OJResult = mockCallbackService.finish.mock.calls[0][1];
    expect(result.verdict).toBe(Verdict.CE);
    expect(result.testcases).toHaveLength(0);
    expect(result.compile.message).toContain('checker');
  });

  it('should rethrow non-CompileError from checker compile', async () => {
    mockCompileService.compile
      .mockResolvedValueOnce(compiledBot)
      .mockRejectedValueOnce(new Error('disk full'));

    const task = makeTask({
      judgeMode: 'checker',
      checkerLanguage: 'cpp',
      checkerSource: 'checker code',
    });

    await expect(useCase.execute(task)).rejects.toThrow('disk full');
  });

  it('should report SE when checker.check throws unexpectedly', async () => {
    const checkerCompiled: CompiledBot = {
      cmd: './checker',
      args: [],
      language: 'cpp',
      readonlyMounts: [],
    };

    mockCompileService.compile
      .mockResolvedValueOnce(compiledBot)
      .mockResolvedValueOnce(checkerCompiled);

    // User code runs fine
    mockSandbox.execute.mockResolvedValueOnce({
      stdout: '42\n',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      memoryKb: 1024,
    });
    // Checker sandbox throws (e.g., disk full)
    mockSandbox.execute.mockRejectedValueOnce(new Error('ENOSPC: no space left on device'));

    const task = makeTask({
      judgeMode: 'checker',
      checkerLanguage: 'cpp',
      checkerSource: 'checker code',
      testcases: [{ id: 1, input: '1\n', expectedOutput: '42\n' }],
    });

    await useCase.execute(task);

    const result: OJResult = mockCallbackService.finish.mock.calls[0][1];
    expect(result.verdict).toBe(Verdict.SE);
    expect(result.testcases[0].verdict).toBe(Verdict.SE);
    expect(result.testcases[0].message).toContain('ENOSPC');
  });

  it('should not throw when temp dir cleanup fails', async () => {
    (fs.rm as jest.Mock).mockRejectedValue(new Error('ENOENT'));
    const task = makeTask();

    await expect(useCase.execute(task)).resolves.toBeDefined();
  });

  // ── 10. Standard mode (DiffChecker) is used by default ────

  it('should use DiffChecker when judgeMode is "standard"', async () => {
    // DiffChecker normalizes trailing whitespace, so "3" matches "3\n"
    mockSandbox.execute.mockResolvedValue({
      stdout: '3',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      memoryKb: 1024,
    });

    const task = makeTask({
      testcases: [{ id: 1, input: '1 2\n', expectedOutput: '3\n' }],
    });

    await useCase.execute(task);

    // Only one compile call (user code, no checker)
    expect(mockCompileService.compile).toHaveBeenCalledTimes(1);
    // Only one sandbox call (user code, no checker sandbox invocation)
    expect(mockSandbox.execute).toHaveBeenCalledTimes(1);

    const result: OJResult = mockCallbackService.finish.mock.calls[0][1];
    expect(result.verdict).toBe(Verdict.AC);
  });

  // ── 11. Callback URL is forwarded correctly ───────────────

  it('should send results to the correct callback URL', async () => {
    const task = makeTask({
      callback: { finish: 'http://example.com/callback/123' },
    });

    await useCase.execute(task);

    expect(mockCallbackService.finish).toHaveBeenCalledWith(
      'http://example.com/callback/123',
      expect.objectContaining({ verdict: Verdict.AC }),
    );
  });

  // ── 12. All testcases AC with multiple testcases ──────────

  it('should report AC overall when all testcases pass', async () => {
    const task = makeTask({
      testcases: [
        { id: 1, input: '1 2\n', expectedOutput: '3\n' },
        { id: 2, input: '10 20\n', expectedOutput: '30\n' },
      ],
    });

    mockSandbox.execute
      .mockResolvedValueOnce({
        stdout: '3\n',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        memoryKb: 1024,
      })
      .mockResolvedValueOnce({
        stdout: '30\n',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        memoryKb: 2048,
      });

    await useCase.execute(task);

    const result: OJResult = mockCallbackService.finish.mock.calls[0][1];
    expect(result.verdict).toBe(Verdict.AC);
    expect(result.testcases).toHaveLength(2);
    expect(result.testcases[0].verdict).toBe(Verdict.AC);
    expect(result.testcases[1].verdict).toBe(Verdict.AC);
    expect(result.compile.verdict).toBe(Verdict.OK);
  });
});
