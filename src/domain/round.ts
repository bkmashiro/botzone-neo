/**
 * Round 领域对象
 *
 * 纯领域对象，零依赖。
 * 表示 Botzone 对局中的一个回合。
 */

/** 裁判输出：决定本轮要做什么 */
export interface JudgeCommand {
  /** 指令类型：request 继续对局 / finish 结束对局 */
  command: 'request' | 'finish';
  /** 内容：每个 bot 的请求（request 时）或分数（finish 时） */
  content: Record<string, string | number>;
  /** 展示信息（前端展示用） */
  display?: unknown;
  /** 初始数据（仅首轮裁判输出时使用） */
  initdata?: string | object;
}

/** 一轮回合的记录 */
export interface RoundRecord {
  /** 回合编号（从 1 开始） */
  roundNumber: number;
  /** 裁判输出 */
  judgeCommand: JudgeCommand;
  /** 各 Bot 本轮的响应 */
  botResponses: Record<string, string>;
}
