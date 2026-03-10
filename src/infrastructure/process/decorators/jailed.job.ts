/**
 * JailedJob — nsjail 沙箱装饰器
 *
 * 包装 RunJob，将执行命令转换为 nsjail 命令，
 * 实现资源隔离（时间/内存/文件系统/网络）。
 */

import { IJob } from '../jobs/job.interface';
import { RunInput, RunOutput } from '../process-io';

/** nsjail 沙箱配置 */
export interface JailConfig {
  /** nsjail 可执行文件路径 */
  nsjailPath: string;
  /** 时间限制（秒，nsjail 内部用） */
  timeLimitSec: number;
  /** 内存限制（MB） */
  memoryLimitMb: number;
  /** 额外只读挂载路径 */
  readonlyMounts?: string[];
  /** 工作目录（沙箱内可写） */
  sandboxWorkDir: string;
}

/**
 * 沙箱装饰器：将执行命令包裹在 nsjail 中运行
 */
export class JailedJob implements IJob<RunInput, RunOutput> {
  constructor(
    private readonly inner: IJob<RunInput, RunOutput>,
    private readonly config: JailConfig,
  ) {}

  async execute(input: RunInput): Promise<RunOutput> {
    // 构建 nsjail 参数，将原始命令包裹在沙箱中
    const nsjailArgs = this.buildNsjailArgs(input);

    const jailedInput: RunInput = {
      cmd: this.config.nsjailPath,
      args: nsjailArgs,
      cwd: input.cwd,
      stdin: input.stdin,
      timeoutMs: input.timeoutMs + 5000, // 比 nsjail 自身限制多 5 秒余量
    };

    return this.inner.execute(jailedInput);
  }

  /** 构建 nsjail 命令行参数 */
  private buildNsjailArgs(input: RunInput): string[] {
    const args: string[] = [
      '--mode', 'o',                                   // 一次性模式
      '--time_limit', String(this.config.timeLimitSec),
      '--rlimit_as', String(this.config.memoryLimitMb),
      '--rlimit_cpu', String(this.config.timeLimitSec),
      '--rlimit_fsize', '64',                          // 输出文件限制（MB）
      '--rlimit_nofile', '64',                          // 文件描述符限制

      // 基础只读挂载
      '--mount', '/bin:/bin:ro',
      '--mount', '/lib:/lib:ro',
      '--mount', '/lib64:/lib64:ro',
      '--mount', '/usr:/usr:ro',

      // 工作目录（可写）
      '--mount', `${this.config.sandboxWorkDir}:/workspace:rw`,
      '--cwd', '/workspace',

      // 网络隔离
      '--disable_clone_newnet',

      // 用户映射
      '--uid_mapping', '0:65534:1',
      '--gid_mapping', '0:65534:1',
    ];

    // 额外只读挂载
    if (this.config.readonlyMounts) {
      for (const mount of this.config.readonlyMounts) {
        args.push('--mount', `${mount}:${mount}:ro`);
      }
    }

    // 被执行的命令
    args.push('--', input.cmd, ...input.args);

    return args;
  }
}
