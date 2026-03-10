/**
 * Bot 运行策略接口
 *
 * 不同策略决定 Bot 进程的生命周期管理方式。
 * 实现只关心"给我一个沙箱，我来控制输入输出"，
 * 不依赖 NestJS、不依赖文件系统。
 */

import { BotRuntime, BotInput, BotOutput } from '../domain/bot';

export interface IBotRunStrategy {
  /** 执行一轮 Bot 运行 */
  runRound(bot: BotRuntime, input: BotInput): Promise<BotOutput>;

  /** 单轮结束后的清理 */
  afterRound(bot: BotRuntime): Promise<void>;

  /** 整场对局结束后的资源释放 */
  cleanup(bot: BotRuntime): Promise<void>;
}
