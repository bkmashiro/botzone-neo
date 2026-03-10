import { Logger } from '@nestjs/common';
import { IBotRunStrategy } from './bot-run-strategy.interface';
import { BotContext, BotInput, BotOutput } from '../judge/types';
import { spawn } from 'child_process';

/**
 * 重启策略（默认）
 *
 * 每轮启动新的沙箱进程，通过 stdin 传入完整历史 JSON（官方协议格式），
 * 从 stdout 读取单行 JSON 输出。
 */
export class RestartStrategy implements IBotRunStrategy {
  private readonly logger = new Logger(RestartStrategy.name);

  /** 执行一轮：启动新进程，写入 stdin，读取 stdout */
  async runRound(botCtx: BotContext, input: BotInput): Promise<BotOutput> {
    return new Promise((resolve, reject) => {
      const inputJson = JSON.stringify(input);
      const timeoutMs = botCtx.limit.time;

      // TODO: 在生产环境中通过 NsjailService 启动沙箱进程
      // 当前直接执行编译产物用于开发调试
      const child = spawn(botCtx.execPath, [], {
        cwd: botCtx.workDir,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      // 超时处理
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve({
          response: '',
          debug: `TLE: 超过时间限制 ${timeoutMs}ms`,
        });
      }, timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timer);

        if (code !== 0) {
          this.logger.warn(`Bot ${botCtx.id} 退出码: ${code}, stderr: ${stderr}`);
          resolve({
            response: '',
            debug: stderr || `进程异常退出 (code=${code})`,
          });
          return;
        }

        // 解析第一行 JSON 输出
        const firstLine = stdout.trim().split('\n')[0] ?? '';
        try {
          const output = JSON.parse(firstLine) as BotOutput;
          resolve({
            response: output.response ?? '',
            debug: output.debug,
            data: output.data,
            globaldata: output.globaldata,
          });
        } catch {
          // 兼容：如果输出不是 JSON，整行作为 response
          resolve({ response: firstLine });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      // 写入输入并关闭 stdin
      child.stdin.write(inputJson);
      child.stdin.end();
    });
  }

  /** 重启策略每轮结束后无需清理 */
  async afterRound(_botCtx: BotContext): Promise<void> {
    // 进程已退出，无需操作
  }

  /** 重启策略对局结束后无需额外清理 */
  async cleanup(_botCtx: BotContext): Promise<void> {
    // 无常驻资源
  }
}
