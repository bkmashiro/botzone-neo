/**
 * 评测核心类型定义
 */

/** 评测结果枚举 */
export type Verdict = 'OK' | 'TLE' | 'MLE' | 'RE' | 'CE' | 'NJ' | 'SE' | 'NR';

/** 资源限制 */
export interface Limit {
  /** 时间限制（毫秒） */
  time: number;
  /** 内存限制（MB） */
  memory: number;
}

/** 代码描述 */
export interface Code {
  /** 编程语言：cpp / python / typescript */
  language: string;
  /** 源代码内容 */
  source: string;
  /** 资源限制 */
  limit: Limit;
}

/** 对局定义：key 为 "judger" | "0" | "1" | ... */
export type Game = Record<string, Code>;

/** 回调地址 */
export interface Callback {
  /** 每轮更新回调 */
  update: string;
  /** 对局结束回调 */
  finish: string;
}

/** 评测任务 */
export interface Task {
  /** 对局中各参与者的代码 */
  game: Game;
  /** 回调地址 */
  callback: Callback;
  /** 对局初始化数据 */
  initdata?: string | object;
  /** 运行模式：restart（默认，每轮重启）| longrun（常驻进程） */
  runMode?: 'restart' | 'longrun';
}

/** Bot 输入（官方协议：完整历史） */
export interface BotInput {
  /** 历史请求列表 */
  requests: string[];
  /** 历史响应列表 */
  responses: string[];
  /** 本局持久化数据 */
  data: string;
  /** 全局持久化数据 */
  globaldata: string;
  /** 时间限制（毫秒） */
  time_limit: number;
  /** 内存限制（MB） */
  memory_limit: number;
}

/** Bot 输出 */
export interface BotOutput {
  /** 本轮响应 */
  response: string;
  /** 调试信息 */
  debug?: string;
  /** 运行时判定（TLE/RE/MLE 等，OK 或省略表示正常） */
  verdict?: Verdict;
  /** 本局持久化数据（更新） */
  data?: string;
  /** 全局持久化数据（更新） */
  globaldata?: string;
}

/** 裁判输出 */
export interface JudgeOutput {
  /** 指令类型：request 继续对局 / finish 结束对局 */
  command: 'request' | 'finish';
  /** 内容：每个 bot 的请求或分数 */
  content: Record<string, string | number>;
  /** 展示信息（前端展示用） */
  display: string | object;
  /** 初始数据（仅首轮裁判输出时使用） */
  initdata?: string | object;
}

/** Bot 上下文（策略模式使用） */
export interface BotContext {
  /** Bot 标识（"0" | "1" | ...） */
  id: string;
  /** 编程语言 */
  language: string;
  /** 执行命令 */
  execCmd: string;
  /** 执行参数（如 [] 或 ['/path/to/source.py']） */
  execArgs: string[];
  /** 工作目录 */
  workDir: string;
  /** 资源限制 */
  limit: Limit;
}

/** 编译结果 */
export interface CompileResult {
  /** 编译判定 */
  verdict: Verdict;
  /** 编译输出信息 */
  message?: string;
  /** 执行命令 */
  execCmd?: string;
  /** 执行参数 */
  execArgs?: string[];
}

/** 对局结果 */
export interface GameResult {
  /** 各参与者分数 */
  scores: Record<string, number>;
  /** 对局日志 */
  log: unknown[];
  /** 编译结果 */
  compile: Record<string, { verdict: Verdict; message?: string }>;
}
