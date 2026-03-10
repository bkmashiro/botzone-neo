/**
 * LongrunStrategy — 长时运行策略（骨架 + TODO）
 *
 * 首轮启动进程后保持运行，每轮通过 SIGCONT 唤醒，
 * 写入当轮输入，读取输出后 SIGSTOP。对局结束时 SIGKILL。
 *
 * 适用于需要在多轮间保持状态的 Bot（如 MCTS）。
 */

import { BotInput, BotOutput } from '../../domain/bot';
import { ResourceUsage } from '../../infrastructure/process/resource-usage';
import { BotRuntimeCtx, RoundResult } from './restart.strategy';

/**
 * 长时运行策略（TODO: 未实现）
 */
export class LongrunStrategy {
  // TODO: 持有 ChildProcess 引用
  // private readonly processes: Map<string, ChildProcess> = new Map();

  async runRound(_ctx: BotRuntimeCtx, _input: BotInput): Promise<RoundResult> {
    // TODO: 实现 SIGCONT + stdin/stdout 交互
    const usage: ResourceUsage = { timeMs: 0, memoryKb: 0 };
    return {
      output: { response: '' },
      usage,
    };
  }

  async cleanup(_ctx: BotRuntimeCtx): Promise<void> {
    // TODO: SIGKILL 所有持有的进程
  }
}
