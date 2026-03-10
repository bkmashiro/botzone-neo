/**
 * StandardStrategy — 标准 diff 判题
 *
 * 逐行比较选手输出与标准答案（忽略末尾空白）。
 * 用于常规 OJ 题目的评测。
 */

import { Verdict } from '../../domain/verdict';

/** 标准判题结果 */
export interface JudgeResult {
  verdict: Verdict;
  message?: string;
}

/**
 * 标准 diff 判题：比较实际输出与期望输出
 */
export class StandardStrategy {
  /**
   * 比较选手输出与标准答案
   *
   * @param actual 选手程序的实际输出
   * @param expected 标准答案
   * @returns 判题结果
   */
  judge(actual: string, expected: string): JudgeResult {
    const actualLines = this.normalizeOutput(actual);
    const expectedLines = this.normalizeOutput(expected);

    if (actualLines.length !== expectedLines.length) {
      return {
        verdict: Verdict.WA,
        message: `行数不匹配: 期望 ${expectedLines.length} 行, 实际 ${actualLines.length} 行`,
      };
    }

    for (let i = 0; i < expectedLines.length; i++) {
      if (actualLines[i] !== expectedLines[i]) {
        return {
          verdict: Verdict.WA,
          message: `第 ${i + 1} 行不匹配`,
        };
      }
    }

    return { verdict: Verdict.AC };
  }

  /** 规范化输出：去除末尾空行和每行末尾空白 */
  private normalizeOutput(output: string): string[] {
    const lines = output.split('\n').map(line => line.trimEnd());
    // 去除末尾空行
    while (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }
    return lines;
  }
}
