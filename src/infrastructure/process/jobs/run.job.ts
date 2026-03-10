/**
 * RunJob — CompiledArtifact → RunOutput
 *
 * 启动子进程，写入 stdin，读取 stdout/stderr，处理超时。
 * 这是最底层的进程执行器，不包含沙箱逻辑。
 */

import { spawn } from 'child_process';
import { IJob } from './job.interface';
import { RunInput, RunOutput } from '../process-io';

/**
 * 进程执行 Job：启动子进程并交互 stdin/stdout
 */
export class RunJob implements IJob<RunInput, RunOutput> {
  async execute(input: RunInput): Promise<RunOutput> {
    return new Promise((resolve, reject) => {
      const child = spawn(input.cmd, input.args, {
        cwd: input.cwd,
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

      // 超时处理
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, input.timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code ?? -1, timedOut });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      // 写入 stdin 并关闭
      if (input.stdin) {
        child.stdin.write(input.stdin);
      }
      child.stdin.end();
    });
  }
}
