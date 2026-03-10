/**
 * 常驻进程策略（骨架实现）
 *
 * TODO: 实现 SIGSTOP/SIGCONT 机制
 * - 首轮启动进程后保持运行
 * - 每轮通过 SIGCONT 唤醒，写入当轮输入，读取输出后 SIGSTOP
 * - 对局结束时 SIGKILL
 *
 * 该策略适用于需要在多轮间保持状态的 Bot（如 Monte Carlo Tree Search）。
 */

import { BotRuntime, BotInput, BotOutput } from '../../domain/bot';
import { ISandbox } from '../../infrastructure/sandbox/sandbox.interface';
import { IBotRunStrategy } from '../bot-run-strategy.interface';

export class LongrunStrategy implements IBotRunStrategy {
  constructor(private readonly _sandbox: ISandbox) {}

  async runRound(_bot: BotRuntime, _input: BotInput): Promise<BotOutput> {
    // TODO: 实现常驻进程的 SIGCONT + stdin/stdout 交互
    throw new Error('Longrun 策略尚未实现');
  }

  async afterRound(_bot: BotRuntime): Promise<void> {
    // TODO: SIGSTOP 暂停进程
  }

  async cleanup(_bot: BotRuntime): Promise<void> {
    // TODO: SIGKILL 终止进程并清理资源
  }
}
