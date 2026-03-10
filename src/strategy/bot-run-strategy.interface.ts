import { BotContext, BotInput, BotOutput } from '../judge/types';

/**
 * Bot 运行策略接口（策略模式）
 *
 * 不同策略决定 Bot 进程的生命周期管理方式：
 * - restart：每轮重启进程，传入完整历史（官方协议）
 * - longrun：常驻进程，使用 SIGSTOP/SIGCONT 控制（未来扩展）
 */
export interface IBotRunStrategy {
  /** 执行一轮 Bot 运行 */
  runRound(botCtx: BotContext, input: BotInput): Promise<BotOutput>;

  /** 单轮结束后的清理（如杀掉进程等） */
  afterRound(botCtx: BotContext): Promise<void>;

  /** 整场对局结束后的资源释放 */
  cleanup(botCtx: BotContext): Promise<void>;
}
