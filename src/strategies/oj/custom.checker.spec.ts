import { CustomChecker } from './custom.checker';
import { Verdict } from '../../domain/verdict';
import { ISandbox, SandboxResult } from '../../infrastructure/sandbox/sandbox.interface';
import { CompiledBot } from '../../domain/bot';

/** 创建一个 mock sandbox，返回指定的 SandboxResult */
function mockSandbox(result: SandboxResult): ISandbox {
  return { execute: jest.fn().mockResolvedValue(result) };
}

const dummyCompiled: CompiledBot = {
  cmd: './checker',
  args: [],
  language: 'cpp',
  readonlyMounts: [],
};

describe('CustomChecker', () => {
  it('checker 输出 AC → 判定 AC', async () => {
    const sandbox = mockSandbox({
      stdout: 'AC\n',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });
    const checker = new CustomChecker(sandbox, dummyCompiled, '/tmp');

    const result = await checker.check('1 2', '3', '3');
    expect(result.verdict).toBe(Verdict.AC);
  });

  it('checker 输出 AC + message → 判定 AC 并携带 message', async () => {
    const sandbox = mockSandbox({
      stdout: 'AC\nCorrect answer\n',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });
    const checker = new CustomChecker(sandbox, dummyCompiled, '/tmp');

    const result = await checker.check('1 2', '3', '3');
    expect(result.verdict).toBe(Verdict.AC);
    expect(result.message).toBe('Correct answer');
  });

  it('checker 输出 WA → 判定 WA', async () => {
    const sandbox = mockSandbox({
      stdout: 'WA\nExpected 3, got 4\n',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });
    const checker = new CustomChecker(sandbox, dummyCompiled, '/tmp');

    const result = await checker.check('1 2', '3', '4');
    expect(result.verdict).toBe(Verdict.WA);
    expect(result.message).toBe('Expected 3, got 4');
  });

  it('checker 输出 WA 无 message → 默认 "Wrong Answer"', async () => {
    const sandbox = mockSandbox({
      stdout: 'WA\n',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });
    const checker = new CustomChecker(sandbox, dummyCompiled, '/tmp');

    const result = await checker.check('1 2', '3', '4');
    expect(result.verdict).toBe(Verdict.WA);
    expect(result.message).toBe('Wrong Answer');
  });

  it('checker 超时 → 判定 WA 并报异常', async () => {
    const sandbox = mockSandbox({
      stdout: '',
      stderr: '',
      exitCode: -1,
      timedOut: true,
    });
    const checker = new CustomChecker(sandbox, dummyCompiled, '/tmp');

    const result = await checker.check('1 2', '3', '3');
    expect(result.verdict).toBe(Verdict.WA);
    expect(result.message).toContain('Checker 异常');
  });

  it('checker 崩溃（非零退出码）→ 判定 WA 并报 stderr', async () => {
    const sandbox = mockSandbox({
      stdout: '',
      stderr: 'segfault',
      exitCode: 139,
      timedOut: false,
    });
    const checker = new CustomChecker(sandbox, dummyCompiled, '/tmp');

    const result = await checker.check('1 2', '3', '3');
    expect(result.verdict).toBe(Verdict.WA);
    expect(result.message).toContain('segfault');
  });

  it('checker 崩溃无 stderr → 报退出码', async () => {
    const sandbox = mockSandbox({
      stdout: '',
      stderr: '',
      exitCode: 1,
      timedOut: false,
    });
    const checker = new CustomChecker(sandbox, dummyCompiled, '/tmp');

    const result = await checker.check('1 2', '3', '3');
    expect(result.verdict).toBe(Verdict.WA);
    expect(result.message).toContain('exit code 1');
  });

  it('正确拼接 stdin（input/expected/actual 用 --- 分隔）', async () => {
    const executeMock = jest.fn().mockResolvedValue({
      stdout: 'AC\n',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });
    const sandbox: ISandbox = { execute: executeMock };
    const checker = new CustomChecker(sandbox, dummyCompiled, '/tmp');

    await checker.check('my input', 'expected out', 'actual out');

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stdin: 'my input\n---\nexpected out\n---\nactual out',
      }),
    );
  });

  it('checker 输出大小写不敏感（ac → AC）', async () => {
    const sandbox = mockSandbox({
      stdout: 'ac\n',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });
    const checker = new CustomChecker(sandbox, dummyCompiled, '/tmp');

    const result = await checker.check('', '', '');
    expect(result.verdict).toBe(Verdict.AC);
  });

  it('checker 空输出 → 判定 WA', async () => {
    const sandbox = mockSandbox({
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });
    const checker = new CustomChecker(sandbox, dummyCompiled, '/tmp');

    const result = await checker.check('', '', '');
    expect(result.verdict).toBe(Verdict.WA);
  });
});
