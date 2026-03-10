/**
 * 沙箱抽象接口
 *
 * 所有沙箱实现（nsjail、direct spawn）都遵循此接口。
 * 策略层和用例层只依赖此接口，不关心底层如何隔离。
 */

import { CompiledBot, ResourceLimit } from '../../domain/bot';

/** 沙箱执行结果 */
export interface SandboxResult {
  /** 标准输出 */
  stdout: string;
  /** 标准错误 */
  stderr: string;
  /** 退出码 */
  exitCode: number;
  /** 是否超时 */
  timedOut: boolean;
  /** 峰值内存使用（KB），沙箱可选提供 */
  memoryKb?: number;
}

/** 沙箱执行请求 */
export interface SandboxRequest {
  /** 编译产物 */
  compiled: CompiledBot;
  /** 工作目录 */
  workDir: string;
  /** 资源限制 */
  limit: ResourceLimit;
  /** 标准输入 */
  stdin?: string;
}

/** NestJS DI token */
export const SANDBOX_TOKEN = Symbol('ISandbox');

/** 最大 stdout/stderr 输出大小（16MB），防止 OOM */
export const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

/**
 * 沙箱接口
 *
 * 实现：
 * - NsjailSandbox：生产环境，通过 nsjail 隔离
 * - DirectSandbox：开发/测试环境，直接 spawn 子进程
 */
export interface ISandbox {
  /** 在沙箱中执行程序 */
  execute(request: SandboxRequest): Promise<SandboxResult>;
}
