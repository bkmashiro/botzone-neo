/**
 * Bot 领域对象
 *
 * 纯领域对象，零依赖。
 * 表示一局对局中的一个参与者（玩家或裁判）。
 */

/** Bot 编译状态 */
export enum CompileStatus {
  /** 尚未开始编译 */
  PENDING = 'pending',
  /** 正在编译 */
  COMPILING = 'compiling',
  /** 编译成功 */
  SUCCESS = 'success',
  /** 编译失败 */
  FAILED = 'failed',
}

/** 资源限制 */
export interface ResourceLimit {
  /** 时间限制（毫秒） */
  timeMs: number;
  /** 内存限制（MB） */
  memoryMb: number;
}

/** Bot 定义：来自评测任务的原始描述 */
export interface BotSpec {
  /** Bot 标识（"judger" | "0" | "1" | ...） */
  id: string;
  /** 编程语言 */
  language: string;
  /** 源代码（type=code 时必填） */
  source: string;
  /** 资源限制 */
  limit: ResourceLimit;
  /** Bot 类型：code（沙箱运行）| webhook（HTTP 调用外部服务） */
  runnerType?: 'code' | 'webhook';
  /** Webhook URL（runnerType=webhook 时必填） */
  externalUrl?: string;
  /** Webhook 超时（ms），默认 10000，最大 30000 */
  webhookTimeoutMs?: number;
}

/** 编译产物：描述如何运行一个已编译的程序 */
export interface CompiledBot {
  /** 执行命令（如 /path/to/binary 或 python3） */
  cmd: string;
  /** 执行参数（如 [] 或 ['/path/to/source.py']） */
  args: string[];
  /** 编程语言标识 */
  language: string;
  /** 沙箱中需要额外挂载的只读路径 */
  readonlyMounts: string[];
}

/** Bot 运行时状态：编译后、对局期间使用 */
export interface BotRuntime {
  /** Bot 标识 */
  id: string;
  /** 编译产物（type=code 时填充，webhook 时为占位值） */
  compiled: CompiledBot;
  /** 工作目录 */
  workDir: string;
  /** 资源限制 */
  limit: ResourceLimit;
  /** Bot 类型（默认 code） */
  runnerType?: 'code' | 'webhook';
  /** Webhook URL */
  externalUrl?: string;
  /** Webhook 超时 ms */
  webhookTimeoutMs?: number;
}

/** Bot 输入（发送给 Bot 进程的完整数据，官方协议 snake_case） */
export interface BotInput {
  /** 历史请求列表 */
  requests: string[];
  /** 历史响应列表 */
  responses: string[];
  /** 本局持久化数据 */
  data: string;
  /** 全局持久化数据 */
  globaldata: string;
  /** 时间限制（秒，协议要求） */
  time_limit: number;
  /** 内存限制（MB，协议要求） */
  memory_limit: number;
}

/** Bot 输出（从 Bot 进程读取的结果） */
export interface BotOutput {
  /** 本轮响应 */
  response: string;
  /** 调试信息 */
  debug?: string;
  /** 本局持久化数据（更新） */
  data?: string;
  /** 全局持久化数据（更新） */
  globaldata?: string;
}
