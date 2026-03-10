/**
 * DirectJob — 直接执行装饰器（开发/测试用）
 *
 * 不经过 nsjail，直接透传给 RunJob。
 * 在开发环境或不需要沙箱隔离时使用。
 */

import { IJob } from '../jobs/job.interface';
import { RunInput, RunOutput } from '../process-io';

/**
 * 直接执行装饰器：透传给内部 Job，无沙箱
 */
export class DirectJob implements IJob<RunInput, RunOutput> {
  constructor(private readonly inner: IJob<RunInput, RunOutput>) {}

  async execute(input: RunInput): Promise<RunOutput> {
    return this.inner.execute(input);
  }
}
