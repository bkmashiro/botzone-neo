/**
 * OJ Checker 领域对象
 *
 * 纯领域对象，零依赖。
 * 描述 OJ 评测中 Checker（special judge）的输入输出协议。
 */

/** Checker 输入：传给 special judge 程序的数据 */
export interface CheckerInput {
  /** 测试用例的标准输入 */
  input: string;
  /** 期望输出（标准答案） */
  expectedOutput: string;
  /** 选手程序的实际输出 */
  actualOutput: string;
}

/** Checker 输出：special judge 的判定结果 */
export interface CheckerOutput {
  /** 评测结果：AC / WA / PE（Presentation Error） */
  verdict: string;
  /** 附加说明信息 */
  message?: string;
}
