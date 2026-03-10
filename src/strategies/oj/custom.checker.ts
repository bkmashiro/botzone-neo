/**
 * Custom Checker — Special Judge
 *
 * 运行用户提供的 checker 程序来判定答案是否正确。
 * 通过 ISandbox 执行，checker 接收 stdin 格式：
 *   第1行: input
 *   ---
 *   第2行: expectedOutput
 *   ---
 *   第3行: actualOutput
 *
 * checker 输出：
 *   第1行: "AC" 或 "WA"
 *   第2行(可选): message
 */

import { Verdict } from '../../domain/verdict';
import { CompiledBot } from '../../domain/bot';
import { IChecker, CheckResult } from '../../domain/oj/checker';
import { ISandbox } from '../../infrastructure/sandbox/sandbox.interface';

const CHECKER_SEPARATOR = '\n---\n';

export class CustomChecker implements IChecker {
  constructor(
    private readonly sandbox: ISandbox,
    private readonly compiled: CompiledBot,
    private readonly workDir: string,
  ) {}

  async check(
    input: string,
    expectedOutput: string,
    actualOutput: string,
  ): Promise<CheckResult> {
    const stdin = [input, expectedOutput, actualOutput].join(CHECKER_SEPARATOR);

    const result = await this.sandbox.execute({
      compiled: this.compiled,
      workDir: this.workDir,
      limit: { timeMs: 10000, memoryMb: 256 },
      stdin,
    });

    if (result.timedOut || result.exitCode !== 0) {
      return {
        verdict: Verdict.WA,
        message: `Checker 异常: ${result.stderr || `exit code ${result.exitCode}`}`,
      };
    }

    const lines = result.stdout.trim().split('\n');
    const verdictStr = (lines[0] ?? '').trim().toUpperCase();
    const message = lines[1]?.trim();

    if (verdictStr === 'AC') {
      return { verdict: Verdict.AC, message };
    }

    return { verdict: Verdict.WA, message: message ?? 'Wrong Answer' };
  }
}
