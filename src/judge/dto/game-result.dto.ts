import { Verdict } from '../types';

/**
 * 对局结果 DTO
 */
export class GameResultDto {
  /** 各参与者分数 */
  scores!: Record<string, number>;

  /** 对局日志 */
  log!: unknown[];

  /** 编译结果 */
  compile!: Record<string, { verdict: Verdict; message?: string }>;
}
