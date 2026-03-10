/**
 * ProcessIO — 进程输入输出定义
 *
 * 描述向子进程写入 stdin 并读取 stdout/stderr 的配置。
 */

/** 进程执行的输入参数 */
export interface RunInput {
  /** 执行命令 */
  cmd: string;
  /** 执行参数 */
  args: string[];
  /** 工作目录 */
  cwd: string;
  /** 写入 stdin 的内容 */
  stdin: string;
  /** 超时（毫秒） */
  timeoutMs: number;
}

/** 进程执行的原始输出 */
export interface RunOutput {
  /** 标准输出 */
  stdout: string;
  /** 标准错误 */
  stderr: string;
  /** 退出码 */
  exitCode: number;
  /** 是否超时 */
  timedOut: boolean;
}
