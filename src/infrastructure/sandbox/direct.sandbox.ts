/**
 * 直接执行沙箱（开发/测试环境）
 *
 * 不走 nsjail，直接 spawn 子进程。
 * 开发环境不需要安装 nsjail 就能跑测试。
 */

import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { ISandbox, SandboxRequest, SandboxResult } from './sandbox.interface';

@Injectable()
export class DirectSandbox implements ISandbox {
  private readonly logger = new Logger(DirectSandbox.name);

  async execute(request: SandboxRequest): Promise<SandboxResult> {
    const { compiled, limit } = request;

    this.logger.debug(`direct: ${compiled.cmd} ${compiled.args.join(' ')}`);

    return new Promise((resolve, reject) => {
      const child = spawn(compiled.cmd, compiled.args, {
        cwd: request.workDir,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, limit.timeMs);

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code ?? -1, timedOut });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      // Ignore EPIPE: process may exit before consuming stdin
      child.stdin.on('error', () => {});

      if (request.stdin) {
        child.stdin.write(request.stdin);
      }
      child.stdin.end();
    });
  }
}
