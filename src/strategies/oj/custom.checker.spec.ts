import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import { CustomChecker } from './custom.checker';
import { Verdict } from '../../domain/verdict';
import {
  ISandbox,
  SandboxRequest,
  SandboxResult,
} from '../../infrastructure/sandbox/sandbox.interface';
import { CompiledBot } from '../../domain/bot';

const dummyCompiled: CompiledBot = {
  cmd: './checker',
  args: [],
  language: 'cpp',
  readonlyMounts: [],
};

/** 创建 mock sandbox 并捕获请求 */
function mockSandbox(result: SandboxResult): {
  sandbox: ISandbox;
  lastRequest: () => SandboxRequest | undefined;
} {
  let captured: SandboxRequest | undefined;
  const sandbox: ISandbox = {
    execute: async (req: SandboxRequest) => {
      captured = req;
      return result;
    },
  };
  return { sandbox, lastRequest: () => captured };
}

describe('CustomChecker (Codeforces testlib.h 格式)', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'checker-test-'));
  });

  afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('exit code 0 → AC', async () => {
    const { sandbox } = mockSandbox({
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });
    const checker = new CustomChecker(sandbox, dummyCompiled, workDir);
    const result = await checker.check('1 2', '3', '3');
    expect(result.verdict).toBe(Verdict.AC);
  });

  it('exit code 0 + stderr → AC with message', async () => {
    const { sandbox } = mockSandbox({
      stdout: '',
      stderr: 'ok 1 number(s): "3"',
      exitCode: 0,
      timedOut: false,
    });
    const checker = new CustomChecker(sandbox, dummyCompiled, workDir);
    const result = await checker.check('1 2', '3', '3');
    expect(result.verdict).toBe(Verdict.AC);
    expect(result.message).toBe('ok 1 number(s): "3"');
  });

  it('exit code 1 → WA', async () => {
    const { sandbox } = mockSandbox({
      stdout: '',
      stderr: 'expected 3, found 4',
      exitCode: 1,
      timedOut: false,
    });
    const checker = new CustomChecker(sandbox, dummyCompiled, workDir);
    const result = await checker.check('1 2', '3', '4');
    expect(result.verdict).toBe(Verdict.WA);
    expect(result.message).toBe('expected 3, found 4');
  });

  it('exit code 1 无 stderr → 默认 "Wrong Answer"', async () => {
    const { sandbox } = mockSandbox({
      stdout: '',
      stderr: '',
      exitCode: 1,
      timedOut: false,
    });
    const checker = new CustomChecker(sandbox, dummyCompiled, workDir);
    const result = await checker.check('1 2', '3', '4');
    expect(result.verdict).toBe(Verdict.WA);
    expect(result.message).toBe('Wrong Answer');
  });

  it('exit code 2 → PE', async () => {
    const { sandbox } = mockSandbox({
      stdout: '',
      stderr: 'trailing whitespace',
      exitCode: 2,
      timedOut: false,
    });
    const checker = new CustomChecker(sandbox, dummyCompiled, workDir);
    const result = await checker.check('', '', '  ');
    expect(result.verdict).toBe(Verdict.PE);
    expect(result.message).toBe('trailing whitespace');
  });

  it('超时 → SE', async () => {
    const { sandbox } = mockSandbox({
      stdout: '',
      stderr: '',
      exitCode: -1,
      timedOut: true,
    });
    const checker = new CustomChecker(sandbox, dummyCompiled, workDir);
    const result = await checker.check('1 2', '3', '3');
    expect(result.verdict).toBe(Verdict.SE);
    expect(result.message).toContain('超时');
  });

  it('未知退出码 → SE (checker 崩溃)', async () => {
    const { sandbox } = mockSandbox({
      stdout: '',
      stderr: 'segfault',
      exitCode: 139,
      timedOut: false,
    });
    const checker = new CustomChecker(sandbox, dummyCompiled, workDir);
    const result = await checker.check('1 2', '3', '3');
    expect(result.verdict).toBe(Verdict.SE);
    expect(result.message).toContain('139');
    expect(result.message).toContain('segfault');
  });

  it('写入 input/expected/actual 文件到 workDir', async () => {
    const { sandbox } = mockSandbox({
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });
    const checker = new CustomChecker(sandbox, dummyCompiled, workDir);
    await checker.check('my input', 'expected out', 'actual out');

    const input = await fs.readFile(path.join(workDir, 'input.txt'), 'utf-8');
    const expected = await fs.readFile(path.join(workDir, 'expected.txt'), 'utf-8');
    const actual = await fs.readFile(path.join(workDir, 'actual.txt'), 'utf-8');

    expect(input).toBe('my input');
    expect(expected).toBe('expected out');
    expect(actual).toBe('actual out');
  });

  it('传递文件路径作为 checker 参数', async () => {
    const { sandbox, lastRequest } = mockSandbox({
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });
    const checker = new CustomChecker(sandbox, dummyCompiled, workDir);
    await checker.check('in', 'exp', 'act');

    const req = lastRequest()!;
    expect(req.compiled.args).toContain(path.join(workDir, 'input.txt'));
    expect(req.compiled.args).toContain(path.join(workDir, 'expected.txt'));
    expect(req.compiled.args).toContain(path.join(workDir, 'actual.txt'));
  });

  it('exit code 2 无 stderr → 默认 "Presentation Error"', async () => {
    const { sandbox } = mockSandbox({
      stdout: '',
      stderr: '',
      exitCode: 2,
      timedOut: false,
    });
    const checker = new CustomChecker(sandbox, dummyCompiled, workDir);
    const result = await checker.check('', '', '');
    expect(result.verdict).toBe(Verdict.PE);
    expect(result.message).toBe('Presentation Error');
  });

  it('截断超过 1000 字符的 checker 消息', async () => {
    const longMessage = 'A'.repeat(1500);
    const { sandbox } = mockSandbox({
      stdout: '',
      stderr: longMessage,
      exitCode: 1,
      timedOut: false,
    });
    const checker = new CustomChecker(sandbox, dummyCompiled, workDir);
    const result = await checker.check('', '', '');
    expect(result.verdict).toBe(Verdict.WA);
    expect(result.message!.length).toBeLessThanOrEqual(1004); // 1000 + '...'
    expect(result.message).toContain('...');
  });

  it('stdout 作为 fallback message（无 stderr 时）', async () => {
    const { sandbox } = mockSandbox({
      stdout: 'checker stdout message',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });
    const checker = new CustomChecker(sandbox, dummyCompiled, workDir);
    const result = await checker.check('', '', '');
    expect(result.verdict).toBe(Verdict.AC);
    expect(result.message).toBe('checker stdout message');
  });
});
