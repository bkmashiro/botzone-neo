/**
 * RestartStrategy — 官方协议：每轮重启进程 + 完整历史 JSON
 *
 * 每轮启动新的沙箱进程，通过 stdin 传入完整历史 JSON（官方协议格式），
 * 从 stdout 读取单行 JSON 输出。进程结束即释放。
 *
 * 使用 ISandboxFactory 创建可运行的 Job，不直接管理进程。
 */

import { BotInput, BotOutput, CompiledArtifact } from '../../domain/bot';
import { ResourceLimit } from '../../domain/bot';
import { ISandboxFactory, SandboxConfig } from '../../infrastructure/process/sandbox-factory';
import { RunInput } from '../../infrastructure/process/process-io';
import { ResourceUsage } from '../../infrastructure/process/resource-usage';

/** Bot 运行时上下文（策略层使用） */
export interface BotRuntimeCtx {
  /** Bot 标识 */
  id: string;
  /** 编译产物 */
  artifact: CompiledArtifact;
  /** 工作目录 */
  workDir: string;
  /** 资源限制 */
  limit: ResourceLimit;
}

/** 策略执行一轮的返回 */
export interface RoundResult {
  /** Bot 输出 */
  output: BotOutput;
  /** 资源消耗 */
  usage: ResourceUsage;
}

/**
 * 重启策略（默认策略）
 *
 * 每轮启动新进程 → 写入完整历史 → 读取输出 → 进程退出
 */
export class RestartStrategy {
  constructor(private readonly sandboxFactory: ISandboxFactory) {}

  /** 执行一轮 Bot 运行 */
  async runRound(ctx: BotRuntimeCtx, input: BotInput): Promise<RoundResult> {
    const inputJson = JSON.stringify(input);

    const sandboxConfig: SandboxConfig = {
      timeoutMs: ctx.limit.timeMs,
      memoryMb: ctx.limit.memoryMb,
      readonlyMounts: ctx.artifact.readonlyMounts,
      workDir: ctx.workDir,
    };

    const job = this.sandboxFactory.create(sandboxConfig);

    const runInput: RunInput = {
      cmd: ctx.artifact.cmd,
      args: ctx.artifact.args,
      cwd: ctx.workDir,
      stdin: inputJson,
      timeoutMs: ctx.limit.timeMs,
    };

    const { result, usage } = await job.execute(runInput);

    // 超时
    if (result.timedOut) {
      return {
        output: {
          response: '',
          debug: `TLE: 超过时间限制 ${ctx.limit.timeMs}ms`,
        },
        usage,
      };
    }

    // 非零退出
    if (result.exitCode !== 0) {
      return {
        output: {
          response: '',
          debug: result.stderr || `进程异常退出 (code=${result.exitCode})`,
        },
        usage,
      };
    }

    // 解析第一行 JSON 输出
    const firstLine = result.stdout.trim().split('\n')[0] ?? '';
    try {
      const parsed = JSON.parse(firstLine) as BotOutput;
      return {
        output: {
          response: parsed.response ?? '',
          debug: parsed.debug,
          data: parsed.data,
          globaldata: parsed.globaldata,
        },
        usage,
      };
    } catch {
      // 兼容：非 JSON 输出整行作为 response
      return {
        output: { response: firstLine },
        usage,
      };
    }
  }
}
