/**
 * Diff Checker — 标准逐行比较
 *
 * 忽略尾部空白，逐行比较期望输出和实际输出。
 * 纯函数实现，零依赖。
 */

import { Verdict } from '../../domain/verdict';
import { IChecker, CheckResult } from '../../domain/oj/checker';

export class DiffChecker implements IChecker {
  async check(
    _input: string,
    expectedOutput: string,
    actualOutput: string,
  ): Promise<CheckResult> {
    const expectedLines = this.normalizeLines(expectedOutput);
    const actualLines = this.normalizeLines(actualOutput);

    if (expectedLines.length !== actualLines.length) {
      return {
        verdict: Verdict.WA,
        message: `行数不匹配: 期望 ${expectedLines.length} 行, 实际 ${actualLines.length} 行`,
      };
    }

    for (let i = 0; i < expectedLines.length; i++) {
      if (expectedLines[i] !== actualLines[i]) {
        return {
          verdict: Verdict.WA,
          message: `第 ${i + 1} 行不匹配`,
        };
      }
    }

    return { verdict: Verdict.AC };
  }

  /** 标准化：按行分割，去掉每行尾部空白，去掉末尾空行 */
  private normalizeLines(text: string): string[] {
    const lines = text.split('\n').map(line => line.trimEnd());
    while (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }
    return lines;
  }
}
