import { Injectable, Logger } from '@nestjs/common';
import { spawn, ChildProcess } from 'child_process';
import { NsjailOptions, buildNsjailArgs } from './nsjail.config';

/** nsjail 执行结果 */
export interface SandboxResult {
  /** 标准输出 */
  stdout: string;
  /** 标准错误 */
  stderr: string;
  /** 退出码 */
  exitCode: number;
  /** 是否超时 */
  timedOut: boolean;
}

/**
 * nsjail 沙箱服务
 *
 * 封装 nsjail 进程的创建和管理
 */
@Injectable()
export class NsjailService {
  private readonly logger = new Logger(NsjailService.name);
  private readonly nsjailPath = '/usr/bin/nsjail';

  /**
   * 在沙箱中执行程序
   * @param opts 沙箱配置
   * @param stdin 标准输入内容
   * @returns 执行结果
   */
  async execute(opts: NsjailOptions, stdin?: string): Promise<SandboxResult> {
    const args = buildNsjailArgs(opts);
    this.logger.debug(`启动 nsjail: ${this.nsjailPath} ${args.join(' ')}`);

    return new Promise((resolve, reject) => {
      const child: ChildProcess = spawn(this.nsjailPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      // 超时保护（比 nsjail 自带的 time_limit 多 5 秒作为余量）
      const timeoutMs = (opts.timeLimit + 5) * 1000;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          stdout,
          stderr,
          exitCode: code ?? -1,
          timedOut,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      // 写入 stdin
      if (stdin) {
        child.stdin?.write(stdin);
      }
      child.stdin?.end();
    });
  }
}
