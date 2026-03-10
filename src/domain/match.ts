/**
 * Match 领域对象
 *
 * 纯领域对象，零依赖。
 * 表示一局 Botzone 评测的完整生命周期。
 */

import { Verdict } from './verdict';
import { BotSpec } from './bot';
import { RoundRecord } from './round';

/** 评测任务类型 */
export type TaskType = 'botzone' | 'oj';

/** 运行模式（Botzone 专用） */
export type RunMode = 'restart' | 'longrun';

/** 回调地址 */
export interface CallbackUrls {
  /** 每轮进度更新回调 */
  update: string;
  /** 对局结束回调 */
  finish: string;
}

/** Botzone 对局任务定义 */
export interface MatchTask {
  type: 'botzone';
  /** 对局中各参与者的代码 */
  bots: BotSpec[];
  /** 回调地址 */
  callback: CallbackUrls;
  /** 对局初始化数据 */
  initdata?: string;
  /** 运行模式 */
  runMode: RunMode;
}

/** 编译结果汇总（每个 bot 的编译状态） */
export interface CompileSummary {
  botId: string;
  verdict: Verdict;
  message?: string;
}

/** 对局最终结果 */
export interface MatchResult {
  /** 各参与者分数 */
  scores: Record<string, number>;
  /** 对局回合记录 */
  log: RoundRecord[];
  /** 编译结果汇总 */
  compiles: CompileSummary[];
}

/** 最大对局轮数（安全上限） */
export const MAX_ROUNDS = 1000;
