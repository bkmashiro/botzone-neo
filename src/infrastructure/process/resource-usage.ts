/**
 * ResourceUsage — 进程资源消耗度量
 */

/** 资源消耗 */
export interface ResourceUsage {
  /** 实际用时（毫秒） */
  timeMs: number;
  /** 峰值内存（KB），0 表示未测量 */
  memoryKb: number;
}

/** 附加了资源度量的结果包装 */
export interface Measured<T> {
  /** 原始结果 */
  result: T;
  /** 资源消耗 */
  usage: ResourceUsage;
}
