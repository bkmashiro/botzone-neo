/**
 * Custom Checker — Special Judge（Codeforces 格式）
 *
 * 运行用户提供的 checker 程序来判定答案是否正确。
 * 采用标准 Codeforces/testlib.h 格式：
 *
 * 调用方式：
 *   checker input_file expected_file actual_file
 *
 * 退出码约定（testlib.h 标准）：
 *   0 = AC（Accepted）
 *   1 = WA（Wrong Answer）
 *   2 = PE（Presentation Error）
 *   其他 / 崩溃 / 超时 = SE（System Error）
 *
 * checker 的判定信息通过 stderr 输出（testlib.h 默认行为）。
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import { Verdict } from '../../domain/verdict';
import { CompiledBot } from '../../domain/bot';
import { IChecker, CheckResult } from '../../domain/oj/checker';
import { ISandbox } from '../../infrastructure/sandbox/sandbox.interface';

/** Codeforces testlib.h 退出码 */
const EXIT_AC = 0;
const EXIT_WA = 1;
const EXIT_PE = 2;

export class CustomChecker implements IChecker {
  constructor(
    private readonly sandbox: ISandbox,
    private readonly compiled: CompiledBot,
    private readonly workDir: string,
  ) {}

  async check(input: string, expectedOutput: string, actualOutput: string): Promise<CheckResult> {
    // 将三个文件写入 checker 的工作目录
    const inputFile = path.join(this.workDir, 'input.txt');
    const expectedFile = path.join(this.workDir, 'expected.txt');
    const actualFile = path.join(this.workDir, 'actual.txt');

    await Promise.all([
      fs.writeFile(inputFile, input),
      fs.writeFile(expectedFile, expectedOutput),
      fs.writeFile(actualFile, actualOutput),
    ]);

    // 以 Codeforces 格式调用 checker: checker input expected actual
    // 使用相对路径（文件名），因为沙箱 CWD = workDir（nsjail 中为 /workspace）
    const checkerWithArgs: CompiledBot = {
      ...this.compiled,
      args: [...this.compiled.args, 'input.txt', 'expected.txt', 'actual.txt'],
    };

    const result = await this.sandbox.execute({
      compiled: checkerWithArgs,
      workDir: this.workDir,
      limit: { timeMs: 10000, memoryMb: 256 },
    });

    // checker 的判定信息通过 stderr 输出（testlib.h 标准）
    // 截断到 1000 字符，防止恶意 checker 注入大量日志
    const raw = result.stderr.trim() || result.stdout.trim() || '';
    const message = raw ? (raw.length > 1000 ? raw.slice(0, 1000) + '...' : raw) : undefined;

    // 超时 → SE
    if (result.timedOut) {
      return {
        verdict: Verdict.SE,
        message: 'Checker 超时',
      };
    }

    // 按退出码判定
    switch (result.exitCode) {
      case EXIT_AC:
        return { verdict: Verdict.AC, message };
      case EXIT_WA:
        return { verdict: Verdict.WA, message: message ?? 'Wrong Answer' };
      case EXIT_PE:
        return { verdict: Verdict.PE, message: message ?? 'Presentation Error' };
      default:
        // 未知退出码 = checker 崩溃 → SE
        return {
          verdict: Verdict.SE,
          message: `Checker 崩溃: exit code ${result.exitCode}${message ? `, ${message}` : ''}`,
        };
    }
  }
}
