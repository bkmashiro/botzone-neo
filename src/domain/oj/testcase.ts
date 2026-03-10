/**
 * OJ Testcase 领域对象
 *
 * 纯领域对象，零依赖。
 * 描述 OJ 评测中的一个测试用例。
 */

/** 单个测试用例 */
export interface Testcase {
  /** 用例编号（从 1 开始） */
  id: number;
  /** 输入数据 */
  input: string;
  /** 期望输出（标准答案） */
  expectedOutput: string;
  /** 本用例的时间限制（毫秒），未设置则使用全局限制 */
  timeLimitMs?: number;
  /** 本用例的内存限制（MB），未设置则使用全局限制 */
  memoryLimitMb?: number;
}

/** OJ 评测任务定义 */
export interface OJTask {
  type: 'oj';
  /** 提交的代码语言 */
  language: string;
  /** 提交的源代码 */
  source: string;
  /** 测试用例列表 */
  testcases: Testcase[];
  /** 全局时间限制（毫秒） */
  timeLimitMs: number;
  /** 全局内存限制（MB） */
  memoryLimitMb: number;
  /** 回调地址 */
  callback: {
    finish: string;
  };
  /** 判题模式 */
  judgeMode: 'standard' | 'checker';
  /** special judge 的代码（judgeMode === 'checker' 时必填） */
  checkerSource?: string;
  /** special judge 的语言 */
  checkerLanguage?: string;
}

/** 单个用例的评测结果 */
export interface TestcaseResult {
  /** 用例编号 */
  id: number;
  /** 评测结果 */
  verdict: string;
  /** 实际输出 */
  actualOutput?: string;
  /** 用时（毫秒） */
  timeMs?: number;
  /** 内存（KB） */
  memoryKb?: number;
  /** 附加信息 */
  message?: string;
}

/** OJ 评测最终结果 */
export interface OJResult {
  /** 总体评测结果 */
  verdict: string;
  /** 各用例的结果 */
  testcases: TestcaseResult[];
  /** 编译信息 */
  compile: { verdict: string; message?: string };
}
