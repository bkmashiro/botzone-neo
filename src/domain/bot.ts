/**
 * Bot 领域对象
 *
 * 纯领域对象，零依赖。
 * 表示一局对局中的一个参与者（玩家或裁判）。
 */

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
  /** 源代码 */
  source: string;
  /** 资源限制 */
  limit: ResourceLimit;
}

/** 编译产物：描述如何运行一个已编译的程序 */
export interface CompiledArtifact {
  /** 执行命令（如 /path/to/binary 或 python3） */
  cmd: string;
  /** 执行参数（如 [] 或 ['/path/to/source.py']） */
  args: string[];
  /** 编程语言标识 */
  language: string;
  /** 沙箱中需要额外挂载的只读路径 */
  readonlyMounts: string[];
  /** 编译产物所在目录 */
  workDir: string;
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
