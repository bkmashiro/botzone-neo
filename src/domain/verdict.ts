/**
 * 评测结果枚举 + 错误类
 *
 * 纯领域对象，零依赖。
 */

/** 通用评测结果 */
export enum Verdict {
  /** 正常 */
  OK = 'OK',
  /** 编译错误 */
  CE = 'CE',
  /** 超时 */
  TLE = 'TLE',
  /** 内存超限 */
  MLE = 'MLE',
  /** 运行时错误 */
  RE = 'RE',
  /** 沙箱错误（nsjail 自身问题） */
  SE = 'SE',
  /** 无结果（Bot 未给出有效输出） */
  NR = 'NR',
  /** 裁判格式错误 */
  NJ = 'NJ',
  /** 答案错误（OJ 专用） */
  WA = 'WA',
  /** 答案正确（OJ 专用） */
  AC = 'AC',
}

// ── 错误类 ──────────────────────────────────────────────

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

  constructor(readonly limitMs: number) {
    super(`Time limit exceeded: ${limitMs}ms`);
  }
}

/** 内存超限错误 */
export class MemoryLimitError extends JudgeError {
  readonly verdict = Verdict.MLE;

  constructor(readonly limitMb: number) {
    super(`Memory limit exceeded: ${limitMb}MB`);
  }
}

/** 运行时错误 */
export class RuntimeError extends JudgeError {
  readonly verdict = Verdict.RE;

  constructor(
    message: string,
    readonly exitCode?: number,
  ) {
    super(message);
  }
}

/** 裁判格式错误 */
export class JudgeFormatError extends JudgeError {
  readonly verdict = Verdict.NJ;
}

/** 沙箱/系统错误（非用户代码引起） */
export class SandboxError extends JudgeError {
  readonly verdict = Verdict.SE;
}
