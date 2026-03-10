/**
 * Match 生命周期
 *
 * 纯领域对象，零依赖。
 * 管理对局的状态机：轮次计数、日志收集、结果生成。
 */

import { Verdict } from './verdict';
import { BotSpec } from './bot';

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
  /** 对局日志 */
  log: unknown[];
  /** 编译结果汇总 */
  compiles: CompileSummary[];
}

/** 最大对局轮数（安全上限） */
export const MAX_ROUNDS = 1000;

/**
 * Match 聚合根
 *
 * 负责对局的轮次推进、日志收集和结果生成。
 * 不涉及 I/O，纯状态管理。
 */
export class Match {
  private round = 0;
  private readonly log: unknown[] = [];
  private _finished = false;

  constructor(
    readonly task: MatchTask,
    readonly maxRounds: number = MAX_ROUNDS,
  ) {}

  get currentRound(): number {
    return this.round;
  }

  get isFinished(): boolean {
    return this._finished;
  }

  get hasRoundsLeft(): boolean {
    return this.round < this.maxRounds;
  }

  /** 推进到下一轮，返回新的轮次编号 */
  nextRound(): number {
    if (!this.hasRoundsLeft) {
      throw new Error('超过最大轮次限制');
    }
    return ++this.round;
  }

  /** 记录日志 */
  addLog(entry: unknown): void {
    this.log.push(entry);
  }

  /** 结束对局，返回最终结果 */
  finish(
    scores: Record<string, number>,
    compiles: CompileSummary[],
  ): MatchResult {
    this._finished = true;
    return { scores, log: [...this.log], compiles };
  }
}
