/**
 * CheckerStrategy — Special Judge 判题
 *
 * 运行 checker 程序，将 {input, expected, actual} 传给它，
 * 由 checker 程序决定 AC/WA。
 */

import { Verdict } from '../../domain/verdict';
import { CheckerInput, CheckerOutput } from '../../domain/oj/checker';
import { CompiledArtifact } from '../../infrastructure/process/jobs/compile.job.types';
import { ISandboxFactory, SandboxConfig } from '../../infrastructure/process/sandbox-factory';
import { RunInput } from '../../infrastructure/process/process-io';

/** Checker 策略配置 */
export interface CheckerConfig {
  /** checker 编译产物 */
  artifact: CompiledArtifact;
  /** checker 工作目录 */
  workDir: string;
  /** checker 时间限制（毫秒） */
  timeoutMs: number;
  /** checker 内存限制（MB） */
  memoryMb: number;
}

/**
 * Special Judge 策略：运行 checker 程序判题
 */
export class CheckerStrategy {
  constructor(private readonly sandboxFactory: ISandboxFactory) {}

  /**
   * 运行 checker 判题
   *
   * @param input checker 的输入（标准输入 + 期望输出 + 实际输出）
   * @param config checker 配置
   * @returns 判题结果
   */
  async judge(input: CheckerInput, config: CheckerConfig): Promise<CheckerOutput> {
    const sandboxConfig: SandboxConfig = {
      timeoutMs: config.timeoutMs,
      memoryMb: config.memoryMb,
      readonlyMounts: config.artifact.readonlyMounts,
      workDir: config.workDir,
    };

    const job = this.sandboxFactory.create(sandboxConfig);

    // 将三部分数据通过 stdin 传给 checker（JSON 格式）
    const stdinData = JSON.stringify(input);

    const runInput: RunInput = {
      cmd: config.artifact.cmd,
      args: config.artifact.args,
      cwd: config.workDir,
      stdin: stdinData,
      timeoutMs: config.timeoutMs,
    };

    const { result } = await job.execute(runInput);

    // checker 超时或崩溃视为系统错误
    if (result.timedOut) {
      return { verdict: Verdict.SE, message: 'Checker 超时' };
    }

    if (result.exitCode !== 0) {
      return { verdict: Verdict.SE, message: `Checker 异常退出 (code=${result.exitCode})` };
    }

    // 解析 checker 输出
    const firstLine = result.stdout.trim().split('\n')[0] ?? '';
    try {
      return JSON.parse(firstLine) as CheckerOutput;
    } catch {
      // 兼容：首行 AC/WA 作为判定
      const token = firstLine.trim().toUpperCase();
      if (token === 'AC' || token === 'ACCEPTED') {
        return { verdict: Verdict.AC };
      }
      return { verdict: Verdict.WA, message: firstLine };
    }
  }
}
