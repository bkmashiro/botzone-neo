/**
 * Testcase 领域对象（OJ 专用）
 *
 * 纯领域对象，零依赖。
 */

import { ResourceLimit } from '../bot';

/** 单个测试用例 */
export interface Testcase {
  /** 测试用例编号 */
  id: number;
  /** 标准输入 */
  input: string;
  /** 标准输出（期望答案） */
  expectedOutput: string;
}

/** OJ 评测任务定义 */
export interface OJTask {
  type: 'oj';
  /** 编程语言 */
  language: string;
  /** 源代码 */
  source: string;
  /** 资源限制 */
  limit: ResourceLimit;
  /** 测试用例列表 */
  testcases: Testcase[];
  /** 回调地址 */
  callback: {
    finish: string;
  };
  /** Special Judge 代码（可选，默认 diff 比较） */
  checker?: {
    language: string;
    source: string;
  };
}

/** 单个测试用例的评测结果 */
export interface TestcaseResult {
  /** 测试用例编号 */
  id: number;
  /** 评测结果 */
  verdict: string;
  /** 实际输出 */
  actualOutput?: string;
  /** 耗时（毫秒） */
  timeMs?: number;
  /** 内存使用（MB） */
  memoryMb?: number;
  /** 错误信息 */
  message?: string;
}

/** OJ 评测最终结果 */
export interface OJResult {
  /** 总体评测结果 */
  verdict: string;
  /** 各测试用例结果 */
  testcases: TestcaseResult[];
  /** 编译信息 */
  compileMessage?: string;
}
