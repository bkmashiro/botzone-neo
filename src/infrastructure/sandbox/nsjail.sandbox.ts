/**
 * nsjail 沙箱实现（生产环境）
 *
 * 通过 nsjail 进程隔离执行用户代码。
 */

import { Injectable, Logger } from '@nestjs/common';
import { spawn, ChildProcess } from 'child_process';
import { ISandbox, SandboxRequest, SandboxResult } from './sandbox.interface';

@Injectable()
export class NsjailSandbox implements ISandbox {
  private readonly logger = new Logger(NsjailSandbox.name);
  private readonly nsjailPath = '/usr/bin/nsjail';

  async execute(request: SandboxRequest): Promise<SandboxResult> {
    const args = this.buildArgs(request);
    this.logger.debug(`nsjail: ${this.nsjailPath} ${args.join(' ')}`);

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

      // 超时保护（比 nsjail 自带 time_limit 多 5 秒作为余量）
      const timeLimitSec = Math.ceil(request.limit.timeMs / 1000);
      const timeoutMs = (timeLimitSec + 5) * 1000;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code ?? -1, timedOut });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      if (request.stdin) {
        child.stdin?.write(request.stdin);
      }
      child.stdin?.end();
    });
  }

  private buildArgs(request: SandboxRequest): string[] {
    const timeLimitSec = Math.ceil(request.limit.timeMs / 1000);

    const args: string[] = [
      '--mode', 'o',
      '--time_limit', String(timeLimitSec),
      '--rlimit_as', String(request.limit.memoryMb),
      '--rlimit_cpu', String(timeLimitSec),
      '--rlimit_fsize', '64',
      '--rlimit_nofile', '64',

      // 基础只读挂载
      '--mount', '/bin:/bin:ro',
      '--mount', '/lib:/lib:ro',
      '--mount', '/lib64:/lib64:ro',
      '--mount', '/usr:/usr:ro',

      // 工作目录（可写）
      '--mount', `${request.workDir}:/workspace:rw`,
      '--cwd', '/workspace',

      // 网络隔离
      '--disable_clone_newnet',

      // 用户映射
      '--uid_mapping', '0:65534:1',
      '--gid_mapping', '0:65534:1',
    ];

    // 语言特定的额外只读挂载
    for (const mount of request.compiled.readonlyMounts) {
      args.push('--mount', `${mount}:${mount}:ro`);
    }

    // 被执行的命令
    args.push('--', request.compiled.cmd, ...request.compiled.args);

    return args;
  }
}
