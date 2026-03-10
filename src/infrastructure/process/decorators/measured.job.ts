/**
 * MeasuredJob — 资源度量装饰器
 *
 * 包装任意 IJob，附加 ResourceUsage（时间/内存）。
 * 用法：new MeasuredJob(innerJob)
 */

import { IJob } from '../jobs/job.interface';
import { Measured, ResourceUsage } from '../resource-usage';

/**
 * 度量装饰器：为任意 Job 的执行结果附加资源消耗数据
 */
export class MeasuredJob<TIn, TOut> implements IJob<TIn, Measured<TOut>> {
  constructor(private readonly inner: IJob<TIn, TOut>) {}

  async execute(input: TIn): Promise<Measured<TOut>> {
    const startTime = process.hrtime.bigint();
    const startMemory = process.memoryUsage().rss;

    const result = await this.inner.execute(input);

    const elapsed = Number(process.hrtime.bigint() - startTime) / 1e6; // 纳秒 → 毫秒
    const memDelta = Math.max(0, process.memoryUsage().rss - startMemory);

    const usage: ResourceUsage = {
      timeMs: Math.round(elapsed * 100) / 100,
      memoryKb: Math.round(memDelta / 1024),
    };

    return { result, usage };
  }
}
