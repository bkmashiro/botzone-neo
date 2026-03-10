/**
 * Checker 领域对象（OJ 专用）
 *
 * 纯领域对象，零依赖。
 * Checker 负责判定用户输出是否正确。
 */

import { Verdict } from '../verdict';

/** Checker 判定结果 */
export interface CheckResult {
  /** 判定：AC 或 WA */
  verdict: Verdict.AC | Verdict.WA;
  /** 判定信息 */
  message?: string;
}

/**
 * Checker 接口
 *
 * 两种实现：
 * - DiffChecker：忽略尾部空白的逐行比较
 * - CustomChecker：运行用户提供的 special judge 程序
 */
export interface IChecker {
  check(input: string, expectedOutput: string, actualOutput: string): Promise<CheckResult>;
}
