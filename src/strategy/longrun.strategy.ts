import { Logger } from '@nestjs/common';
import { IBotRunStrategy } from './bot-run-strategy.interface';
import { BotContext, BotInput, BotOutput } from '../judge/types';

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
export class LongrunStrategy implements IBotRunStrategy {
  private readonly logger = new Logger(LongrunStrategy.name);

  async runRound(_botCtx: BotContext, _input: BotInput): Promise<BotOutput> {
    // TODO: 实现常驻进程的 SIGCONT + stdin/stdout 交互
    this.logger.warn('Longrun 策略尚未实现，返回空响应');
    return { response: '' };
  }

  async afterRound(_botCtx: BotContext): Promise<void> {
    // TODO: SIGSTOP 暂停进程
  }

  async cleanup(_botCtx: BotContext): Promise<void> {
    // TODO: SIGKILL 终止进程并清理资源
  }
}
