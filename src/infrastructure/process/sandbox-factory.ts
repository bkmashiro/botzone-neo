/**
 * ISandboxFactory — 沙箱工厂接口
 *
 * 策略/用例层通过此接口获取可执行的 Job，
 * 不直接依赖具体的 JailedJob 或 DirectJob。
 */

import { IJob } from './jobs/job.interface';
import { RunInput, RunOutput } from './process-io';
import { Measured } from './resource-usage';
import { RunJob } from './jobs/run.job';
import { MeasuredJob } from './decorators/measured.job';
import { JailedJob, JailConfig } from './decorators/jailed.job';
import { DirectJob } from './decorators/direct.job';

/** 沙箱配置（由调用方提供） */
export interface SandboxConfig {
  /** 时间限制（毫秒） */
  timeoutMs: number;
  /** 内存限制（MB） */
  memoryMb: number;
  /** 额外只读挂载 */
  readonlyMounts?: string[];
  /** 工作目录 */
  workDir: string;
}

/** 沙箱工厂：创建具备沙箱+度量能力的 RunJob */
export interface ISandboxFactory {
  create(config: SandboxConfig): IJob<RunInput, Measured<RunOutput>>;
}

/** nsjail 工厂（生产环境） */
export class NsjailSandboxFactory implements ISandboxFactory {
  constructor(private readonly nsjailPath: string = '/usr/bin/nsjail') {}

  create(config: SandboxConfig): IJob<RunInput, Measured<RunOutput>> {
    const jailConfig: JailConfig = {
      nsjailPath: this.nsjailPath,
      timeLimitSec: Math.ceil(config.timeoutMs / 1000),
      memoryLimitMb: config.memoryMb,
      readonlyMounts: config.readonlyMounts,
      sandboxWorkDir: config.workDir,
    };
    return new MeasuredJob(new JailedJob(new RunJob(), jailConfig));
  }
}

/** 直接执行工厂（开发/测试环境） */
export class DirectSandboxFactory implements ISandboxFactory {
  create(_config: SandboxConfig): IJob<RunInput, Measured<RunOutput>> {
    return new MeasuredJob(new DirectJob(new RunJob()));
  }
}
