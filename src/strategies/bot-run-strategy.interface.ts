/**
 * Bot 运行策略接口
 *
 * 不同策略决定 Bot 进程的生命周期管理方式。
 * 实现只关心"给我一个沙箱，我来控制输入输出"，
 * 不依赖 NestJS、不依赖文件系统。
 */

import { BotRuntime, BotInput, BotOutput } from '../domain/bot';

export interface IBotRunStrategy {
  /** 执行一轮 Bot 运行（legacy: 全历史 BotInput JSON 作为 stdin） */
  runRound(bot: BotRuntime, input: BotInput): Promise<BotOutput>;

  /**
   * 执行一轮 Bot 运行（user-judge 协议：直接以 stdin 字符串驱动，不包装历史）
   * 用于 executeWithUserJudge：每轮只把当前回合命令发给 bot，bot 读一行输出一行。
   */
  runRoundRaw(bot: BotRuntime, stdin: string): Promise<BotOutput>;

  /** 单轮结束后的清理 */
  afterRound(bot: BotRuntime): Promise<void>;

  /** 整场对局结束后的资源释放 */
  cleanup(bot: BotRuntime): Promise<void>;
}
