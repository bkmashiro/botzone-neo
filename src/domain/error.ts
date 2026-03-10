/**
 * 领域错误类型
 *
 * 纯领域对象，零依赖。
 * 所有评测相关的错误都应该用这些类型表达，
 * 而不是返回 { verdict, message } 或到处 try/catch 返回 null。
 */

import { Verdict } from './verdict';

/** 评测错误基类 */
export abstract class JudgeError extends Error {
  abstract readonly verdict: Verdict;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** 编译错误 */
export class CompileError extends JudgeError {
  readonly verdict = Verdict.CE;

  constructor(
    message: string,
    /** 编译器原始输出 */
    readonly compilerOutput?: string,
  ) {
    super(message);
  }
}

/** 超时错误 */
export class TimeLimitError extends JudgeError {
  readonly verdict = Verdict.TLE;

  constructor(
    /** 时间限制（毫秒） */
    readonly limitMs: number,
  ) {
    super(`Time limit exceeded: ${limitMs}ms`);
  }
}

/** 内存超限错误 */
export class MemoryLimitError extends JudgeError {
  readonly verdict = Verdict.MLE;

  constructor(
    /** 内存限制（MB） */
    readonly limitMb: number,
  ) {
    super(`Memory limit exceeded: ${limitMb}MB`);
  }
}

/** 运行时错误 */
export class RuntimeError extends JudgeError {
  readonly verdict = Verdict.RE;

  constructor(
    message: string,
    /** 退出码 */
    readonly exitCode?: number,
  ) {
    super(message);
  }
}

/** 沙箱/系统错误（非用户代码引起） */
export class SandboxError extends JudgeError {
  readonly verdict = Verdict.SE;
}
